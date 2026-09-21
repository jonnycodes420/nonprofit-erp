// BUILD-92 — CLOSING AN ORGANISATION THAT ALREADY EXISTS.
//
// The close link was built to conjure an organisation out of nothing: a name,
// an email, a card, and on the other side there is an org and its first admin.
// That is the right shape for a new customer and the wrong shape for one who
// is already here — and the product said so out loud, by refusing the contact
// email with "That email already has a Steward account." The refusal was
// CORRECT (users.email is globally unique, and a new-org close mints a user),
// but it was also the entire answer, and the thing a person actually wanted —
// put THIS org on a plan — had nowhere to happen.
//
// So the same route now takes `orgId` instead of a name and an address, and
// the completion ATTACHES instead of creating. This suite is about the line
// between those two behaviours, because everything that could go wrong here
// goes wrong on that line: a second org conjured next to the real one, a
// duplicate user, a customer billed twice, or a link sent to somebody who
// cannot log in.
//
// Boot recipe: tests/README.md plus the billing seam, exactly as
// tests/close-link.test.js documents (STRIPE_BILLING_API_BASE + the three
// price ids). The Stripe API here is a local mock; everything on Steward's
// side of the wire is real.

const http = require("http");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, BILLING_MOCK_PORT } = require("./helpers");
const { validateOrgClose, closePlan } = require("../closeLink");

const SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const HQ = "org_ce_hq";                       // the super-admin's own org
const SUPER = "cesuper@example.org", STAFF = "cestaff@example.org";
const CUST = "org_ce_customer";               // the org being closed — already exists
const CUST_ADMIN = "director-ce@example.org";
const NO_ADMIN = "org_ce_noadmin";            // exists, but nobody can be written to
const SUBBED = "org_ce_subbed";               // already paying
const DAY = 24 * 60 * 60 * 1000;

// ── the two local seams ────────────────────────────────────────────────────
let mails = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    try { if (req.url === "/emails") mails.push(JSON.parse(b)); } catch { /* not ours */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});

let sessions = [];
let SUB = null;
const PRICES = {
  price_test_founding: { unit_amount: 19900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
  price_test_core:     { unit_amount: 24900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
  price_test_team:     { unit_amount: 49900, currency: "usd", recurring: { interval: "month", interval_count: 1 } },
};
function startBillingMock(port = BILLING_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.method === "POST" && req.url.startsWith("/v1/checkout/sessions")) {
          const form = new URLSearchParams(b);
          const id = "cs_ce_" + (sessions.length + 1);
          sessions.push({ id, form, raw: b });
          return res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
        }
        const sub = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (req.method === "GET" && sub) return res.end(JSON.stringify(SUB));
        const price = req.url.match(/^\/v1\/prices\/([^/?]+)/);
        if (req.method === "GET" && price) {
          const p = PRICES[price[1]];
          if (!p) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: "resource_missing", message: "No such price", param: "price" } })); }
          return res.end(JSON.stringify({ id: price[1], object: "price", ...p }));
        }
        if (req.method === "POST" && req.url.startsWith("/v1/customers")) {
          return res.end(JSON.stringify({ id: "cus_ce", object: "customer" }));
        }
        res.statusCode = 404; res.end(JSON.stringify({ error: { message: "mock: " + req.method + " " + req.url } }));
      });
    });
    srv.listen(port, () => resolve(srv));
  });
}

async function fireBilling(id, type, object) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(BASE + "/billing/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const ORGS = [HQ, CUST, NO_ADMIN, SUBBED];
async function reset() {
  // Anything a previous run CREATED (the failure this suite is guarding
  // against) must go too, or "no new org was made" passes on a stale row.
  const made = await q(`SELECT org_id FROM close_links WHERE contact_email LIKE '%-ce@example.org' AND org_id IS NOT NULL`).catch(() => []);
  for (const r of made) if (!ORGS.includes(r.org_id)) {
    await q(`DELETE FROM users WHERE org_id=$1`, [r.org_id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [r.org_id]).catch(() => {});
  }
  await q(`DELETE FROM close_links WHERE contact_email LIKE '%ce@example.org'`).catch(() => {});
  await q(`DELETE FROM billing_webhook_events WHERE event_id LIKE 'evt_ce_%'`).catch(() => {});
  for (const o of ORGS) {
    await q(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE org_id=$1)`, [o]).catch(() => {});
    await q(`DELETE FROM users WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM accounts WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM workflows WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

const countOrgs = async () => Number((await q(`SELECT COUNT(*)::int c FROM orgs`))[0].c);
const countUsers = async () => Number((await q(`SELECT COUNT(*)::int c FROM users`))[0].c);

(async () => {
  const mockSrv = await startBillingMock();
  await new Promise(r => sink.listen(SINK_PORT, r));
  await reset();

  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Close HQ','ce-hq',1,'active','team')`, [HQ]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_ce_super',$1,$2,$3,'Jonathan','admin',true)`, [HQ, SUPER, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_ce_staff',$1,$2,$3,'Staffer','staff',false)`, [HQ, STAFF, hash]);

  // The customer: a real organisation, already using Steward, on no plan.
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Harbor Light','ce-harbor',1,'trialing','trial')`, [CUST]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ce_dir',$1,$2,$3,'Director','admin')`, [CUST, CUST_ADMIN, hash]);
  // …and a removed admin who registered FIRST, so "the first admin" is not a
  // good enough rule on its own.
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,created_at,deactivated_at)
           VALUES ('u_ce_gone',$1,'gone-ce@example.org',$2,'Gone','admin',NOW() - INTERVAL '10 days', NOW())`, [CUST, hash]);

  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete) VALUES ($1,'No Admin Org','ce-noadmin',1)`, [NO_ADMIN]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,deactivated_at) VALUES ('u_ce_na',$1,'na-ce@example.org',$2,'Removed','admin',NOW())`, [NO_ADMIN, hash]);

  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_subscription_id)
           VALUES ($1,'Already Paying','ce-subbed',1,'active','core','sub_existing_ce')`, [SUBBED]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ce_sb',$1,'sb-ce@example.org',$2,'Paid','admin')`, [SUBBED, hash]);

  const supr = await login(SUPER);
  const staff = await login(STAFF);

  // ── §1 · the pure module ────────────────────────────────────────────────
  console.log("— §1 · what a caller actually chooses: an org and a plan —");
  ok("an org close needs an org", validateOrgClose({ plan: "core" }).error === "org_id_required");
  ok("…and a real plan", validateOrgClose({ orgId: "org_x", plan: "enterprise" }).error === "invalid_plan");
  ok("…and that is ALL it needs — no name, no address to mistype",
     validateOrgClose({ orgId: "org_x", plan: "team" }).ok === true);
  ok("…and it resolves the plan to the live amount",
     validateOrgClose({ orgId: "org_x", plan: "team" }).plan.monthlyUsd === 499);
  ok("the contact email is NOT a caller input on this path",
     !("contactEmail" in validateOrgClose({ orgId: "org_x", plan: "core" })));

  // ── §2 · minting against an org that exists ─────────────────────────────
  console.log("\n— §2 · the link is minted against the org, not against a typed address —");
  const asStaff = await api("POST", "/admin/close-links", staff, { orgId: CUST, plan: "core" });
  ok("a non-super-admin cannot close anybody", asStaff.status === 403, asStaff.status);

  const missing = await api("POST", "/admin/close-links", supr, { orgId: "org_does_not_exist", plan: "core" });
  ok("an org that does not exist is a 404, not a new org",
     missing.status === 404 && missing.body.error === "org_not_found", missing.body);

  const noAdmin = await api("POST", "/admin/close-links", supr, { orgId: NO_ADMIN, plan: "core" });
  ok("an org whose only admin was REMOVED is refused — a link there reaches nobody",
     noAdmin.status === 409 && noAdmin.body.error === "no_active_admin", noAdmin.body);
  ok("…and it says whose problem it is, by name",
     /No Admin Org/.test(noAdmin.body.message || ""), noAdmin.body.message);

  const already = await api("POST", "/admin/close-links", supr, { orgId: SUBBED, plan: "team" });
  ok("an org that ALREADY has a Stripe subscription is refused — nobody gets billed twice",
     already.status === 409 && already.body.error === "already_subscribed", already.body);

  const orgsBefore = await countOrgs(), usersBefore = await countUsers();
  const mint = await api("POST", "/admin/close-links", supr, { orgId: CUST, plan: "core" });
  ok("closing an existing org succeeds where a typed email would have been refused",
     mint.status === 201, mint.body);
  ok("…and the link is addressed to the org's OWN active admin",
     mint.body.contactEmail === CUST_ADMIN, mint.body.contactEmail);
  ok("…NOT to the admin who was removed, even though that one registered first",
     mint.body.contactEmail !== "gone-ce@example.org", mint.body.contactEmail);
  ok("…and it carries the org's real name, not one retyped in the room",
     mint.body.orgName === "Harbor Light", mint.body.orgName);
  ok("…and it is marked as targeting an existing org",
     mint.body.existingOrg === true && mint.body.targetOrgId === CUST, mint.body);
  ok("…and the sentence above the button still names the amount and the date",
     /\$249/.test(mint.body.notice || "") && /pay nothing/.test(mint.body.notice || ""), mint.body.notice);

  const row = (await q(`SELECT * FROM close_links WHERE id=$1`, [mint.body.id]))[0];
  ok("the row remembers WHICH org it attaches to", row && row.target_org_id === CUST, row && row.target_org_id);
  ok("…and minting created no org and no user", await countOrgs() === orgsBefore && await countUsers() === usersBefore);

  // A second link against the same org, before the first is walked: the
  // already_subscribed check cannot catch this one (nobody has paid yet).
  const twice = await api("POST", "/admin/close-links", supr, { orgId: CUST, plan: "team" });
  ok("a SECOND open link against the same org is refused — two would bill them twice",
     twice.status === 409 && twice.body.error === "close_link_open", twice.body);
  ok("...and it points at the link already open, rather than just saying no",
     twice.body.existingLinkId === mint.body.id, twice.body.existingLinkId);
  ok("...and no second link row was written",
     Number((await q(`SELECT COUNT(*)::int c FROM close_links WHERE target_org_id=$1`, [CUST]))[0].c) === 1);

  const listed = await api("GET", "/admin/close-links", supr);
  const mine = (listed.body.links || []).find(l => l.id === mint.body.id);
  ok("the console can see which org a link was raised against",
     mine && mine.targetOrgName === "Harbor Light" && mine.targetOrgId === CUST,
     mine && { name: mine.targetOrgName, id: mine.targetOrgId });

  // ── §3 · completion ATTACHES — the whole point ──────────────────────────
  console.log("\n— §3 · completing it attaches a subscription and creates NOTHING —");
  const trialEnd = Math.floor((Date.now() + 30 * DAY) / 1000);
  SUB = { id: "sub_ce_1", object: "subscription", status: "trialing",
          trial_start: Math.floor(Date.now() / 1000), trial_end: trialEnd, items: { data: [] } };
  mails = [];
  const beforeOrgs = await countOrgs(), beforeUsers = await countUsers();
  const done = await fireBilling("evt_ce_1", "checkout.session.completed", {
    id: sessions[sessions.length - 1].id, object: "checkout.session",
    customer: "cus_ce", subscription: "sub_ce_1",
    metadata: { closeLinkId: mint.body.id, plan: "core", orgName: "Harbor Light", contactEmail: CUST_ADMIN },
  });
  ok("the webhook is accepted", done.status === 200, done);

  ok("NO second organisation was conjured next to the real one", await countOrgs() === beforeOrgs, await countOrgs());
  ok("NO duplicate user was created for an address that already has an account",
     await countUsers() === beforeUsers, await countUsers());

  const after = (await q(`SELECT * FROM orgs WHERE id=$1`, [CUST]))[0];
  ok("the EXISTING org is the one that moved onto the plan", after.plan === "core", after.plan);
  ok("…and it is trialing, not active — nothing has been charged", after.subscription_status === "trialing", after.subscription_status);
  ok("…and it carries the Stripe subscription", after.stripe_subscription_id === "sub_ce_1", after.stripe_subscription_id);
  ok("…and the trial ends thirty days out, read off Stripe rather than recomputed",
     Math.abs(new Date(after.trial_ends_at).getTime() - trialEnd * 1000) < 2000,
     { got: after.trial_ends_at, want: new Date(trialEnd * 1000).toISOString() });
  ok("…and the org still has exactly the users it started with",
     Number((await q(`SELECT COUNT(*)::int c FROM users WHERE org_id=$1`, [CUST]))[0].c) === 2);

  const link2 = (await q(`SELECT * FROM close_links WHERE id=$1`, [mint.body.id]))[0];
  ok("the link reads completed, pointing at the org it attached to",
     link2.status === "completed" && link2.org_id === CUST, { s: link2.status, o: link2.org_id });

  // The email: the one thing that must NOT be the new-org welcome.
  const sent = mails.filter(m => (m.to === CUST_ADMIN || (Array.isArray(m.to) && m.to.includes(CUST_ADMIN))));
  ok("the admin is told, once", sent.length === 1, sent.length);
  const body = sent.length ? String(sent[0].html || "") : "";
  ok("…and is NOT told to set a password they already have",
     !/set your password/i.test(body), body.slice(0, 200));
  ok("…and no reset token was minted for an account that never needed one",
     Number((await q(`SELECT COUNT(*)::int c FROM password_reset_tokens WHERE user_id='u_ce_dir'`))[0].c) === 0);
  ok("…and the mail still names the amount and the date, which is what changed",
     /\$249/.test(body) && /Cancel any time before then/.test(body));

  // Idempotence: a redelivered event must not double anything.
  const again = await fireBilling("evt_ce_2", "checkout.session.completed", {
    id: sessions[sessions.length - 1].id, object: "checkout.session",
    customer: "cus_ce", subscription: "sub_ce_1",
    metadata: { closeLinkId: mint.body.id, plan: "core", orgName: "Harbor Light", contactEmail: CUST_ADMIN },
  });
  ok("a redelivered completion is accepted", again.status === 200, again);
  ok("…and changes nothing: still one org, still two users",
     await countOrgs() === beforeOrgs && Number((await q(`SELECT COUNT(*)::int c FROM users WHERE org_id=$1`, [CUST]))[0].c) === 2);

  // ── §4 · the original path is untouched ─────────────────────────────────
  console.log("\n— §4 · minting a NEW org still works, and still refuses a taken address —");
  const fresh = await api("POST", "/admin/close-links", supr, { orgName: "Brand New", contactEmail: "brandnew-ce@example.org", plan: "team" });
  ok("a genuinely new org still mints", fresh.status === 201 && fresh.body.existingOrg === false, fresh.body);
  ok("…and is not marked against any existing org", fresh.body.targetOrgId === null, fresh.body.targetOrgId);

  const taken = await api("POST", "/admin/close-links", supr, { orgName: "Whatever", contactEmail: CUST_ADMIN, plan: "core" });
  ok("a taken address is still refused on the NEW-org path — users.email is globally unique",
     taken.status === 409 && taken.body.error === "email_in_use", taken.body);
  ok("…but the refusal now NAMES the organisation holding it",
     /Harbor Light/.test(taken.body.message || ""), taken.body.message);
  ok("…and says what to do instead, rather than stopping at 'no'",
     /close it from Organizations/i.test(taken.body.message || ""), taken.body.message);
  ok("…and hands the console the org id, so it can offer the right button",
     taken.body.orgId === CUST, taken.body.orgId);

  const removedHolder = await api("POST", "/admin/close-links", supr, { orgName: "Whatever", contactEmail: "gone-ce@example.org", plan: "core" });
  ok("an address held by a REMOVED user is refused too — soft delete does not free it",
     removedHolder.status === 409 && removedHolder.body.removedUser === true, removedHolder.body);
  ok("…and says so, instead of implying the account is in use",
     /removed user/i.test(removedHolder.body.message || ""), removedHolder.body.message);

  await reset();
  sink.close(); mockSrv.close(); await closeDb();
  summary();
})();
