// server/donors/refundPairs.js · FLOWS-14 item 1 (W-1115-Finance-07X, repeat).
// A REFUND GOES WITH ITS GIFT.
//
// A refund is a negative row linked to the gift it refunds (gifts.refund_of,
// MONEY-4). Undoing a deposit removed the deposit's gifts and left the refunds
// recorded against them standing alone: a −$25 row nobody could remove, and
// every org total $25 under the truth. FLOWS-11 kept a refunded gift from being
// deleted on its own; this is the one path that removes both, always inside the
// same transaction as the gift:
//   · undoing a deposit or gift file (server/imports/undo.js) takes the refunds
//     of the gifts it removes;
//   · deleting a gift with a refund, when she says "Delete the gift and its
//     refund" (DELETE /gifts/:id?withRefunds=1), takes them too.
// A refund row's own ledger line, timeline line and draft go with it, as a
// gift's do. `exec(sql, args)` runs one statement on the caller's transaction.
"use strict";

const REFUNDS_OF_SQL = "SELECT id, amount FROM gifts WHERE org_id = $1 AND refund_of = ANY($2::text[])";

// The refund rows recorded against gifts `giftIds`, removed. Returns how many.
async function removeRefundsOf(exec, orgId, giftIds) {
  if (!giftIds || !giftIds.length) return { count: 0, cents: 0 };
  const rows = await exec(REFUNDS_OF_SQL, [orgId, giftIds]);
  return removeRefundRows(exec, orgId, rows);
}

// UNDO-1: the refund rows `rows` ({ id, amount }) removed with their ledger
// line, timeline line and draft. The one remover, for a pair and for an Undo.
async function removeRefundRows(exec, orgId, rows) {
  const ids = rows.map(r => r.id);
  if (!ids.length) return { count: 0, cents: 0 };
  await exec("DELETE FROM thank_you_drafts WHERE org_id = $1 AND gift_id = ANY($2::text[])", [orgId, ids]);
  await exec("DELETE FROM fin_transactions WHERE org_id = $1 AND gift_id = ANY($2::text[])", [orgId, ids]);
  await exec("DELETE FROM interactions WHERE org_id = $1 AND gift_id = ANY($2::text[])", [orgId, ids]);
  await exec("UPDATE receipts SET gift_id = NULL WHERE org_id = $1 AND gift_id = ANY($2::text[])", [orgId, ids]);
  await exec("DELETE FROM gifts WHERE org_id = $1 AND id = ANY($2::text[])", [orgId, ids]);
  return { count: ids.length, cents: rows.reduce((n, r) => n - Math.round(Number(r.amount) * 100), 0) };
}

// A pg client as `exec`.
const onClient = client => async (sql, args) => (await client.query(sql, args)).rows;

// The words the profile offers when a gift has a refund (the 409 and the button).
const PAIR_WORDS = {
  refused: "This gift has a refund recorded against it, so it stays on file with its refund. Totals already net it out. To remove both, choose Delete the gift and its refund.",
  button: "Delete the gift and its refund",
  done: n => `The gift and its ${n === 1 ? "refund were" : `${n} refunds were`} deleted together.`,
};

// Refund rows whose gift is gone (the orphans the old undo left), per org: the
// repair script's read (scripts/ops/flows14-orphan-refunds.js).
const ORPHANS_SQL = `SELECT r.org_id, r.id, r.donor_id, r.date, r.amount, r.refund_of
   FROM gifts r
  WHERE r.refund_of IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = r.refund_of AND g.org_id = r.org_id)`;

module.exports = { removeRefundsOf, removeRefundRows, onClient, PAIR_WORDS, ORPHANS_SQL, REFUNDS_OF_SQL };
