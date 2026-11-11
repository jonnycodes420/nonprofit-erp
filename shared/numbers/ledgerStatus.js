// shared/numbers/ledgerStatus.js · TRUTH-3 item 6. WHERE EVERY GIFT STANDS WITH THE BOOKS.
//
// The fleet (W-1107-Finance-39X) read "Not in the ledger: Gifts $1,711,572.50,
// 5,183 gifts", as if money were missing, and a fund backed by one gift said
// "No transactions". The standard CRM-to-general-ledger pattern: a gift
// recorded in the CRM posts to the books as revenue by fund, in batches per
// deposit. A gift brought in by a conversion import from a period the org's
// accounting system already closed is HISTORY: it never posts, because those
// books exist already. So every gift (money rows, money.js MONEY; a deleted
// person's gifts count toward nothing) is exactly one of:
//   posted    a ledger row (fin_transactions.gift_id) carries it
//   history   not posted, from an import, dated before this fiscal year
//   waiting   anything else not posted yet: ready to post with its deposit
// The three foot to every gift, in count and in cents.
"use strict";
const { MONEY, LIVE, GIFT } = require("./money");

const POSTED = (g = "g") => `EXISTS (SELECT 1 FROM fin_transactions ftp WHERE ftp.org_id = ${g}.org_id AND ftp.gift_id = ${g}.id)`;
// `fyFrom` is a bound parameter placeholder ("?") for the fiscal year's first day.
const HISTORY = (g = "g", fyFrom = "?") => `(NOT ${POSTED(g)} AND ${g}.import_id IS NOT NULL AND COALESCE(LEFT(${g}.date, 10), '') <> '' AND LEFT(${g}.date, 10) < ${fyFrom})`;
const STATUS = (g = "g", fyFrom = "?") => `CASE WHEN ${POSTED(g)} THEN 'posted' WHEN ${HISTORY(g, fyFrom)} THEN 'history' ELSE 'waiting' END`;

const SENTENCES = {
  posted: "Gifts the ledger carries: each posted as revenue to its fund.",
  waiting: "Gifts recorded in Steward that have not posted yet. Each posts with its deposit.",
  history: "Gifts brought in by an import from before this fiscal year. They are history only: those years' books are already in your accounting system, so they never post here.",
};

// { posted, waiting, history, all }: each { n, cents }.
async function ledgerSplit(query, orgId, fyFrom) {
  const rows = await query(
    // The count is gifts by the one rule (giftCount.js: above $0, not refunded in full; TRUTH-6); the money is every money row (a refund comes off).
    `SELECT s.status, COUNT(*) FILTER (WHERE s.counted)::int AS n, COALESCE(SUM(ROUND(s.amount * 100)), 0)::bigint AS cents FROM (
       SELECT g.amount, ${GIFT("g")} AS counted, ${STATUS("g")} AS status
         FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE g.org_id = ? AND ${LIVE("d")} AND ${MONEY("g")}) s
      GROUP BY s.status`, [fyFrom, orgId]);
  const out = { posted: { n: 0, cents: 0 }, waiting: { n: 0, cents: 0 }, history: { n: 0, cents: 0 } };
  for (const r of rows) out[r.status] = { n: Number(r.n) || 0, cents: Number(r.cents) || 0 };
  out.all = { n: out.posted.n + out.waiting.n + out.history.n, cents: out.posted.cents + out.waiting.cents + out.history.cents };
  return out;
}

module.exports = { POSTED, HISTORY, STATUS, SENTENCES, ledgerSplit };
