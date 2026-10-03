// tests/parity2-auction.test.js · PARITY-2 Part 4. THE ONE GUARD AUCTIONS EARNED.
//
// An auction is money and a tax document, so three things are pinned:
//
//   1. TIES GO TO THE EARLIEST BID. Two bids at the same amount award the one
//      placed first, on the staff screen and in the pay link; and two people
//      pressing Bid at the same amount at the same moment get ONE high bid.
//   2. A BID AFTER THE CLOSE IS REFUSED, by the server's clock, and writes
//      nothing.
//   3. THE WINNER'S RECEIPT STATES THE DEDUCTIBLE PART as the winning bid
//      minus the item's fair market value, to the cent, through the one gift
//      path (the donation checkout, the webhook, recordGift, issueGiftReceipt).
//
// HOW IT WOULD GO RED. Order the top bid by created_at DESC in auctionCore's
// TOP_BIDS_SQL (§1 goes red); drop the `closed` refusal from POST
// /auction/:slug/bid (§2 goes red); drop the auction quid pro quo from the
// webhook, or price the checkout from the page (§3 goes red). Each was
// planted and watched fail before this suite was trusted.
//
// It runs against the scratch server + scratch Postgres, never production.
const http = require("http");
const Stripe = require("stripe");
const bcrypt = require("bcryptjs");
const { BASE, ok, summary, api, q, closeDb, STRIPE_MOCK_PORT } = require("./helpers");

const ORG = "org_par2auc", ACCT = "acct_par2auc", SLUG_ORG = "par2-auction-test";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
const stripeLib = new Stripe("sk_test_dummy");

const seen = [];
let mock;
function startStripeMock(port = STRIPE_MOCK_PORT) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", c => b += c);
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (/\/v1\/checkout\/sessions/.test(req.url) && req.method === "POST") {
          const p = new URLSearchParams(b);
          const id = "cs_test_" + Math.random().toString(36).slice(2, 12);
          seen.push({ id, unitAmount: Number(p.get("line_items[0][price_data][unit_amount]")),
                      email: p.get("customer_email"),
                      metadata: Object.fromEntries([...p.entries()]
                        .filter(([k]) => k.startsWith("metadata["))
                        .map(([k, v]) => [k.slice(9, -1), v])) });
          res.end(JSON.stringify({ id, object: "checkout.session", url: "https://checkout.stripe.test/" + id }));
          return;
        }
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
const settle = (ms = 1200) => new Promise(r => setTimeout(r, ms));

async function reset() {
  for (const t of ["auction_bids", "auction_bidders", "auction_items", "auctions", "milestone_drafts", "receipts",
    "fin_audit_log", "fin_transactions", "gift_soft_credits", "gifts", "interactions", "tasks", "threads", "workflow_runs", "notification_sends"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  for (const t of ["donors", "fin_funds", "accounts", "users"]) await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
}
async function seed() {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone,
                             stripe_account_id,stripe_connected,legal_name,ein,receipt_address,receipts_enabled)
           VALUES ($1,'Auction Test Trust',$2,1,'active','growth','America/New_York',$3,true,
                   'Auction Test Trust Inc.','12-3456789','1 Test Way, Testville',true)`, [ORG, SLUG_ORG, ACCT]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_par2auc',$1,'par2auc@test.local',$2,'Auction Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acc_par2auc',$1,'4010','Contributions','revenue')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_par2auc',$1,'General',false)`, [ORG]);
}

const formPost = (path, body, cookie) => fetch(BASE + path, {
  method: "POST", redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) },
  body: new URLSearchParams(body).toString(),
});
const codeOf = r => new URL(r.headers.get("location") || "/", "http://x").searchParams.get("m");
const cents = v => Math.round(Number(v) * 100);
const bidsOn = itemId => q(`SELECT id, bidder_id, amount::text AS amount FROM auction_bids WHERE org_id=$1 AND item_id=$2 ORDER BY created_at, id`, [ORG, itemId]);

(async () => {
  console.log("PARITY-2 Part 4 — ties go to the earliest bid, the close is the close, and the receipt foots\n");
  mock = await startStripeMock();
  ok("the Stripe mock is listening (without it §3 proves nothing)", !!mock);
  await reset();
  await seed();
  const tok = (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "par2auc@test.local", password: "loadtest1234" }) })).json()).token;
  ok("staff signed in", !!tok);

  // An auction that is open now, and one item: $150.37 of value, bidding from $100.
  const mk = await api("POST", "/auctions", tok, { title: "Spring auction", opensLocal: "2026-01-01T09:00", closesLocal: "2026-01-02T09:00" });
  ok("an auction is created", mk.status === 200 && mk.body.id, mk.body);
  const AUC = mk.body.id, SLUG = mk.body.publicSlug;
  await q(`UPDATE auctions SET opens_at = NOW() - INTERVAL '1 hour', closes_at = NOW() + INTERVAL '1 hour' WHERE id=$1`, [AUC]);
  const it = await api("POST", `/auctions/${AUC}/items`, tok, { title: "A week at the lake house", category: "Getaways",
    fmv: "150.37", startingBid: "100", bidIncrement: "10" });
  ok("an item is added", it.status === 200 && it.body.id, it.body);
  const ITEM = it.body.id;

  // Two bidders register on the public page.
  const reg = async (name, email) => {
    const r = await formPost(`/auction/${SLUG}/register`, { name, email, phone: "555-010-2000" });
    const sc = r.headers.get("set-cookie") || "";
    return { code: codeOf(r), cookie: sc.split(";")[0] };
  };
  const A = await reg("Ada Quillfeather", "ada@par2auc.test");
  const B = await reg("Bo Marchbanks", "bo@par2auc.test");
  ok("both bidders are registered and hold a session", A.code === "registered" && B.code === "registered" && /stw_auc_/.test(A.cookie) && /stw_auc_/.test(B.cookie), { A, B });
  const [bA] = await q(`SELECT id, donor_id FROM auction_bidders WHERE org_id=$1 AND LOWER(email)='ada@par2auc.test'`, [ORG]);
  const [bB] = await q(`SELECT id FROM auction_bidders WHERE org_id=$1 AND LOWER(email)='bo@par2auc.test'`, [ORG]);
  ok("each bidder is a person on the one person table", !!(bA && bA.donor_id) &&
    (await q(`SELECT id FROM donors WHERE id=$1 AND org_id=$2`, [bA.donor_id, ORG])).length === 1);

  // ── 1a. THE SAME AMOUNT AT THE SAME MOMENT IS ONE HIGH BID ────────────────
  const [rA, rB] = await Promise.all([
    formPost(`/auction/${SLUG}/bid`, { itemId: ITEM, amount: "100" }, A.cookie),
    formPost(`/auction/${SLUG}/bid`, { itemId: ITEM, amount: "100" }, B.cookie),
  ]);
  const codes = [codeOf(rA), codeOf(rB)].sort();
  ok("two simultaneous $100 bids: one is the high bid, the other is told someone bid first",
    codes[0] === "bid" && codes[1] === "too_low", codes);
  ok("…and exactly one bid row was written", (await bidsOn(ITEM)).length === 1, await bidsOn(ITEM));

  // ── 1b. EQUAL BIDS: THE EARLIER ONE WINS ──────────────────────────────────
  // Two bids at $250.10, Ada's one second before Bo's. Written directly: the
  // bid route refuses an equal bid by design (1a), so a tie can only arise
  // from the room (a clerk keying paddles) or a race the lock lost.
  await q(`INSERT INTO auction_bids (id,org_id,auction_id,item_id,bidder_id,amount,created_at,created_by,created_by_name) VALUES
           ('abid_par2_a',$1,$2,$3,$4,250.10, NOW() - INTERVAL '20 seconds','system:test','test'),
           ('abid_par2_b',$1,$2,$3,$5,250.10, NOW() - INTERVAL '19 seconds','system:test','test')`, [ORG, AUC, ITEM, bA.id, bB.id]);

  // ── 2. A BID AFTER THE CLOSE IS REFUSED ───────────────────────────────────
  await q(`UPDATE auctions SET closes_at = NOW() - INTERVAL '1 second' WHERE id=$1`, [AUC]);
  const before = (await bidsOn(ITEM)).length;
  const late = await formPost(`/auction/${SLUG}/bid`, { itemId: ITEM, amount: "900" }, B.cookie);
  ok("a bid one second after the close is refused", codeOf(late) === "closed", codeOf(late));
  ok("…and writes no bid", (await bidsOn(ITEM)).length === before, await bidsOn(ITEM));

  const view = await api("GET", `/auctions/${AUC}`, tok);
  const item = (view.body.items || []).find(i => i.id === ITEM);
  ok("the staff screen awards the tie to the EARLIER bid (Ada, $250.10)",
    item && item.closed && item.winner && /Ada/.test(item.winner.name) && item.winner.amount === 250.1, item && item.winner);

  // ── 3. THE WINNER PAYS, AND THE RECEIPT FOOTS ────────────────────────────
  const payPath = new URL(item.winner.payUrl).pathname;
  const pg = await fetch(BASE + payPath);
  const pgText = await pg.text();
  ok("the pay page opens for the winner and names the amount", pg.status === 200 && /Pay \$250\.10/.test(pgText), pg.status);
  ok("…and opening it wrote nothing", (await q(`SELECT paid_gift_id FROM auction_items WHERE id=$1`, [ITEM]))[0].paid_gift_id === null);
  seen.length = 0;
  const pay = await formPost(payPath, { amount: "1" });
  ok("paying sends the winner to Stripe", pay.status === 303 && /checkout\.stripe\.test/.test(pay.headers.get("location") || ""), pay.headers.get("location"));
  const cs = seen[0];
  ok("the charge is the winning bid, priced by the server ($250.10), to the winner's own email",
    cs && cs.unitAmount === 25010 && cs.email === "ada@par2auc.test", cs);
  ok("…and the item and the winning bid ride the metadata", cs && cs.metadata.auction_item_id === ITEM && cs.metadata.auction_bid_id === "abid_par2_a", cs && cs.metadata);

  await fire({ id: "evt_par2auc_1", type: "payment_intent.succeeded", account: ACCT,
    data: { object: { id: "pi_par2auc_1", object: "payment_intent", amount: 25010, amount_received: 25010, currency: "usd",
      receipt_email: "ada@par2auc.test", metadata: { ...cs.metadata, org_id: ORG } } } });
  await settle(2500);
  const [g] = await q(`SELECT id, donor_id, amount::text AS amount, quid_pro_quo_value::text AS qpq, deductible_amount::text AS ded
                         FROM gifts WHERE org_id=$1 AND stripe_payment_id='pi_par2auc_1'`, [ORG]);
  ok("the payment is one gift on the winner's own record", g && g.donor_id === bA.donor_id && g.amount === "250.10", g);
  ok("…carrying the item's fair market value as the quid pro quo ($150.37)", g && g.qpq === "150.37", g);
  const [rc] = g ? await q(`SELECT amount::text AS amount, deductible_amount::text AS ded FROM receipts WHERE gift_id=$1 AND voided_at IS NULL`, [g.id]) : [];
  ok("THE RECEIPT STATES $99.73 DEDUCTIBLE: the winning bid less the fair market value, to the cent",
    rc && cents(rc.amount) === 25010 && cents(rc.ded) === 9973, rc);
  const [paid] = await q(`SELECT paid_gift_id FROM auction_items WHERE id=$1`, [ITEM]);
  ok("the item is marked paid by that gift", paid && g && paid.paid_gift_id === g.id, paid);

  await reset();
  if (mock) mock.close();
  await closeDb();
  summary();
})().catch(async e => { console.error(e); if (mock) mock.close(); process.exit(1); });
