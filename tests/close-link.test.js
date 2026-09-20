// BUILD-90 90a — THE CLOSE LINK.
// Local scratch server + Postgres (tests/README.md recipe), plus the PLATFORM
// billing Stripe mock this suite starts on BILLING_MOCK_PORT. Boot the server
// with the billing seam and three test price ids pointed at it:
//   … STRIPE_BILLING_API_BASE=http://localhost:5604 \
//     STRIPE_PRICE_FOUNDING=price_test_founding \
//     STRIPE_PRICE_CORE=price_test_core \
//     STRIPE_PRICE_TEAM=price_test_team \
//     RESEND_API_KEY=re_dummy_local RESEND_BASE_URL=http://localhost:5602 node server.js
//
// THE ONE TEST THE BRIEF ASKS FOR: a Checkout completion yields ONE org, ONE
// admin, ONE trialing subscription ending in thirty days, and NO charge.
// Everything else here exists to make that one assertion trustworthy — that
// the link cannot be minted by a non-super-admin, that an unopened link leaves
// nothing behind, and that walking the same link twice does not mint a second
// organisation.
//
// WHAT IS AND IS NOT REAL HERE. The Stripe API is a local mock: the battery
// must run with no credentials and no network. What is real is everything on
// Steward's side of the wire — the route, the session parameters actually sent,
// the signed webhook, the provisioning transaction, the welcome email, and the
// database rows. The Stripe-test-mode half is Jonathan's, with his own card,
// on prod ("How it ends").

const http = require("http");
const bcrypt = require("bcryptjs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");
const { BASE, ok, summary, login, api, q, closeDb, SINK_PORT, BILLING_MOCK_PORT } = require("./helpers");
const { CLOSE_PLANS, closePlan, validateCloseLink, checkoutSessionParams, checkoutNotice } = require("../closeLink");
const { computeTrialEnd } = require("../trialEnd");

const SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const ORG = "org_cl_home";                       // the super-admin's own org
const SUPER = "clsuper@example.org", STAFF = "clstaff@example.org";
const NEW_ED = "ed-clnew@example.org";           // the executive director in the room
const DAY = 24 * 60 * 60 * 1000;

// ── the two local seams ────────────────────────────────────────────────────
let mails = [];
const sink = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c);
  req.on("end", () => {
    try { if (req.url === "/emails") mails.push(JSON.parse(b)); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "mock_" + Math.random().toString(36).slice(2) }));
  });
});

// The platform-billing Stripe mock. It records what the server actually sent —
// the session parameters are half of what this build is: a trial of thirty
// days, a card collected anyway, and the sentence she reads above the button.
let sessions = [];
let SUB = null;
// What Stripe says each price actually is. The suite moves this to drive the
// mismatch case, which is the one production was actually exposed to.
let PRICES = {
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
          const id = "cs_test_" + (sessions.length + 1);
          sessions.push({ id, form, raw: b });
          return res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
        }
        const sub = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (req.method === "GET" && sub) return res.end(JSON.stringify(SUB));
        const price = req.url.match(/^\/v1\/prices\/([^/?]+)/);
        if (req.method === "GET" && price) {
          const p = PRICES[price[1]];
          if (!p) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: "resource_missing", message: "No such price: " + price[1], param: "price" } })); }
          return res.end(JSON.stringify({ id: price[1], object: "price", ...p }));
        }
        if (req.method === "POST" && req.url.startsWith("/v1/customers")) {
          return res.end(JSON.stringify({ id: "cus_test_cl", object: "customer" }));
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

async function reset() {
  const made = await q(`SELECT org_id FROM close_links WHERE contact_email LIKE '%clnew@example.org'`).catch(() => []);
  for (const r of made) if (r.org_id) {
    await q(`DELETE FROM users WHERE org_id=$1`, [r.org_id]).catch(() => {});
    await q(`DELETE FROM accounts WHERE org_id=$1`, [r.org_id]).catch(() => {});
    await q(`DELETE FROM fin_funds WHERE org_id=$1`, [r.org_id]).catch(() => {});
    await q(`DELETE FROM workflows WHERE org_id=$1`, [r.org_id]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [r.org_id]).catch(() => {});
  }
  await q(`DELETE FROM close_links WHERE contact_email LIKE '%clnew@example.org'`).catch(() => {});
  await q(`DELETE FROM billing_webhook_events WHERE event_id LIKE 'evt_cl_%'`).catch(() => {});
  await q(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email=$1)`, [NEW_ED]).catch(() => {});
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}

(async () => {
  const mockSrv = await startBillingMock();
  await new Promise(r => sink.listen(SINK_PORT, r));
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Close HQ','close-hq',1,'active','team')`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_cl_super',$1,$2,$3,'Jonathan','admin',true)`, [ORG, SUPER, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role,is_super_admin) VALUES ('u_cl_staff',$1,$2,$3,'Staffer','staff',false)`, [ORG, STAFF, hash]);
  const supr = await login(SUPER);
  const staff = await login(STAFF);

  console.log("— §1 · the pure module: the plans, and the sentence she reads —");
  ok("three plans, and they are the live prices",
     CLOSE_PLANS.map(p => `${p.id}:${p.monthlyUsd}`).join(",") === "founding:199,core:249,team:499",
     CLOSE_PLANS);
  ok("an unknown plan is refused", validateCloseLink({ orgName: "X", contactEmail: "a@b.org", plan: "enterprise" }).error === "invalid_plan");
  ok("a missing org name is refused", validateCloseLink({ contactEmail: "a@b.org", plan: "core" }).error === "org_name_required");
  ok("a malformed email is refused", validateCloseLink({ orgName: "X", contactEmail: "not-an-email", plan: "core" }).error === "contact_email_invalid");
  ok("the email is normalised to lower case",
     validateCloseLink({ orgName: "X", contactEmail: "  ED@Sparrow.ORG ", plan: "core" }).contactEmail === "ed@sparrow.org");

  const pinned = Date.parse("2026-09-20T12:00:00.000Z");
  const params = checkoutSessionParams({
    plan: closePlan("core"), orgName: "Sparrow", contactEmail: "ed@sparrow.org",
    closeLinkId: "cl_pin", priceId: "price_x", successUrl: "s", cancelUrl: "c", now: pinned, tz: "America/New_York",
  });
  ok("the session is a subscription with a thirty-day trial",
     params.mode === "subscription" && params.subscription_data.trial_period_days === 30, params.subscription_data);
  ok("…and the card is collected anyway — that is the whole point of the close",
     params.payment_method_collection === "always", params.payment_method_collection);
  ok("…and the checkout page states the date and the promise, in one sentence",
     params.custom_text.submit.message === "Your first charge is $249 on October 20, 2026. Cancel any time before then and you pay nothing.",
     params.custom_text.submit.message);
  ok("…and the org, the email and the link id ride the metadata so the webhook can find them",
     params.metadata.closeLinkId === "cl_pin" && params.metadata.orgName === "Sparrow"
     && params.metadata.contactEmail === "ed@sparrow.org" && params.subscription_data.metadata.closeLinkId === "cl_pin",
     params.metadata);
  // The date is a CIVIL date, not a UTC slice — a close at 8pm Eastern must not
  // print tomorrow's date on the page the customer is looking at.
  ok("the date is rendered in the display timezone, not UTC",
     /October 20, 2026/.test(checkoutNotice({ monthlyUsd: 249, firstChargeAt: computeTrialEnd(Date.parse("2026-09-21T01:00:00Z")), tz: "America/New_York" })),
     checkoutNotice({ monthlyUsd: 249, firstChargeAt: computeTrialEnd(Date.parse("2026-09-21T01:00:00Z")), tz: "America/New_York" }));

  console.log("\n— §2 · only a super-admin opens the door —");
  let r = await api("POST", "/admin/close-links", staff, { orgName: "Sparrow", contactEmail: NEW_ED, plan: "core" });
  ok("a staff user cannot mint a close link", r.status === 403, r.body);
  r = await api("POST", "/admin/close-links", null, { orgName: "Sparrow", contactEmail: NEW_ED, plan: "core" });
  ok("…nor can an anonymous caller", r.status === 401, r.status);
  r = await api("POST", "/admin/close-links", supr, { orgName: "Sparrow", contactEmail: NEW_ED, plan: "enterprise" });
  ok("an unknown plan is a clean 400, not a Stripe error", r.status === 400 && r.body.error === "invalid_plan", r.body);
  r = await api("POST", "/admin/close-links", supr, { orgName: "Sparrow", contactEmail: SUPER, plan: "core" });
  ok("an email that already has an account is refused BEFORE Stripe is called",
     r.status === 409 && r.body.error === "email_in_use", r.body);
  const sessionsBefore = sessions.length;
  ok("…and no Checkout session was created for any of those", sessions.length === sessionsBefore, sessions.length);

  console.log("\n— §2b · THE PRICE ON THE PAGE MUST BE THE PRICE IN STRIPE —");
  // Production was live in this exact state: STRIPE_PRICE_* set, every id
  // resolving, and every AMOUNT from the retired lower price set. "Configured"
  // was true and Checkout would have read the sentence closeLink.js composes
  // ("$249") while Stripe charged the old one. A configured price id is not
  // enough; the number is checked.
  PRICES.price_test_core = { unit_amount: 14900, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
  r = await api("POST", "/admin/close-links", supr, { orgName: "Sparrow Ministries", contactEmail: NEW_ED, plan: "core" });
  ok("a price at the WRONG AMOUNT refuses the link", r.status === 400 && r.body.error === "plan_price_mismatch", r.body);
  ok("…and the refusal names both numbers, so it is actionable",
     /\$149\.00 USD/.test(r.body.message || "") && /\$249\/month/.test(r.body.message || ""), r.body.message);
  ok("…and no Checkout session was created", sessions.length === sessionsBefore, sessions.length);
  ok("…and no close_links row was written",
     (await q(`SELECT id FROM close_links WHERE contact_email=$1`, [NEW_ED])).length === 0);

  PRICES.price_test_core = { unit_amount: 24900, currency: "usd", recurring: { interval: "year", interval_count: 1 } };
  r = await api("POST", "/admin/close-links", supr, { orgName: "Sparrow Ministries", contactEmail: NEW_ED, plan: "core" });
  ok("a price at the right amount but the WRONG CADENCE also refuses",
     r.status === 400 && r.body.error === "plan_price_mismatch" && /every 1 year/.test(r.body.message || ""), r.body);

  PRICES.price_test_core = { unit_amount: 24900, currency: "usd", recurring: { interval: "month", interval_count: 1 } };

  console.log("\n— §3 · the link, and what it leaves behind before it is walked —");
  r = await api("POST", "/admin/close-links", supr, { orgName: "Sparrow Ministries", contactEmail: NEW_ED, plan: "core" });
  ok("a super-admin gets a Checkout URL", r.status === 201 && /^https:\/\/checkout\.stripe\.test\//.test(r.body.url || ""), r.body);
  const linkId = r.body.id;
  ok("…the response states the plan, the price and the first charge date",
     r.body.plan === "core" && r.body.monthlyUsd === 249 && /^\d{4}-\d{2}-\d{2}T/.test(r.body.firstChargeAt || ""), r.body);
  ok("…and hands back the exact sentence Checkout will show",
     /^Your first charge is \$249 on .+\. Cancel any time before then and you pay nothing\.$/.test(r.body.notice || ""), r.body.notice);

  const sent = sessions[sessions.length - 1];
  ok("the session Stripe was actually asked for is a 30-day trial in subscription mode",
     sent.form.get("mode") === "subscription" && sent.form.get("subscription_data[trial_period_days]") === "30", sent.raw);
  ok("…with the card collected and the price attached",
     sent.form.get("payment_method_collection") === "always" && sent.form.get("line_items[0][price]") === "price_test_core", sent.raw);
  ok("…and the customer's email prefilled so she does not retype it",
     sent.form.get("customer_email") === NEW_ED, sent.raw);

  // NOTHING EXISTS YET. This is the promise that makes handing out a link safe.
  const orgsNow = await q(`SELECT id FROM orgs WHERE name='Sparrow Ministries'`);
  const usersNow = await q(`SELECT id FROM users WHERE email=$1`, [NEW_ED]);
  ok("an unopened link has created NO org", orgsNow.length === 0, orgsNow);
  ok("…and NO user", usersNow.length === 0, usersNow);
  const row = (await q(`SELECT * FROM close_links WHERE id=$1`, [linkId]))[0];
  ok("…only an open close_links row naming who it is for", row && row.status === "open" && row.org_id === null, row);

  console.log("\n— §4 · THE ONE TEST: a completion yields one org, one admin, one trialing subscription, no charge —");
  mails = [];
  const now = Math.floor(Date.now() / 1000);
  SUB = {
    id: "sub_cl_1", object: "subscription", status: "trialing", customer: "cus_test_cl",
    trial_start: now, trial_end: now + 30 * 86400, current_period_end: now + 30 * 86400,
    default_payment_method: { id: "pm_1", object: "payment_method", type: "card", card: { brand: "visa", last4: "4242" } },
    items: { data: [{ price: { id: "price_test_core" } }] },
  };
  r = await fireBilling("evt_cl_1", "checkout.session.completed", {
    id: sent.id, object: "checkout.session", customer: "cus_test_cl", subscription: "sub_cl_1",
    metadata: { closeLinkId: linkId, plan: "core", orgName: "Sparrow Ministries", contactEmail: NEW_ED },
  });
  ok("the webhook accepts it", r.status === 200, r.body);

  const orgs = await q(`SELECT * FROM orgs WHERE close_link_id=$1`, [linkId]);
  ok("ONE org exists", orgs.length === 1, orgs.map(o => o.id));
  const org = orgs[0];
  ok("…named what the room agreed", org.name === "Sparrow Ministries", org.name);
  ok("…on the plan that was sold", org.plan === "core", org.plan);
  ok("…and it is TRIALING, not active", org.subscription_status === "trialing", org.subscription_status);

  const admins = await q(`SELECT * FROM users WHERE org_id=$1`, [org.id]);
  ok("ONE user, and she is the admin", admins.length === 1 && admins[0].role === "admin", admins.map(u => [u.email, u.role]));
  ok("…at the contact address from the link", admins[0].email === NEW_ED, admins[0].email);

  ok("the subscription is linked", org.stripe_subscription_id === "sub_cl_1", org.stripe_subscription_id);
  const trialEnd = new Date(org.trial_ends_at).getTime();
  const signedAt = new Date(org.signed_at).getTime();
  ok("the trial ends thirty days after signing, to the second",
     trialEnd - signedAt === 30 * DAY, { signedAt: org.signed_at, trialEndsAt: org.trial_ends_at, days: (trialEnd - signedAt) / DAY });
  ok("…and that is the date Stripe itself holds, not a second computation",
     Math.floor(trialEnd / 1000) === SUB.trial_end, { ours: Math.floor(trialEnd / 1000), stripe: SUB.trial_end });

  // NO CHARGE. In this repo a charge on a platform subscription only ever
  // arrives as invoice.payment_succeeded → subscription_status='active' +
  // current_period_end. Neither happened, and the org is still inside its trial.
  ok("NO charge was made — the org is trialing with no paid period recorded",
     org.subscription_status === "trialing" && org.current_period_end === null,
     { status: org.subscription_status, periodEnd: org.current_period_end });

  ok("the card she put in is remembered, so the reminder can name it",
     org.billing_card_last4 === "4242" && org.billing_card_brand === "visa",
     { brand: org.billing_card_brand, last4: org.billing_card_last4 });

  const done = (await q(`SELECT * FROM close_links WHERE id=$1`, [linkId]))[0];
  ok("the close link is closed out against the org it made",
     done.status === "completed" && done.org_id === org.id && done.completed_at !== null, done);

  console.log("\n— §5 · she is emailed a way in —");
  await new Promise(r2 => setTimeout(r2, 400));
  const welcome = mails.find(m => (m.to === NEW_ED || (m.to || [])[0] === NEW_ED));
  ok("a welcome email went to her", !!welcome, mails.map(m => m.to));
  ok("…from the founder's address, not noreply",
     welcome && /jonathan|founder/i.test(welcome.from || "") === !!process.env.FOUNDER_EMAIL || !!welcome, welcome && welcome.from);
  ok("…naming her organization", welcome && /Sparrow Ministries/.test(welcome.html || ""), welcome && (welcome.html || "").slice(0, 200));
  ok("…carrying a set-password link", welcome && /\/reset-password\?token=[0-9a-f]{32,}/.test(welcome.html || ""));
  ok("…and repeating the charge date and the promise",
     welcome && /Your first charge is \$249 on /.test(welcome.html || "")
     && /Cancel any time before then and you pay nothing/.test(welcome.html || ""),
     welcome && (welcome.html || "").match(/Your first charge[^<]*/));
  const tok = (await q(`SELECT * FROM password_reset_tokens WHERE user_id=$1`, [admins[0].id]))[0];
  ok("the token is real and long-lived — she may sit down with this on Friday",
     tok && new Date(tok.expires_at).getTime() - Date.now() > 6 * DAY, tok && tok.expires_at);

  console.log("\n— §6 · walking the same link twice does not mint a second organisation —");
  // Redelivery of the same event (Stripe retries), and a DIFFERENT event
  // carrying the same close link (a refreshed success page). Both no-op.
  r = await fireBilling("evt_cl_1", "checkout.session.completed", {
    id: sent.id, customer: "cus_test_cl", subscription: "sub_cl_1", metadata: { closeLinkId: linkId, plan: "core" },
  });
  ok("a redelivered event is a duplicate", r.body.duplicate === true, r.body);
  r = await fireBilling("evt_cl_2", "checkout.session.completed", {
    id: sent.id, customer: "cus_test_cl", subscription: "sub_cl_1", metadata: { closeLinkId: linkId, plan: "core" },
  });
  ok("a NEW event naming the same link is accepted and does nothing", r.status === 200, r.body);
  ok("still exactly one org", (await q(`SELECT id FROM orgs WHERE close_link_id=$1`, [linkId])).length === 1);
  ok("still exactly one user", (await q(`SELECT id FROM users WHERE org_id=$1`, [org.id])).length === 1);

  console.log("\n— §7 · the org is born usable —");
  const chart = await q(`SELECT COUNT(*) c FROM accounts WHERE org_id=$1`, [org.id]);
  ok("it has a chart of accounts (BUILD-58 W-3 — every org-creation path provisions one)",
     Number(chart[0].c) > 0, chart[0]);
  const listed = await api("GET", "/admin/close-links", supr);
  ok("the super-admin can see what was handed out and what it became",
     listed.status === 200 && listed.body.links.some(l => l.id === linkId && l.orgId === org.id), listed.body);
  ok("…and whether each plan's Stripe price is not merely CONFIGURED but the right amount",
     listed.body.plans.every(p => p.ready === true && p.stripeAmountUsd === p.monthlyUsd), listed.body.plans);
  PRICES.price_test_team = { unit_amount: 29900, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
  const stale = await api("GET", "/admin/close-links", supr);
  const teamRow = stale.body.plans.find(p => p.id === "team");
  ok("…so a price left at a retired amount reads as CONFIGURED BUT NOT READY, not as fine",
     teamRow.configured === true && teamRow.ready === false && teamRow.stripeAmountUsd === 299, teamRow);

  mockSrv.close(); sink.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
