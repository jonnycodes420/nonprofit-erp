// shared/numbers/giftCount.js · TRUTH-3. ONE RULE FOR COUNTING A GIFT.
//
// A gift is COUNTED when it is a hard-credit gift with an amount above zero
// (money.js GIFT). A $0 row, a refund, and a soft or matching credit row show
// in history, labeled, but are never counted, averaged or receipted. The fleet
// (W-1107-Donors-21X) found a $0 soft-credit row counted 7 in one place and 6
// in another, "1 gift" beside "no gifts yet" for the same year in By year, and
// an average over 502 under a headline of 503. Every count, average, export
// and the By year view reads this file.
"use strict";
const { GIFT, isGift, isMoney, centsOf: centsOfRow } = require("./money");

// SQL: gift row `g` is counted.
const COUNTED = (g = "g") => GIFT(g);
// SQL: how many gifts person `d` has on file, by the rule.
const GIFT_COUNT = (d = "d") => `(SELECT COUNT(*)::int FROM gifts gc WHERE gc.org_id = ${d}.org_id AND gc.donor_id = ${d}.id AND ${COUNTED("gc")})`;
// TRUTH-5 (W-1109-Finance-35X): the ONE count a person's gifts are said as,
// wherever a person's count shows: the Directory's column, its sort and filter,
// the profile, Top donors, Atlas. The Directory read the stored rollup (an
// import's stated "6 gifts" beside a Giving tab of 5 rows). It is the gifts on
// file that count (above), so the number always opens to its rows. An old
// system's stated count stays its own fact, on Before Steward.
const DONOR_GIFT_COUNT = GIFT_COUNT;
// JS: a row already read ({ amount | cents, type | gift_type }) is counted.
const isCounted = r => isGift(r);
const countOf = rows => (rows || []).filter(isCounted).length;
// The average gift: counted gifts only, over the same count the headline says.
const averageCents = rows => { const c = (rows || []).filter(isCounted); return c.length ? Math.round(c.reduce((n, r) => n + require("./money").centsOf(r), 0) / c.length) : 0; };

// Counted gifts per person: Map id -> n.
async function giftCounts(query, orgId, ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(`SELECT d.id, ${GIFT_COUNT("d")} AS n FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[])`, [orgId, ids]);
  return new Map(rows.map(r => [r.id, Number(r.n) || 0]));
}

// TRUTH-4 · THE WORDS FOR A $0 ROW. Listed in history with this label; a list
// whose rows are counted leaves it out and says the line below instead.
const ZERO_LABEL = require("../giftWords.js").ZERO_GIFT_LABEL;
const alsoOnFile = n => (n > 0 ? `Also on file: ${n} $0 ${n === 1 ? "record" : "records"}, not counted.` : "");
const isZero = r => isMoney(r) && centsOfRow(r) === 0;

// SQL: how many $0 rows a gift-row filter (figureSources giftsWhere's `where`,
// on gifts g / donors d / fin_funds f, three leading args: org, from, to) would
// have listed. The `gifts` source says them as alsoOnFile.
function zeroOnFileSql(where, args, byFund) {
  const { NOT_CREDIT } = require("../../creditTypes");
  const { GIFT_FUND_ROWS } = require("./fundLines");
  const w = where.replace(` AND ${COUNTED("g")}`, "").replace(" AND g.amount > 0", "").replace(" AND g.amount <> 0", "") + " AND g.amount = 0";
  return { sql: `SELECT COUNT(DISTINCT g.id)::int AS n FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
                ${byFund ? `JOIN ${GIFT_FUND_ROWS("g")} gf ON gf.gift_id = g.id` : ""}
                LEFT JOIN fin_funds f ON f.id = ${byFund ? "gf" : "g"}.fund_id AND f.org_id = g.org_id
               WHERE g.org_id = ? AND d.deleted_at IS NULL AND g.date >= ? AND g.date <= ? AND ${NOT_CREDIT("g")}${w}`, args };
}

const SENTENCE = "A gift is a hard-credit gift above $0. A $0 or soft-credit record shows in history, labeled, but is never counted, averaged or receipted.";

module.exports = { COUNTED, GIFT_COUNT, DONOR_GIFT_COUNT, isCounted, countOf, averageCents, giftCounts, SENTENCE, ZERO_LABEL, alsoOnFile, isZero, zeroOnFileSql };
