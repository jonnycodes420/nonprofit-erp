// shared/numbers/giftFacts.js · TRUTH-6 (W-1110-Fundraising-19). A PERSON'S FIRST, LAST AND LARGEST GIFT.
//
// The "Thank you: first gift" letter quoted each person's LATEST gift as their
// first: its one merge field, {{gift_amount}}, was filled with the last gift.
// A merge field that names a gift reads it here, by the rules the rest of
// Steward already keeps: a counted gift (giftCount.js: hard credit, above $0,
// not refunded in full, not scheduled), dated, and
//   first    the earliest, in firstGift.js's order (FIRST_GIFT_ORDER)
//   last     the latest, in lastGift.js's order (LAST_GIFT_ORDER)
//   largest  the largest; on a tie, the earlier
// Each is { cents, date, fund, tributeType, tributeName } or null.
"use strict";
const { COUNTED } = require("./giftCount");
const { FIRST_GIFT_ORDER } = require("./firstGift");
const { LAST_GIFT_ORDER } = require("./lastGift");

const LARGEST_GIFT_ORDER = "g.amount DESC, g.date ASC, g.created_at ASC, g.id ASC";
const ORDERS = { first: FIRST_GIFT_ORDER, last: LAST_GIFT_ORDER, largest: LARGEST_GIFT_ORDER };

async function giftFacts(query, orgId, donorId) {
  const out = {};
  for (const [k, order] of Object.entries(ORDERS)) {
    const [r] = await query(
      `SELECT ROUND(g.amount * 100)::bigint AS cents, LEFT(g.date, 10) AS date, g.tribute_type, g.tribute_name, f.name AS fund
         FROM gifts g LEFT JOIN fin_funds f ON f.id = g.fund_id AND f.org_id = g.org_id
        WHERE g.org_id = ? AND g.donor_id = ? AND g.date IS NOT NULL AND ${COUNTED("g")}
        ORDER BY ${order} LIMIT 1`, [orgId, donorId]);
    out[k] = r ? { cents: Number(r.cents), date: r.date, fund: r.fund || null, tributeType: r.tribute_type || null, tributeName: r.tribute_name || null } : null;
  }
  return out;
}

// Which gift a template's own {{gift_amount}} / {{gift_date}} / {{fund}} /
// {{tribute}} mean: the first gift in the first-gift thank-you, the latest
// everywhere else.
const giftOfKind = kind => (kind === "thanks_first" ? "first" : kind === "thanks_major" ? "largest" : "last");

module.exports = { giftFacts, giftOfKind, LARGEST_GIFT_ORDER };
