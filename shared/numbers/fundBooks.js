// shared/numbers/fundBooks.js · LEDGER-3 item 4. WHAT A FUND'S TWO NUMBERS ARE.
//
// Reports read `gifts.fund_id`; Finance read `fin_transactions`. They agreed
// only when every gift had posted, and on the demo 33 of 4,238 had, so a fund
// with six figures of receipts read $0. Each fund now says both, by name:
//
//   Received this fiscal year (gifts)  the gifts to the fund dated in the fiscal
//                                      year to today: Reports' Gifts by fund row
//                                      for the same days, to the cent (a split
//                                      gift is its line; soft and matching
//                                      credits are never money; refunds come off).
//   Balance (books)                    the ledger: everything in, less everything
//                                      out, all time (routes/finance.js).
//   Waiting to post                    gifts to the fund not on the books yet
//                                      (ledgerStatus.js `waiting`), any year. A
//                                      gift with no fund posts to the org's
//                                      default fund, so it waits there.
"use strict";
const { MONEY, LIVE } = require("./money");
const { COUNTED } = require("./giftCount");
const { GIFT_FUND_ROWS } = require("./fundLines");
const LS = require("./ledgerStatus");

const SENTENCES = {
  received: "Gifts to this fund dated in this fiscal year, to today: the same figure as this fund's row in Reports' Gifts by fund. Refunds come off; soft and matching credits are never money.",
  balance: "The books: everything posted into this fund, less everything spent from it, in every year.",
  waiting: "Gifts to this fund that are not on the books yet. Post them from Overview, under Post to the books.",
};

// Map fundId → { receivedCents, receivedCount, waitingCents, waitingCount }.
// Also `noFund`: this year's gifts that name no fund. `defaultId` is the org's
// default fund (defaultFund.js), where a no-fund waiting gift will post.
async function fundBooks(query, orgId, { from, to, fyFrom, defaultId }) {
  const [received, waiting] = await Promise.all([
    query(
      `SELECT gf.fund_id, COALESCE(SUM(ROUND(gf.amount * 100)), 0)::bigint AS cents,
              COUNT(*) FILTER (WHERE ${COUNTED("g")})::int AS n
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id
        WHERE g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")} AND g.date >= ? AND g.date <= ?
        GROUP BY gf.fund_id`, [orgId, from, to]),
    query(
      `SELECT COALESCE(gf.fund_id, ?::text) AS fund_id, COALESCE(SUM(ROUND(gf.amount * 100)), 0)::bigint AS cents,
              COUNT(*) FILTER (WHERE ${COUNTED("g")})::int AS n
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id
        WHERE ${LS.STATUS("g")} = 'waiting' AND g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}
        GROUP BY 1`, [defaultId || null, fyFrom, orgId]),
  ]);
  const out = new Map();
  const row = id => { if (!out.has(id)) out.set(id, { receivedCents: 0, receivedCount: 0, waitingCents: 0, waitingCount: 0 }); return out.get(id); };
  let noFund = { cents: 0, n: 0 };
  for (const r of received) {
    if (!r.fund_id) { noFund = { cents: Number(r.cents), n: Number(r.n) }; continue; }
    Object.assign(row(r.fund_id), { receivedCents: Number(r.cents), receivedCount: Number(r.n) });
  }
  for (const r of waiting) if (r.fund_id) Object.assign(row(r.fund_id), { waitingCents: Number(r.cents), waitingCount: Number(r.n) });
  out.noFund = noFund;
  return out;
}

module.exports = { SENTENCES, fundBooks };
