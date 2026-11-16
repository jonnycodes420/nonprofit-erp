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

module.exports = { AWAITING };
