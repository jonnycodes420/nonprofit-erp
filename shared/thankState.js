// shared/thankState.js · FLOWS-14 item 5 (W-1115-Finance-02X, repeat). A GIFT ROW'S THANK-YOU STATE.
//
// The sidebar's count already left out a gift refunded in full (FLOWS-11), but
// the rows did not: the refunded $25 gift and its −$25 refund both read "Not
// yet" / "Not thanked yet". One rule for a row, the same as every thank-you
// list (shared/numbers/thanks.js AWAITING, in SQL):
//   · a refund row has no thank-you state at all (null): it is not a gift;
//   · a gift refunded in full: "Refunded, no thank-you needed";
//   · otherwise thanked, or not yet.
// THANKS-1: "Thanked" is `thanked` (the server's shared/numbers/thanks.js THANKED,
// a thank-you sent, marked or called), never `acknowledgement_sent`, which a
// receipt sets. A receipt is its own fact (receiptWords): a gift with a receipt
// and no thank-you reads "Receipt issued, not thanked yet".
// An ES module, read by the profile's Giving list and its timeline.

export const REFUNDED_WORDS = "Refunded, no thank-you needed";

export function thankState(g) {
  if (!g) return null;
  if (Number(g.amount) < 0 || g.refund_of || g.refundOf) return null;
  if (g.refunded_in_full === true || g.refundedInFull === true) return { key: "refunded", words: REFUNDED_WORDS };
  if (g.thanked === true) return { key: "thanked", words: "Thanked" };
  return { key: "not_yet", words: g.receipt ? "Receipt issued, not thanked yet" : "Not thanked yet" };
}

// The gift's live receipt in words, or null: "Receipt #2026-00027 issued" / "… sent".
export function receiptWords(g) {
  const r = g && g.receipt;
  if (!r || !r.number) return null;
  return `Receipt #${r.number} ${r.sent ? "sent" : "issued"}`;
}
