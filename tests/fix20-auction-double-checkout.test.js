// tests/fix20-auction-double-checkout.test.js · FIX-20 Part 1. ONE ITEM, ONE PAID WINNER.
//
// Two checkouts opened at the same moment for one auction item could both be
// paid, and each payment arrived at the webhook with its own payment intent,
// so the gift's Stripe key could not tell them apart: two gifts, two receipts,
// one item. This pins:
//
//   1. A SECOND CHECKOUT CLOSES THE FIRST. Opening a new checkout for an item
//      expires the earlier one in Stripe while it is still open, and is refused
//      outright once the earlier one is complete (its payment is on its way).
//   2. TWO COMPLETIONS ARRIVING TOGETHER RECORD EXACTLY ONE GIFT. The other
//      payment records no gift and is flagged for a refund on the staff screen,
//      with its exact Stripe payment id. Steward never calls a refund.
//   3. THE ITEM'S TOTAL IS THE WINNING BID TO THE CENT, and a redelivery of
//      either event changes nothing.
//
// HOW IT WOULD GO RED. Remove the claim UPDATE in routes/webhooks.js (the
// `paid_payment_id` CASE) and §2 records two gifts; drop the expire call in
// donateHandler and §1 goes red. Both were planted and watched fail.
//
// It runs against the scratch server + scratch Postgres, never production.
const http = require("http");
const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const ORG = "org_fix20auc", ACCT = "acct_fix20auc", SLUG_ORG = "fix20-auction-test";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");

// A Stripe stand-in that knows three verbs on a checkout session.
const sessions = new Map();   // id -> { status, metadata, unitAmount }
const calls = [];
let mock;
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        const path = req.url.split("?")[0];
        let m;
        if (req.method === "POST" && (m = /^\/v1\/checkout\/sessions\/([^/]+)\/expire$/.exec(path))) {
          calls.push({ verb: "expire", id: m[1] });
          const s = sessions.get(m[1]);
          if (s) s.status = "expired";
          return res.end(JSON.stringify({ id: m[1], object: "checkout.session", status: "expired" }));
        }
        if (req.method === "GET" && (m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(path))) {
          calls.push({ verb: "retrieve", id: m[1] });
          const s = sessions.get(m[1]);
          return res.end(JSON.stringify({ id: m[1], object: "checkout.session", status: s ? s.status : "expired" }));
        }
        if (req.method === "POST" && path === "/v1/checkout/sessions") {
          const p = new URLSearchParams(b);
          const id = "cs_test_" + Math.random().toString(36).slice(2, 12);
          const metadata = Object.fromEntries([...p.entries()].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v]));
          sessions.set(id, { status: "open", metadata, unitAmount: Number(p.get("line_items[0][price_data][unit_amount]")) });
          calls.push({ verb: "create", id });
          return res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
        }
        if (/\/refunds/.test(path)) calls.push({ verb: "refund" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    srv.on("error", () => resolve(null));
    srv.listen(port, () => resolve(srv));
  });
}
async function fire(evt) {
  const payload = JSON.stringify(evt);
  const header = stripeLib.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const settle = (ms = 1500) => new Promise(r => setTimeout(r, ms));

async function reset() {
  for (const t of ["auction_refund_flags", "auction_bidder_devices", "auction_bids", "auction_bidders", "auction_items", "auctions",
    "milestone_drafts", "receipts", "fin_audit_log", "fin_transactions", "gift_soft_credits", "gifts", "interactions", "tasks",
    "threads", "workflow_runs", "notification_sends"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "fin_funds", "accounts", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
async function seed() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,
                             stripe_account_id,stripe_connected,legal_name,ein,receipt_address,receipts_enabled)
           VALUES ($1,'Double Checkout Trust',$2,1,'active','growth','America/New_York',$3,true,
                   'Double Checkout Trust Inc.','12-3456780','2 Test Way, Testville',true)`, [ORG, SLUG_ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_fix20auc',$1,'fix20auc@test.local',$2,'Auction Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acc_fix20auc',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_fix20auc',$1,'General',false)`, [ORG]);
}
const formPost = (path, body, cookie) => fetch(BASE + path, {
  method: "POST", redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
  body: new URLSearchParams(body).toString(),
});
const cents = v => Math.round(Number(v) * 100);
const piEvent = (n, metadata) => ({ id: "evt_fix20auc_" + n, type: "payment_intent.succeeded", account: ACCT,
  data: { object: { id: "pi_fix20auc_" + n, object: "payment_intent", amount: 25010, amount_received: 25010, currency: "usd",
    receipt_email: "ada@fix20auc.test", metadata: { ...metadata, org_id: ORG } } } });

(async () => {
  console.log("FIX-20 Part 1: two checkouts for one auction item record one gift\n");
  mock = await startStripeMock();
  ok("the Stripe mock is listening (without it nothing below proves anything)", !!mock);
  await reset();
  await seed();
  const tok = (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "fix20auc@test.local", password: "loadtest1234" }) })).json()).token;
  ok("staff signed in", !!tok);

  const mk = await api("POST", "/auctions", tok, { title: "Harvest auction", opensLocal: "2026-01-01T09:00", closesLocal: "2026-01-02T09:00" });
  const AUC = mk.body.id, SLUG = mk.body.publicSlug;
  await q(`UPDATE auctions SET opens_at = NOW() - INTERVAL '1 hour', closes_at = NOW() + INTERVAL '1 hour' WHERE id=$1`, [AUC]);
  const it = await api("POST", `/auctions/${AUC}/items`, tok, { title: "A painted oar", fmv: "150.37", startingBid: "100", bidIncrement: "10" });
  const ITEM = it.body.id;
  ok("an auction with one item", !!(AUC && ITEM), { mk: mk.body, it: it.body });
  const reg = await formPost(`/auction/${SLUG}/register`, { name: "Ada Quillfeather", email: "ada@fix20auc.test", phone: "555-010-2000" });
  const cookie = (reg.headers.get("set-cookie") || "").split(";")[0];
  const bid = await formPost(`/auction/${SLUG}/bid`, { itemId: ITEM, amount: "250.10" }, cookie);
  ok("Ada bids $250.10", /m=bid/.test(bid.headers.get("location") || ""), bid.headers.get("location"));
  await q(`UPDATE auctions SET closes_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [AUC]);
  const view = await api("GET", `/auctions/${AUC}`, tok);
  const payPath = new URL(view.body.items[0].winner.payUrl).pathname;

  // ── 1. A SECOND CHECKOUT CLOSES THE FIRST ─────────────────────────────────
  const p1 = await formPost(payPath, {});
  const cs1 = calls.filter(c => c.verb === "create").map(c => c.id)[0];
  ok("the first Pay opens a checkout", p1.status === 303 && /checkout\.stripe\.test/.test(p1.headers.get("location") || "") && !!cs1);
  const p2 = await formPost(payPath, {});
  const creates = calls.filter(c => c.verb === "create").map(c => c.id);
  ok("a second Pay opens a second checkout…", p2.status === 303 && creates.length === 2, creates);
  ok("…and the first one is expired in Stripe so it can no longer take a card",
    calls.some(c => c.verb === "expire" && c.id === cs1) && sessions.get(cs1).status === "expired", calls);
  sessions.get(creates[1]).status = "complete";
  const p3 = await formPost(payPath, {});
  ok("once a checkout is complete, a third Pay is refused before any checkout opens",
    /m=pay_in_progress/.test(p3.headers.get("location") || "") && calls.filter(c => c.verb === "create").length === 2,
    p3.headers.get("location"));

  // ── 2. TWO COMPLETIONS ARRIVING TOGETHER ──────────────────────────────────
  // Both checkouts were paid before the first expire reached Stripe: the worst
  // case, which only the webhook can catch.
  const meta = sessions.get(cs1).metadata;
  const [sA, sB] = await Promise.all([fire(piEvent("A", meta)), fire(piEvent("B", meta))]);
  ok("both webhook deliveries are answered 200", sA === 200 && sB === 200, { sA, sB });
  await settle(2500);
  const gifts = await q(`SELECT id, amount::text AS amount, stripe_payment_id FROM gifts WHERE org_id=$1 AND stripe_payment_id IN ('pi_fix20auc_A','pi_fix20auc_B')`, [ORG]);
  ok("EXACTLY ONE GIFT is recorded for the item", gifts.length === 1, gifts);
  const flags = await q(`SELECT stripe_payment_id, amount::text AS amount, payer_email, kept_payment_id, created_by FROM auction_refund_flags WHERE org_id=$1 AND item_id=$2`, [ORG, ITEM]);
  const loser = gifts[0] && (gifts[0].stripe_payment_id === "pi_fix20auc_A" ? "pi_fix20auc_B" : "pi_fix20auc_A");
  ok("the other payment is flagged for a refund, by its exact Stripe id and amount",
    flags.length === 1 && flags[0].stripe_payment_id === loser && cents(flags[0].amount) === 25010
      && flags[0].kept_payment_id === gifts[0].stripe_payment_id && /^system:/.test(flags[0].created_by), flags);
  ok("Steward asked Stripe for no refund", !calls.some(c => c.verb === "refund"), calls);
  const staff = await api("GET", `/auctions/${AUC}`, tok);
  ok("the staff screen shows the payment to refund, and says Steward does not refund",
    (staff.body.refundFlags || []).some(f => f.stripe_payment_id === loser && f.amount === 250.1)
      && /Refund this in Stripe; Steward does not refund on its own/.test(staff.body.refundSentence || ""), staff.body.refundFlags);

  // ── 3. THE ITEM FOOTS, AND REDELIVERY CHANGES NOTHING ─────────────────────
  await Promise.all([fire(piEvent("A", meta)), fire(piEvent("B", meta))]);
  await settle(2000);
  const [tot] = await q(`SELECT COALESCE(SUM(amount),0)::text AS total, COUNT(*)::int AS n FROM gifts WHERE org_id=$1 AND stripe_payment_id LIKE 'pi_fix20auc_%'`, [ORG]);
  ok("THE ITEM'S TOTAL IS THE WINNING BID, $250.10 TO THE CENT, after both events are redelivered",
    cents(tot.total) === 25010 && tot.n === 1, tot);
  const [fl] = await q(`SELECT COUNT(*)::int AS n FROM auction_refund_flags WHERE org_id=$1`, [ORG]);
  ok("…and still one refund flag", fl.n === 1, fl);
  const [paid] = await q(`SELECT paid_gift_id FROM auction_items WHERE id=$1`, [ITEM]);
  ok("the item is marked paid by the one gift", paid && gifts[0] && paid.paid_gift_id === gifts[0].id, paid);

  await reset();
  if (mock) mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); if (mock) mock.close(); process.exit(1); });
