// client/src/lib/giftDeleteWords.js · THANKS-1 item 5. DELETING A GIFT IS ONE QUESTION.
// The profile asked "Delete this gift?" and then, on a receipt, asked again
// ("Void the receipt first?"), saying the receipt "is marked void (the donor's
// copy is not taken back)" whether or not a copy ever went out. Now one dialog
// says what will happen, in words that match what exists:
//   · a receipt generated and never sent: it will be voided;
//   · a receipt sent: it will be voided and the donor won't get a new one;
//   · a refund recorded against it: the refund comes off with it.
// receipts: the gift's ACTIVE receipts ({ receipt_number, sent_at }); refunds: how many.
const num = r => (r && r.receipt_number ? `Receipt #${r.receipt_number}` : "Its receipt");

export function receiptVoidLine(receipts) {
  const live = (receipts || []).filter(Boolean);
  if (!live.length) return "";
  return live.map(r => r.sent_at || r.sent === true
    ? `${num(r)} was sent to the donor; it will be voided and they won't get a new one.`
    : `${num(r)} was generated but never sent; it will be voided.`).join(" ");
}

export function giftDeleteDialog({ receipts = [], refunds = 0, pairButton = "" } = {}) {
  const rc = receiptVoidLine(receipts);
  const parts = ["It comes off this person's giving and your totals now."];
  if (refunds > 0) parts.push(refunds === 1 ? "Its refund comes off with it, so nothing is left standing alone." : `Its ${refunds} refunds come off with it, so nothing is left standing alone.`);
  if (rc) parts.push(rc);
  // THANKS-1 item 3: the delete is a Recent changes line with Undo (none when its refunds go too).
  if (!(refunds > 0)) parts.push("Recent changes keeps an Undo for 30 days. Nothing is added to their timeline.");
  return {
    title: "Delete this gift?",
    body: parts.join("\n\n"),
    yes: rc ? (refunds > 0 ? "Void, and delete the gift and its refund" : "Void and delete") : refunds > 0 ? (pairButton || "Delete the gift and its refund") : "Delete gift",
  };
}
