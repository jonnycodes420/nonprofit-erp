// BUILD-63 Parts 3 & 4 — sibling-event ordering under REAL concurrency.
//
// The BUILD-62 defect was one instance of a class: a webhook handler reading
// state a SIBLING webhook writes, delivered concurrently. `stripe listen`
// serialises delivery, so no CLI drill surfaces this — these tests deliver the
// pairs REVERSED, SIMULTANEOUSLY (Promise.all), and RE-DELIVERED, and assert
// money never drops, duplicates, or misattributes.
//
// Covers:
//   Q1 — the one-time gift path is NOT affected by the race (it carries its own
//        email/metadata, no sibling dependency).
//   Q2 — the BUILD-62 fix produces exactly ONE recurring_subscriptions row and
//        ONE gift under both arrival orders + re-delivery (no duplicate).
//   Fix A — invoice.payment_failed pre-creating the sub row must not lose the
//        checkout's fund/campaign attribution (backfill).
//   Fix B — the recovery flip is a compare-and-swap: invoice.payment_succeeded
//        and customer.subscription.updated racing → exactly ONE 'recovered' log
//        and ONE donor thank-you.

const bcrypt = require("bcryptjs");
const http = require("http");
const Stripe = require("stripe");
const { BASE, ok, summary, q, closeDb } = require("./helpers");

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");
const ORG = "org_ord", ACCT = "acct_ord";

// customer id → email (the PI customer→donor fallback), subscription id → metadata.
const CUSTOMERS = { cus_a: "a@order.test", cus_b: "b@order.test", cus_s: "s@order.test" };
const SUBMETA = {
  sub_ordfail: { donor_email: "fail@order.test", donor_name: "Fay Fail", frequency: "monthly" },
};

let stripeMock, sink, mail = [];
function startStripeMock(port = 5603) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const cu = req.url.match(/^\/v1\/customers\/([^/?]+)/);
        if (req.method === "GET" && cu) { res.end(JSON.stringify({ id: cu[1], object: "customer", email: CUSTOMERS[cu[1]] || null, name: "Cust " + cu[1] })); return; }
        const su = req.url.match(/^\/v1\/subscriptions\/([^/?]+)/);
        if (req.method === "GET" && su) { res.end(JSON.stringify({ id: su[1], object: "subscription", status: "active", metadata: SUBMETA[su[1]] || {}, items: { data: [{ id: "si_x", price: { currency: "usd", product: "prod_x" } }] }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 })); return; }
        const iv = req.url.match(/^\/v1\/invoices\/([^/?]+)/);
        if (req.method === "GET" && iv) { res.end(JSON.stringify({ id: iv[1], object: "invoice", subscription: null })); return; }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
function startSink(port = 5602) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => { try { mail.push(JSON.parse(b)); } catch {} res.setHeader("Content-Type", "application/json"); res.end('{"id":"sunk"}'); });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
const mailTo = to => mail.filter(m => m.to === to || (Array.isArray(m.to) && m.to.includes(to)));

async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms));

// event builders
const piEvt = (id, pi) => ({ id, type: "payment_intent.succeeded", account: ACCT, data: { object: pi } });
const csEvt = (id, cs) => ({ id, type: "checkout.session.completed", account: ACCT, data: { object: { mode: "subscription", ...cs } } });
const invPaidEvt = (id, sub, amount) => ({ id, type: "invoice.payment_succeeded", account: ACCT, data: { object: { id: "in_" + id, amount_paid: amount, customer: "cus_rec", parent: { subscription_details: { subscription: sub } }, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } } } });
const invFailEvt = (id, sub, amount) => ({ id, type: "invoice.payment_failed", account: ACCT, data: { object: { id: "in_" + id, amount_due: amount, customer: "cus_ordfail", parent: { subscription_details: { subscription: sub, metadata: SUBMETA[sub] } }, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 25 * 86400 }, pricing: { price_details: { recurring: { interval: "month" } } } }] } } } });
const subUpdEvt = (id, sub, status) => ({ id, type: "customer.subscription.updated", account: ACCT, data: { object: { id: sub, status, items: { data: [{ id: "si_x", price: { currency: "usd", unit_amount: 500, product: "prod_x" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } } } });

const subCount = s => q("SELECT COUNT(*)::int n FROM recurring_subscriptions WHERE org_id=$1 AND stripe_subscription_id=$2", [ORG, s]).then(r => r[0].n);
const giftCount = p => q("SELECT COUNT(*)::int n FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2", [ORG, p]).then(r => r[0].n);
const donorCount = e => q("SELECT COUNT(*)::int n FROM donors WHERE org_id=$1 AND email ILIKE $2", [ORG, e]).then(r => r[0].n);

(async () => {
  stripeMock = await startStripeMock();
  sink = await startSink();

  for (const t of ["recurring_change_log", "recurring_subscriptions", "payment_recovery_events", "gifts",
    "interactions", "fin_transactions", "fin_funds", "accounts", "notification_sends", "tasks", "donors", "users"]) {
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  }
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,recurring_dunning_enabled)
           VALUES ($1,'Ordering Org','ord',1,'active','growth',$2,true)`, [ORG, ACCT]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_ord',$1,'Order Fund',true)`, [ORG]);
  // pre-existing donors for the failed-charge + recovery scenarios
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_fail',$1,'Fay Fail','fail@order.test','mid','steward',0,0)`, [ORG]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_rec',$1,'Rex Recover','rec@order.test','mid','steward',0,0)`, [ORG]);

  // ── Q2: recurring FIRST charge, both orders + re-delivery → one sub, one gift ─
  // Order A: PI arrives FIRST (the BUILD-62 race), then checkout.
  await fire(piEvt("evt_a_pi", { id: "pi_a", amount_received: 500, customer: "cus_a", metadata: {} }));
  await fire(csEvt("evt_a_cs", { id: "cs_a", customer_email: "a@order.test", customer: "cus_a", subscription: "sub_a", amount_total: 500, metadata: { donor_name: "Ada A", frequency: "monthly", fund_id: "fund_ord" } }));
  await settle();
  ok("Q2 order A (PI→checkout): exactly ONE gift and ONE subscription row",
    (await giftCount("pi_a")) === 1 && (await subCount("sub_a")) === 1, { g: await giftCount("pi_a"), s: await subCount("sub_a") });
  ok("Q2 order A: exactly ONE donor (PI fallback + checkout resolve don't split)", (await donorCount("a@order.test")) === 1);
  // re-deliver BOTH
  await fire(piEvt("evt_a_pi", { id: "pi_a", amount_received: 500, customer: "cus_a", metadata: {} }));
  await fire(csEvt("evt_a_cs", { id: "cs_a", customer_email: "a@order.test", customer: "cus_a", subscription: "sub_a", amount_total: 500, metadata: { donor_name: "Ada A", frequency: "monthly", fund_id: "fund_ord" } }));
  await settle();
  ok("Q2 order A re-delivered: still ONE gift, ONE sub, ONE donor",
    (await giftCount("pi_a")) === 1 && (await subCount("sub_a")) === 1 && (await donorCount("a@order.test")) === 1);

  // Order B: checkout FIRST, then PI (the row already exists).
  await fire(csEvt("evt_b_cs", { id: "cs_b", customer_email: "b@order.test", customer: "cus_b", subscription: "sub_b", amount_total: 700, metadata: { donor_name: "Bo B", frequency: "monthly", fund_id: "fund_ord" } }));
  await fire(piEvt("evt_b_pi", { id: "pi_b", amount_received: 700, customer: "cus_b", metadata: {} }));
  await settle();
  ok("Q2 order B (checkout→PI): exactly ONE gift and ONE subscription row",
    (await giftCount("pi_b")) === 1 && (await subCount("sub_b")) === 1);
  const [gb] = await q("SELECT fund_id, recurring_subscription_id FROM gifts WHERE stripe_payment_id='pi_b'");
  ok("Q2 order B: gift attributes to the sub's fund AND links to the sub (row existed first)",
    gb && gb.fund_id === "fund_ord" && gb.recurring_subscription_id != null, gb);

  // Simultaneous: fire both at once.
  await Promise.all([
    fire(piEvt("evt_s_pi", { id: "pi_s", amount_received: 900, customer: "cus_s", metadata: {} })),
    fire(csEvt("evt_s_cs", { id: "cs_s", customer_email: "s@order.test", customer: "cus_s", subscription: "sub_s", amount_total: 900, metadata: { donor_name: "Sy S", frequency: "monthly", fund_id: "fund_ord" } })),
  ]);
  await settle();
  ok("Q2 simultaneous (Promise.all): exactly ONE gift, ONE sub, ONE donor",
    (await giftCount("pi_s")) === 1 && (await subCount("sub_s")) === 1 && (await donorCount("s@order.test")) === 1,
    { g: await giftCount("pi_s"), s: await subCount("sub_s"), d: await donorCount("s@order.test") });

  // ── Q1: the one-time gift path is NOT affected (own email, no sibling dep) ──
  await fire(piEvt("evt_ot", { id: "pi_ot", amount_received: 2500, receipt_email: "once@order.test", metadata: { donor_name: "Otto Once" } }));
  await settle();
  ok("Q1 one-time PI (carries its own email) records the gift with no checkout at all",
    (await giftCount("pi_ot")) === 1 && (await donorCount("once@order.test")) === 1);
  ok("Q1 one-time gift creates NO recurring_subscriptions row (it is not recurring)",
    (await q("SELECT COUNT(*)::int n FROM recurring_subscriptions WHERE org_id=$1 AND donor_id=(SELECT id FROM donors WHERE org_id=$1 AND email='once@order.test')", [ORG]))[0].n === 0);

  // ── Fix A: failed-first-charge must not lose the checkout's fund attribution ─
  // invoice.payment_failed FIRST (pre-creates the row, NO attribution), then checkout.
  await fire(invFailEvt("evt_fail1", "sub_ordfail", 500));
  await settle(300);
  let [rf] = await q("SELECT fund_id, status FROM recurring_subscriptions WHERE stripe_subscription_id='sub_ordfail'");
  ok("Fix A precondition: invoice.payment_failed pre-created the row past_due with NO fund",
    rf && rf.status === "past_due" && rf.fund_id == null, rf);
  await fire(csEvt("evt_fail_cs", { id: "cs_fail", customer_email: "fail@order.test", customer: "cus_ordfail", subscription: "sub_ordfail", amount_total: 500, metadata: { donor_name: "Fay Fail", frequency: "monthly", fund_id: "fund_ord" } }));
  await settle();
  [rf] = await q("SELECT fund_id FROM recurring_subscriptions WHERE stripe_subscription_id='sub_ordfail'");
  ok("Fix A: checkout BACKFILLS the fund the race would otherwise have lost", rf && rf.fund_id === "fund_ord", rf);
  ok("Fix A: still exactly ONE subscription row for the sub (no duplicate)", (await subCount("sub_ordfail")) === 1);

  // ── Fix B: recovery flip is a CAS — the two events racing → one recovered ────
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,stripe_customer_id,amount,interval,status,failure_count,first_failed_at,last_failed_at,dunning_step)
           VALUES ('rs_rec',$1,'d_rec','sub_rec','cus_rec',5,'month','past_due',1,NOW(),NOW(),0)`, [ORG]);
  mail = [];
  await Promise.all([
    fire(invPaidEvt("evt_rec_inv", "sub_rec", 500)),
    fire(subUpdEvt("evt_rec_sub", "sub_rec", "active")),
  ]);
  await settle(700);
  const recLogs = (await q("SELECT COUNT(*)::int n FROM recurring_change_log WHERE subscription_id='rs_rec' AND kind='recovered'"))[0].n;
  const recEvents = (await q("SELECT COUNT(*)::int n FROM payment_recovery_events WHERE subscription_id='sub_rec' AND type='payment_recovered'"))[0].n;
  ok("Fix B: two recovery events racing → EXACTLY ONE 'recovered' movement-log row", recLogs === 1, { recLogs });
  ok("Fix B: EXACTLY ONE payment_recovered event (no double-count of recovered $)", recEvents === 1, { recEvents });
  ok("Fix B: the donor gets EXACTLY ONE recovery thank-you (never two)", mailTo("rec@order.test").length === 1, mailTo("rec@order.test").map(m => m.subject));
  const [recRow] = await q("SELECT status FROM recurring_subscriptions WHERE id='rs_rec'");
  ok("Fix B: the subscription ends 'recovered'", recRow.status === "recovered", recRow);

  if (stripeMock) stripeMock.close();
  if (sink) sink.close();
  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
