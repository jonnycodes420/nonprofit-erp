// server/receipts/drift.js · PLEDGES-3 (W-1108-Finance-09X). A RECEIPT IS A SNAPSHOT; A CHANGED GIFT SAYS SO.
//
// Harper's receipt stayed $100 after the gift went to $150, and Marlowe's
// receipt said $200 against a $0 gift, with no sign of either. An issued
// receipt is never edited (the IRS reads it as issued). When the gift it was
// issued for no longer says what the receipt says, the receipt and the gift
// both carry one line: "Gift changed after this receipt. Void and reissue?",
// and one click voids it (the note says why, the number is never reused) and
// issues a fresh one for the gift as it is now. A $0 gift carries no receipt,
// so for one the click voids it and issues nothing.
//
// The drift is read live, never stored: a receipt drifted before this build
// shows the line the moment it is listed.
//   DRIFT_SELECT(r, g)  the columns a receipt list adds (gift_amount, gift_missing)
//   driftOf(row)        null, or { receiptAmount, giftAmount, zero, sentence }
//   POST /receipts/:id/reissue
"use strict";
const express = require("express");
const routers = { r1: express.Router() };

const cents = v => Math.round((Number(v) || 0) * 100);
const usd = v => "$" + (cents(v) / 100).toLocaleString("en-US", { minimumFractionDigits: cents(v) % 100 ? 2 : 0, maximumFractionDigits: 2 });

// For a receipts query aliased `r`: the gift it was issued for, as it is now.
// LEFT JOIN this, then select DRIFT_COLUMNS.
const DRIFT_JOIN = (r = "r") => `LEFT JOIN gifts dg ON dg.id = ${r}.gift_id AND dg.org_id = ${r}.org_id`;
// MONEY-4: the gift as it is now is its amount less any refund recorded against it.
const { NET_AMOUNT } = require("../../shared/numbers/refunds");
const DRIFT_COLUMNS = `${NET_AMOUNT("dg")} AS gift_amount, (dg.id IS NULL) AS gift_missing`;

// One receipt row (with gift_amount, gift_missing) → its drift, or null.
// Only a gift receipt that still stands can drift; a year-end statement is
// a statement of a year and is reissued from the profile.
function driftOf(row) {
  if (!row || row.type !== "gift" || row.voided_at || !row.gift_id) return null;
  if (row.gift_missing === true || row.gift_missing === "t") {
    return { receiptAmount: Number(row.amount), giftAmount: null, zero: true,
      sentence: `Gift changed after this receipt: the receipt says ${usd(row.amount)} and the gift is no longer on file. Void it?`, action: "Void it" };
  }
  if (row.gift_amount == null || cents(row.gift_amount) === cents(row.amount)) return null;
  const zero = !(cents(row.gift_amount) > 0);
  return { receiptAmount: Number(row.amount), giftAmount: Number(row.gift_amount), zero,
    sentence: zero
      ? `Gift changed after this receipt: the receipt says ${usd(row.amount)} and the gift is now $0, and a $0 gift can't carry a receipt. Void it?`
      : `Gift changed after this receipt: the receipt says ${usd(row.amount)} and the gift is now ${usd(row.gift_amount)}. Void and reissue?`,
    action: zero ? "Void it" : "Void and reissue" };
}
const withDrift = rows => rows.map(r => { const { gift_amount, gift_missing, ...rest } = r; return { ...rest, drift: driftOf(r) }; });

function mount(ctx) {
  const { query, run, requireAuth, requireAdmin, wrap, actor, issueGiftReceipt, orgToday, orgTz } = ctx;
  // One click: void the drifted receipt (its note says why and what replaced
  // it) and, for a gift above $0, issue the gift's receipt as it is now. Made,
  // not emailed: the new receipt is sent only from its own Email link.
  routers.r1.post("/receipts/:id/reissue", requireAuth, requireAdmin, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [row] = await query(`SELECT r.*, ${DRIFT_COLUMNS} FROM receipts r ${DRIFT_JOIN("r")} WHERE r.id = ? AND r.org_id = ?`, [req.params.id, orgId]);
    if (!row) return res.status(404).json({ error: "not_found", sentence: "That receipt is not on file." });
    if (row.voided_at) return res.status(409).json({ error: "already_void", sentence: "That receipt is already void." });
    const d = driftOf(row);
    if (!d) return res.status(409).json({ error: "no_drift", sentence: "The gift still says what this receipt says, so there is nothing to reissue." });
    const who = actor(req);
    const day = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    const why = `Gift changed after this receipt (receipt ${usd(row.amount)}, gift now ${d.giftAmount == null ? "removed" : usd(d.giftAmount)}). Voided by ${who.name} on ${day}.`;
    const done = await run("UPDATE receipts SET voided_at = NOW(), void_reason = ? WHERE id = ? AND org_id = ? AND voided_at IS NULL", [why, row.id, orgId]);
    if (Number(done?.changes ?? done?.rowCount ?? 1) === 0) return res.status(409).json({ error: "already_void", sentence: "That receipt is already void." });
    let receipt = null;
    if (!d.zero) {
      const [gift] = await query("SELECT * FROM gifts WHERE id = ? AND org_id = ?", [row.gift_id, orgId]);
      const [org] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
      const [donor] = await query("SELECT * FROM donors WHERE id = ? AND org_id = ?", [gift.donor_id, orgId]);
      const out = await issueGiftReceipt({ ...gift, amount: d.giftAmount, refund_net: true }, org, donor, { send: false, by: who, manual: true });
      receipt = out && out.receipt ? out.receipt : null;
      if (receipt) await run("UPDATE receipts SET void_reason = ? WHERE id = ? AND org_id = ?", [`${why} Reissued as #${receipt.receipt_number}.`, row.id, orgId]);
    }
    res.json({ voided: row.id, receipt: receipt ? { id: receipt.id, receipt_number: receipt.receipt_number, amount: Number(receipt.amount) } : null,
      sentence: receipt ? `Receipt #${row.receipt_number} is void, and #${receipt.receipt_number} for ${usd(receipt.amount)} is ready.` : `Receipt #${row.receipt_number} is void. A $0 gift carries no receipt, so none was made.` });
  }));
  return {};
}

module.exports = { routers, mount, driftOf, withDrift, DRIFT_JOIN, DRIFT_COLUMNS, NET_AMOUNT };
