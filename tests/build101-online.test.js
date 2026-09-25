// BUILD-101 Part 4 — SELLING IT ONLINE.
//
//   §1  a tampered amount on the page still charges the LEVEL price, and the
//       level id rides the checkout; auto-renew is yearly and only for a
//       12-month level;
//   §2  the webhook writes ONE gift (with the benefits split) and ONE
//       membership; a redelivered webhook writes nothing new;
//   §3  a member who buys again online is RENEWED from the old expiry;
//   §4  an auto-renewing membership: the checkout stamps the level on the
//       subscription, the first charge becomes the membership in EITHER event
//       order, and the second year's charge extends it;
//   §5  an auto-renew membership whose card fails enters the EXISTING recovery
//       cadence, unchanged;
//   §6  the public read states the deductible part, and another org's level
//       is not reachable through this org's page.
//
// A local Stripe mock stands on STRIPE_MOCK_PORT (the server's
// STRIPE_API_BASE) and records the checkout it was asked to create.

const http = require("http"), crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const O = "b101_onl", B = "b101_onl_b", ACCT = "acct_b101onl";
const PW = "loadtest1234";
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

let calls = [];
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        calls.push({ method: req.method, path: req.url, body: decodeURIComponent(b) });
        res.setHeader("Content-Type", "application/json");
        if (/^\/v1\/checkout\/sessions/.test(req.url)) res.end(JSON.stringify({ id: "cs_mock", url: "https://checkout.example/cs_mock" }));
        // A first-charge PaymentIntent names nobody; Stripe's customer object does.
        else if (/^\/v1\/customers\/cus_b101_b/.test(req.url)) res.end(JSON.stringify({ id: "cus_b101_b", object: "customer", email: "bo@example.org", name: "Bo Paid" }));
        else res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
function sig(payload) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest").update(`${t}.${payload}`).digest("hex")}`;
}
const fire = async ev => { const p = JSON.stringify(ev); return fetch(`${BASE}/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig(p) }, body: p }); };

async function reset() {
  for (const o of [O, B]) {
    for (const t of ["memberships", "recurring_change_log", "payment_recovery_events", "recurring_subscriptions", "receipts", "fin_transactions", "interactions",
                     "thank_you_drafts", "threads", "tasks", "workflow_runs", "gifts", "membership_levels", "donors", "users", "budgets", "accounts", "fin_funds"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [o]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [o]).catch(() => {});
  }
}

(async () => {
  console.log("build101-online");
  const mock = await startStripeMock();
  if (!mock) { console.log(`  SKIP — the Stripe mock port ${STRIPE_MOCK_PORT} is taken`); await closeDb(); summary(); return; }
  await reset();
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,stripe_account_id,stripe_connected,timezone,timezone_confirmed_at)
           VALUES ($1,'Lakeside Gardens','b101-onl',1,'team','active',$2,true,'America/New_York',NOW())`, [O, ACCT]);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,plan,subscription_status,stripe_account_id,stripe_connected)
           VALUES ($1,'Other Garden','b101-onl-b',1,'team','active','acct_b101onlb',true)`, [B]);
  const hash = bcrypt.hashSync(PW, 4);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101onl',$1,'b101-onl@example.org',$2,'Ola Admin','admin')`, [O, hash]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_b101onlb',$1,'b101-onlb@example.org',$2,'Bea Admin','admin')`, [B, hash]);
  const tok = await login("b101-onl@example.org"), tokB = await login("b101-onlb@example.org");
  await api("POST", "/onboarding/complete", tok, {});
  const today = (await api("GET", "/dashboard/home", tok)).body.today;
  const FAM = (await api("POST", "/membership-levels", tok, { name: "Family", price: 100, fmv: 25, term: "12_months", benefits: ["Free entry for two"] })).body.id;
  const CAL = (await api("POST", "/membership-levels", tok, { name: "Friend", price: 40, fmv: 0, term: "calendar_year" })).body.id;
  const OTHER = (await api("POST", "/membership-levels", tokB, { name: "Theirs", price: 60, fmv: 0, term: "12_months" })).body.id;

  // ── §1 · the server prices it ─────────────────────────────────────────────
  calls = [];
  const d1 = await fetch(`${BASE}/donate/b101-onl`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ membershipLevelId: FAM, amount: "1", firstName: "Pat", lastName: "Page", email: "pat@example.org", frequency: "once" }) });
  const cs = calls.find(c => c.method === "POST" && /checkout\/sessions/.test(c.path));
  ok("§1 the page is answered with a checkout", d1.status === 200 && !!cs, d1.status);
  ok("§1 a tampered $1 still charges the $100 level price", cs && /unit_amount\]=10000(&|$)/.test(cs.body), cs && cs.body);
  ok("§1 …as a one-time payment carrying the level id", cs && /mode=payment/.test(cs.body) && new RegExp(`membership_level_id\\]=${FAM}`).test(cs.body));
  calls = [];
  await fetch(`${BASE}/donate/b101-onl`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ membershipLevelId: FAM, amount: "5", firstName: "Pat", lastName: "Page", email: "pat@example.org", frequency: "annual" }) });
  const cs2 = calls.find(c => /checkout\/sessions/.test(c.path));
  ok("§1 auto-renew is a YEARLY subscription at the level price", cs2 && /mode=subscription/.test(cs2.body) && /interval\]=year/.test(cs2.body) && /unit_amount\]=10000(&|$)/.test(cs2.body), cs2 && cs2.body);
  const bad = await fetch(`${BASE}/donate/b101-onl`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ membershipLevelId: CAL, firstName: "Pat", lastName: "Page", email: "pat@example.org", frequency: "annual" }) });
  ok("§1 a calendar-year level cannot auto-renew", bad.status === 400);
  const foreign = await fetch(`${BASE}/donate/b101-onl`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ membershipLevelId: OTHER, firstName: "Pat", lastName: "Page", email: "pat@example.org" }) });
  ok("§6 another org's level cannot be bought through this org's page", foreign.status === 400);

  // ── §2 · the webhook: one gift, one membership, redelivery-safe ──────────
  const pi1 = { id: "evt_b101_pi1", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_b101_1", amount_received: 10000, receipt_email: "pat@example.org",
      metadata: { donor_email: "pat@example.org", donor_name: "Pat Page", org_id: O, membership_level_id: FAM, frequency: "once" } } } };
  ok("§2 the webhook accepts the membership payment", (await fire(pi1)).status === 200);
  const [pat] = await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(email)='pat@example.org'`, [O]);
  const patGifts = await q(`SELECT id, amount, quid_pro_quo_value, deductible_amount FROM gifts WHERE org_id=$1 AND donor_id=$2`, [O, pat.id]);
  ok("§2 ONE $100 gift with $25 of benefits and $75 deductible",
     patGifts.length === 1 && Number(patGifts[0].amount) === 100 && Number(patGifts[0].quid_pro_quo_value) === 25 && Number(patGifts[0].deductible_amount) === 75, patGifts);
  const patMs = await q(`SELECT * FROM memberships WHERE org_id=$1 AND donor_id=$2`, [O, pat.id]);
  ok("§2 ONE active Family membership, paid by that gift, from today",
     patMs.length === 1 && patMs[0].status === "active" && patMs[0].level_id === FAM && patMs[0].gift_id === patGifts[0].id && patMs[0].starts_on === today && patMs[0].source === "online", patMs);
  const again = await fire({ ...pi1, id: "evt_b101_pi1_redelivered" });
  ok("§2 a redelivered webhook writes nothing new", again.status === 200
     && (await q(`SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND donor_id=$2`, [O, pat.id]))[0].n === 1
     && (await q(`SELECT COUNT(*)::int n FROM memberships WHERE org_id=$1 AND donor_id=$2`, [O, pat.id]))[0].n === 1);

  // ── §3 · buying again online renews from the old expiry ──────────────────
  const patExp = patMs[0].expires_on;
  await fire({ id: "evt_b101_pi2", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_b101_2", amount_received: 10000, receipt_email: "pat@example.org",
      metadata: { donor_email: "pat@example.org", donor_name: "Pat Page", org_id: O, membership_level_id: FAM, frequency: "once" } } } });
  const [patNow] = await q(`SELECT * FROM memberships WHERE org_id=$1 AND donor_id=$2 AND status='active'`, [O, pat.id]);
  ok("§3 buying again renews: the new term starts the day after the old one ends",
     patNow && patNow.starts_on === addDays(patExp, 1) && patNow.renewed_from === patMs[0].id, patNow);

  // ── §4 · auto-renew, checkout first ───────────────────────────────────────
  const checkout = (id, sub, cus, email) => ({ id, type: "checkout.session.completed", account: ACCT,
    data: { object: { id: "cs_" + id, mode: "subscription", subscription: sub, customer: cus, customer_email: email, amount_total: 10000,
      metadata: { donor_email: email, donor_name: email.split("@")[0], org_id: O, membership_level_id: FAM, frequency: "annual" } } } });
  await fire(checkout("evt_b101_cs_a", "sub_b101_a", "cus_b101_a", "ann@example.org"));
  const [subA] = await q(`SELECT * FROM recurring_subscriptions WHERE org_id=$1 AND stripe_subscription_id='sub_b101_a'`, [O]);
  ok("§4 the checkout stamps the level on the yearly subscription", subA && subA.membership_level_id === FAM && subA.interval === "year", subA);
  await fire({ id: "evt_b101_pi_a1", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_b101_a1", amount_received: 10000, customer: "cus_b101_a", metadata: {} } } });
  const annMs = await q(`SELECT m.* FROM memberships m WHERE m.org_id=$1 AND m.donor_id=$2`, [O, subA.donor_id]);
  ok("§4 the first charge (no metadata of its own) becomes ONE membership", annMs.length === 1 && annMs[0].status === "active", annMs);
  const [annGift] = await q(`SELECT recurring_subscription_id, quid_pro_quo_value FROM gifts WHERE stripe_payment_id='pi_b101_a1'`);
  ok("§4 …its gift linked to the subscription and carrying the benefits", annGift && annGift.recurring_subscription_id === subA.id && Number(annGift.quid_pro_quo_value) === 25, annGift);
  await fire({ id: "evt_b101_pi_a2", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_b101_a2", amount_received: 10000, customer: "cus_b101_a", metadata: {} } } });
  const [annY2] = await q(`SELECT * FROM memberships WHERE org_id=$1 AND donor_id=$2 AND status='active'`, [O, subA.donor_id]);
  ok("§4 the second year's charge extends it from the old expiry", annY2 && annY2.starts_on === addDays(annMs[0].expires_on, 1), annY2);

  // ── §4 · auto-renew, payment first ────────────────────────────────────────
  await fire({ id: "evt_b101_pi_b1", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_b101_b1", amount_received: 10000, customer: "cus_b101_b", metadata: {} } } });
  const [bo] = await q(`SELECT id FROM donors WHERE org_id=$1 AND LOWER(email)='bo@example.org'`, [O]);
  ok("§4 (payment first) before the checkout arrives, nothing says it is a membership",
     bo && (await q(`SELECT COUNT(*)::int n FROM memberships WHERE org_id=$1 AND donor_id=$2`, [O, bo.id]))[0].n === 0);
  await fire(checkout("evt_b101_cs_b", "sub_b101_b", "cus_b101_b", "bo@example.org"));
  await fire(checkout("evt_b101_cs_b_redelivered", "sub_b101_b", "cus_b101_b", "bo@example.org"));
  const boMs = await q(`SELECT * FROM memberships WHERE org_id=$1 AND donor_id=$2`, [O, bo.id]);
  ok("§4 (payment first) the checkout attaches ONE membership to that gift, redelivery or not",
     boMs.length === 1 && boMs[0].gift_id === (await q(`SELECT id FROM gifts WHERE stripe_payment_id='pi_b101_b1'`))[0].id, boMs);

  // ── §5 · a failed card enters the existing recovery cadence ──────────────
  await fire({ id: "evt_b101_fail", type: "invoice.payment_failed", account: ACCT,
    data: { object: { id: "in_b101_fail", amount_due: 10000, customer: "cus_b101_a",
      parent: { subscription_details: { subscription: "sub_b101_a" } },
      lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 300 * 86400 }, pricing: { price_details: { recurring: { interval: "year" } } } }] } } } });
  const [subF] = await q(`SELECT status, next_dunning_at, failure_count FROM recurring_subscriptions WHERE id=$1`, [subA.id]);
  ok("§5 the failing membership card is past due with the dunning cadence queued", subF.status === "past_due" && subF.next_dunning_at && subF.failure_count >= 1, subF);
  ok("§5 …and the membership itself is untouched by the failure (its dates decide)",
     (await q(`SELECT status FROM memberships WHERE id=$1`, [annY2.id]))[0].status === "active");

  // ── §6 · the public read ──────────────────────────────────────────────────
  const pub = await fetch(`${BASE}/org/b101-onl/membership/${FAM}/public`).then(r => r.json());
  ok("§6 the public page shows the price, the benefits and the deductible part",
     pub.level && pub.level.price === 100 && pub.level.deductible === 75 && pub.level.autoRenew === true && pub.level.benefits.length === 1, pub);
  ok("§6 …and nothing about who holds it", !("members" in pub) && !("counts" in (pub.level || {})));
  ok("§6 another org's level is not reachable by this org's slug", (await fetch(`${BASE}/org/b101-onl/membership/${OTHER}/public`)).status === 404);

  await reset();
  mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
