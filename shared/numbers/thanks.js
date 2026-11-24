// shared/numbers/thanks.js · FLOWS-14 item 5 (W-1115-Finance-02X, repeat). WHICH GIFTS WAIT FOR A THANK-YOU.
//
// One rule, read by the profile's Thank-yous count, Home's org-wide "gifts not
// yet thanked", the starters' "awaiting thanks", the dashboard's thank-you list
// and the backlog: a gift waits for thanks when it is a gift (above $0 and not
// refunded in full, giftCount.KEPT) and no thank-you is logged on it. A refund
// row is not a gift, and a gift refunded in full needs no thank-you; the row
// says "Refunded, no thank-you needed" (shared/thankState.js).
"use strict";
const { KEPT } = require("./giftCount");

// SQL: gift row `g` waits for a thank-you.
const AWAITING = (g = "g") => `(COALESCE(${g}.acknowledgement_sent, false) = false AND ${KEPT(g)})`;

// ATLAS-9: one person's gifts waiting for a thank-you, newest first, as the profile's
// Thank-yous rail reads them (since the org's Steward start; an imported gift is history).
async function awaitingFor(query, orgId, donorId, since) {
  return query(`SELECT g.id, g.amount, LEFT(g.date, 10) AS date FROM gifts g
                 WHERE g.org_id = ? AND g.donor_id = ? AND COALESCE(g.is_sample, false) = false AND g.date IS NOT NULL
                   ${since ? "AND g.date >= ?" : ""} AND ${AWAITING("g")}
                 ORDER BY g.date DESC, g.id DESC`, since ? [orgId, donorId, since] : [orgId, donorId]);
}

module.exports = { AWAITING, awaitingFor };
