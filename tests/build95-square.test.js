// BUILD-95 §5A — READING AN ORGANISATION'S SQUARE.
//
// The API half is ordinary. The half worth testing is the one that is
// different from every other provider Steward reads:
//
//   SQUARE IS A POINT OF SALE. A lesson fee and a donation are the same shape
//   to it. Importing a $45 lesson as a charitable gift inflates a giving
//   total, lands on a lifetime figure, moves Drift, and can reach a tax
//   receipt. So Steward REFUSES TO GUESS — and says so out loud rather than
//   importing nothing quietly, which reads as "Square had no donations".
//
// Pure unit test of the adapter: no server, no DB, no network.
const path = require("path");
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 300) : "")); }
};

const sq = require(path.join(__dirname, "..", "sources", "square.js"));

// A Square payment, as the API sends it. Amounts in MINOR UNITS.
const payment = (over = {}) => ({
  id: "sqp_1", created_at: "2026-09-18T15:04:00Z", status: "COMPLETED",
  location_id: "L_BARN", source_type: "CARD",
  total_money: { amount: 25000, currency: "USD" },
  amount_money: { amount: 25000, currency: "USD" },
  processing_fee: [{ amount_money: { amount: 755, currency: "USD" } }],
  buyer_email_address: "margaret@example.org",
  note: "Donation - Stable Moments",
  ...over,
});

(async () => {
  console.log("— minor units, which is the 100x mistake —");
  const r = sq.mapPayment(payment(), { config: { locationIds: ["L_BARN"] } });
  ok("a $250.00 Square payment is 25000 cents, not 2500000",
    r.row && r.row.amountCents === 25000, r.row && r.row.amountCents);
  ok("the processing fee is minor units too", r.row.feeCents === 755, r.row.feeCents);
  ok("the date is the civil day", r.row.occurredAt === "2026-09-18", r.row.occurredAt);
  ok("the buyer's email comes through", r.row.donorEmail === "margaret@example.org");
  ok("total_money wins over amount_money, so a tip is not dropped",
    sq.mapPayment(payment({ total_money: { amount: 26000 }, amount_money: { amount: 25000 } }),
      { config: { locationIds: ["L_BARN"] } }).row.amountCents === 26000);

  console.log("— Square has no recurring, and does not pretend to —");
  ok("no payment claims a recurring reference", r.row.recurringRef === null);
  const { PROVIDERS } = await import("../shared/givingSources.js");
  ok("the registry marks Square inferred, never exact", PROVIDERS.square.recurring === "inferred");

  console.log("— THE GATE: Steward refuses to guess what a donation is —");
  const noGate = sq.mapPayment(payment(), { config: {} });
  ok("with no gate set, NOTHING is imported", noGate.drop === "no_gate_configured", noGate);
  ok("…and with no config object at all, still nothing", sq.mapPayment(payment()).drop === "no_gate_configured");
  const wrongLoc = sq.mapPayment(payment({ location_id: "L_SHOP" }), { config: { locationIds: ["L_BARN"] } });
  ok("a payment at a location that is not giving is left alone", wrongLoc.drop === "other_location", wrongLoc);
  ok("a payment at a giving location comes in",
    sq.mapPayment(payment(), { config: { locationIds: ["L_BARN"] } }).row !== undefined);

  console.log("— …or by the wording the org uses on its donation items —");
  ok("a note that carries the phrase comes in",
    sq.mapPayment(payment({ note: "Donation - fall appeal" }), { config: { onlyNoteContains: "donation" } }).row !== undefined);
  ok("a lesson fee does not",
    sq.mapPayment(payment({ note: "Riding lesson - 45 min" }), { config: { onlyNoteContains: "donation" } }).drop === "phrase_not_found");
  ok("the phrase match is case-insensitive",
    sq.mapPayment(payment({ note: "DONATION" }), { config: { onlyNoteContains: "donation" } }).row !== undefined);
  ok("both gates together must BOTH pass",
    sq.mapPayment(payment({ location_id: "L_BARN", note: "Hay" }),
      { config: { locationIds: ["L_BARN"], onlyNoteContains: "donation" } }).drop === "phrase_not_found");

  console.log("— what is not money in —");
  const g = { config: { locationIds: ["L_BARN"] } };
  ok("an APPROVED (authorised, not captured) payment is not a gift yet",
    sq.mapPayment(payment({ status: "APPROVED" }), g).drop === "pending");
  ok("a FAILED payment is a failed row, not a gift",
    sq.mapPayment(payment({ status: "FAILED" }), g).row.status === "failed");
  ok("a fully refunded payment is refunded",
    sq.mapPayment(payment({ refunded_money: { amount: 25000 } }), g).row.status === "refunded");
  ok("a partial refund is still a completed gift",
    sq.mapPayment(payment({ refunded_money: { amount: 500 } }), g).row.status === "completed");
  ok("a bank transfer between the org's own accounts is never a gift",
    sq.mapPayment(payment({ source_type: "BANK_ACCOUNT_TRANSFER" }), g).drop === "not_money_in");
  ok("a zero payment is not a gift", sq.mapPayment(payment({ total_money: { amount: 0 }, amount_money: { amount: 0 } }), g).drop === "not_money_in");
  ok("a payment with no id is dropped, never guessed at", sq.mapPayment(payment({ id: "" }), g).drop === "no_external_id");

  console.log("— the silence that would have been the real bug —");
  // A Square account with no gate imports nothing. If that were silent it
  // would read as "Square had no donations", which is a different and much
  // more comforting untruth.
  const http = { json: async () => ({ ok: true, status: 200, body: { payments: [payment(), payment({ id: "sqp_2" })] } }) };
  const out = await sq.fetchRows({ credentials: { accessToken: "t" }, http, today: "2026-09-22", config: {} });
  ok("no rows come back", out.rows.length === 0);
  ok("…and a notice SAYS SO, naming the reason",
    out.notices.some(n => /imported none of them/i.test(n) && /point-of-sale/i.test(n)), out.notices);
  ok("…and it tells them what to do about it",
    out.notices.some(n => /which Square locations/i.test(n)), out.notices);

  const out2 = await sq.fetchRows({ credentials: { accessToken: "t" }, http, today: "2026-09-22",
                                    config: { locationIds: ["L_BARN"] } });
  ok("with the gate set, the same payments come in", out2.rows.length === 2, out2.rows.length);

  console.log("— the request is a GET, and carries a pinned API version —");
  const seen = [];
  const spyHttp = { json: async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200, body: { payments: [] } }; } };
  await sq.fetchRows({ credentials: { accessToken: "tok" }, http: spyHttp, today: "2026-09-22", since: "2026-09-01", config: { locationIds: ["L"] } });
  ok("it calls /v2/payments", /\/v2\/payments\?/.test(seen[0].url), seen[0].url);
  ok("…with begin_time from `since`", /begin_time=2026-09-01/.test(decodeURIComponent(seen[0].url)), seen[0].url);
  ok("…a Bearer token", seen[0].opts.headers.Authorization === "Bearer tok");
  ok("…and a PINNED Square-Version, never whatever is current",
    /^\d{4}-\d{2}-\d{2}$/.test(seen[0].opts.headers["Square-Version"]), seen[0].opts.headers);

  console.log("— paging —");
  ok("a cursor in the body is the next cursor", sq.nextCursor({ cursor: "abc" }) === "abc");
  ok("an absent cursor means done", sq.nextCursor({}) === null && sq.nextCursor({ cursor: "" }) === null);

  console.log(`\nbuild95-square: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
