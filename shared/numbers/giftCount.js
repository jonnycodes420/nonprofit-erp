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
const { GIFT, isGift } = require("./money");

// SQL: gift row `g` is counted.
const COUNTED = (g = "g") => GIFT(g);
// SQL: how many gifts person `d` has on file, by the rule.
const GIFT_COUNT = (d = "d") => `(SELECT COUNT(*)::int FROM gifts gc WHERE gc.org_id = ${d}.org_id AND gc.donor_id = ${d}.id AND ${COUNTED("gc")})`;
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

const SENTENCE = "A gift is a hard-credit gift above $0. A $0 or soft-credit record shows in history, labeled, but is never counted, averaged or receipted.";

module.exports = { COUNTED, GIFT_COUNT, isCounted, countOf, averageCents, giftCounts, SENTENCE };
