// shared/numbers/thanks.js · FLOWS-14 item 5, THANKS-1 item 1. WHICH GIFTS ARE THANKED, AND WHICH WAIT.
//
// One rule, read by the profile's Thank-yous count, Home's org-wide "gifts not
// yet thanked", the starters' "awaiting thanks", the dashboard's thank-you list,
// the backlog, the thank-you task, Atlas, Ask and the Report builder's "Thanked"
// column: a gift waits for thanks when it is a gift (above $0 and not refunded
// in full, giftCount.KEPT) and it is not THANKED. A refund row is not a gift,
// and a gift refunded in full needs no thank-you; the row says "Refunded, no
// thank-you needed" (shared/thankState.js).
//
// THANKS-1: what "thanked" is. `gifts.acknowledgement_sent` is the IRS fact ("a
// written acknowledgment exists"): the receipt writer sets it the moment the PDF
// is made (server/boot/helpers-3.js). It is NOT a thank-you, and no screen reads
// it as one (scripts/ci/ack-read-scan.js holds that line). A gift is thanked when
//   · `thanked_at` is set: written only by the thank-you paths (outreach/thanks.js
//     send and mark, the task's Done, Atlas's, the call logged on Home, the gift
//     form's "Thanked" box); or
//   · it is a LEGACY thank-you: marked acknowledged before `thanked_at` existed
//     (or by an import) and no receipt was ever made for it, so the mark can only
//     have meant a thank-you. A gift whose only acknowledgment is a receipt is
//     "Receipt issued, not thanked yet", which is the truth.
"use strict";
const { KEPT } = require("./giftCount");

// SQL: a receipt (live or voided) was made for gift row `g`.
const HAS_RECEIPT = (g = "g") =>
  `EXISTS (SELECT 1 FROM receipts rcpt WHERE rcpt.org_id = ${g}.org_id AND rcpt.gift_id = ${g}.id AND rcpt.type = 'gift')`;

// SQL: marked acknowledged with no thank-you clock and no receipt behind the mark.
const LEGACY = (g = "g") =>
  `(${g}.thanked_at IS NULL AND COALESCE(${g}.acknowledgement_sent, false) AND NOT ${HAS_RECEIPT(g)})`;

// SQL: gift row `g` has been thanked.
const THANKED = (g = "g") => `(${g}.thanked_at IS NOT NULL OR ${LEGACY(g)})`;

// SQL: when gift row `g` was thanked (null: not thanked, or a legacy mark with no date).
const THANKED_AT = (g = "g") => `COALESCE(${g}.thanked_at, CASE WHEN ${LEGACY(g)} THEN ${g}.acknowledgement_sent_at END)`;

// SQL: gift row `g` waits for a thank-you.
const AWAITING = (g = "g") => `(NOT ${THANKED(g)} AND ${KEPT(g)})`;

// SQL SET fragment for taking a thank-you back (an Undo, an un-ticked box) on
// `UPDATE gifts`: the clock clears, and the acknowledgment mark goes back to
// what the receipts say (a receipt's mark is never taken back with a thank-you).
const UNTHANK_SET =
  `thanked_at = NULL, acknowledgement_sent = ${HAS_RECEIPT("gifts")},
   acknowledgement_sent_at = CASE WHEN ${HAS_RECEIPT("gifts")} THEN acknowledgement_sent_at END,
   acknowledged_by = NULL, acknowledged_by_name = NULL, acknowledged_via = NULL`;

// SQL: the gift's live receipt as { number, sent } (null when none).
const RECEIPT_JSON = (g = "g") =>
  `(SELECT json_build_object('number', rl.receipt_number, 'sent', rl.sent_at IS NOT NULL)
      FROM receipts rl WHERE rl.org_id = ${g}.org_id AND rl.gift_id = ${g}.id AND rl.type = 'gift' AND rl.voided_at IS NULL
     ORDER BY rl.created_at DESC LIMIT 1)`;

module.exports = { AWAITING, THANKED, THANKED_AT, LEGACY, HAS_RECEIPT, UNTHANK_SET, RECEIPT_JSON };
