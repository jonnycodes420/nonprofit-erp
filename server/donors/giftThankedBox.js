// server/donors/giftThankedBox.js · THANKS-1 item 1. THE GIFT FORM'S "THANKED" BOX.
//
// The edit form's box used to be "Acknowledgement sent" and wrote
// gifts.acknowledgement_sent, the receipt's IRS mark, so un-ticking it on a
// receipted gift erased the receipt's fact and ticking it never started the
// thank-you clock. Now the box is "Thanked" and writes the thank-you
// (`thanked_at`), as every thank-you path does:
//   · absent (null): every column stays as it is;
//   · ticked: thanked_at is set (kept if already set, or the legacy mark's date),
//     and the acknowledgment mark is set with it, as the thank-you paths do;
//   · un-ticked: the thank-you clears and the acknowledgment mark goes back to
//     what the receipts say (shared/numbers/thanks.js UNTHANK_SET's rule).
"use strict";
const { HAS_RECEIPT, LEGACY } = require("../../shared/numbers/thanks");

const R = HAS_RECEIPT("gifts");

// SET fragment for `UPDATE gifts`; its placeholders come from thankedBoxArgs, in order.
const THANKED_BOX_SET =
  `thanked_at = CASE WHEN ?::boolean IS NULL THEN thanked_at
                     WHEN ?::boolean THEN COALESCE(thanked_at, CASE WHEN ${LEGACY("gifts")} THEN acknowledgement_sent_at END, NOW())
                     ELSE NULL END,
   acknowledgement_sent = CASE WHEN ?::boolean IS NULL THEN acknowledgement_sent WHEN ?::boolean THEN true ELSE ${R} END,
   acknowledgement_sent_at = CASE WHEN ?::boolean IS NULL OR ${R} THEN acknowledgement_sent_at
                                  WHEN ?::boolean THEN COALESCE(acknowledgement_sent_at, NOW()) ELSE NULL END,
   acknowledged_by = CASE WHEN ?::boolean THEN COALESCE(acknowledged_by, ?) WHEN ?::boolean IS FALSE THEN NULL ELSE acknowledged_by END,
   acknowledged_by_name = CASE WHEN ?::boolean THEN COALESCE(acknowledged_by_name, ?) WHEN ?::boolean IS FALSE THEN NULL ELSE acknowledged_by_name END`;

// `thanked`: true, false, or null (not sent). `who`: the actor.
function thankedBoxArgs(thanked, who) {
  const t = thanked === undefined ? null : thanked;
  return [t, t, t, t, t, t, t, who.id, t, t, who.name || null, t];
}

// A new gift saved with the box ticked: thanked as it is written.
async function markThankedOnCreate(run, orgId, giftId, who) {
  await run(`UPDATE gifts SET ${THANKED_BOX_SET} WHERE id = ? AND org_id = ?`, [...thankedBoxArgs(true, who), giftId, orgId]);
}

module.exports = { THANKED_BOX_SET, thankedBoxArgs, markThankedOnCreate };
