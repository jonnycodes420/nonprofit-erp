// server/donors/pledgePayments.js · PLEDGES-2. A PLEDGE PAYMENT APPLIES THE
// WAY A BOOKKEEPER WOULD.
//
// W-1107-Finance-25X: a $150 payment against a $100 installment was taken with
// no word, and the extra $50 was lost. recordGift matched a payment to an
// installment only when the amounts were equal, so $150 flagged nothing: the
// pledge's paid said $150 while every installment still read unpaid, and the
// Giving tab and the rail counted different things (W-1107-Finance-20).
//
// The rule (Bloomerang, DonorPerfect, NPSP): a payment against a pledge applies
// to the oldest installment due first, and anything over it carries to the
// next one(s). `relay` applies every payment on the pledge oldest due first,
// so $150 on four $100 installments marks the first paid and leaves $50 on
// the second: three installments left, $250 still to come.
//
// A payment above what is still owed is a question, never a silent surplus:
// `overBalance` says how much is over, and the gift form offers "Record $X as
// an extra gift" or "Reduce to the balance".
//
// `afterPledgeDelete` (W-1107-Finance-18X): a deleted pledge takes its own
// "Pledged" timeline line and its collect tasks with it, and the timeline says
// one "Pledge deleted" line instead. Undo puts all of it back.
"use strict";
const { query, run, runTx, queryTx } = require("../../db");
const { inAmbientTransaction, withAmbientTransaction } = require("../db/query");
const money = require("../../money");
const { MONEY } = require("../../shared/numbers/money");

const cents = v => Math.round((Number(v) || 0) * 100);

// What is still owed on the pledge, in cents, and what a payment of `amountCents`
// would put over it. null when the payment fits.
async function overBalance(orgId, pledgeId, amountCents) {
  const [p] = await query(
    `SELECT p.amount, ${require("../../shared/numbers/pledges").PAID_OF("p")} AS paid FROM pledges p WHERE p.id=? AND p.org_id=?`,
    [pledgeId, orgId]);
  if (!p) return null;
  const balanceCents = Math.max(0, cents(p.amount) - cents(p.paid));
  if (amountCents <= balanceCents) return null;
  const extraCents = amountCents - balanceCents;
  const $ = c => money.formatCents(c);
  return {
    balanceCents, extraCents,
    sentence: balanceCents > 0
      ? `This payment is ${$(amountCents)} and ${$(balanceCents)} is left on the pledge. Record the ${$(extraCents)} over it as an extra gift, or reduce the payment to ${$(balanceCents)}.`
      : `Nothing is left on this pledge. Record the ${$(amountCents)} as an extra gift instead.`,
    choices: balanceCents > 0 ? ["extra_gift", "reduce"] : ["extra_gift"],
  };
}

// Apply every payment on the pledge to its schedule, oldest due first: an
// installment the money reaches in full is marked paid (by the payment that
// completed it), and what is over carries to the next. The rows themselves are
// not split or re-dated (the schedule stays what was promised); what is left on
// a part-paid installment is the readers' one rule (shared/numbers/pledges.js
// installmentsLeft, dueOf, DUE_SQL: paid applied earliest first). Returns the
// first installment this gift completed, or null. Writes only the flags that change.
async function relay(orgId, pledgeId, giftId = null) {
  const rows = await query(
    `SELECT id, ROUND(amount::numeric * 100)::bigint AS cents, paid_gift_id FROM pledge_installments
      WHERE org_id=? AND pledge_id=? ORDER BY due_date ASC NULLS LAST, seq ASC`, [orgId, pledgeId]);
  if (!rows.length) return null;
  const pays = await query(
    `SELECT g.id, ROUND(g.amount::numeric * 100)::bigint AS cents FROM gifts g
      WHERE g.org_id=? AND g.pledge_id=? AND ${MONEY("g")} AND g.amount > 0 ORDER BY LEFT(g.date::text, 10) ASC, g.created_at ASC, g.id ASC`, [orgId, pledgeId]);
  const want = flagsFor(rows.map(r => Number(r.cents)), pays.map(p => ({ id: p.id, cents: Number(p.cents) })));
  const write = async () => {
    for (const [k, r] of rows.entries()) {
      if ((r.paid_gift_id || null) === want[k]) continue;
      await run(`UPDATE pledge_installments SET paid_gift_id=?, paid_at=CASE WHEN ?::text IS NULL THEN NULL ELSE COALESCE(paid_at, NOW()) END WHERE id=? AND org_id=?`,
        [want[k], want[k], r.id, orgId]);
    }
  };
  if (rows.some((r, k) => (r.paid_gift_id || null) !== want[k])) {
    // One transaction: the caller's when recordGift runs inside one (an import), else its own.
    if (inAmbientTransaction()) await write(); else await withAmbientTransaction(write);
  }
  if (!giftId) return null;
  const k = want.indexOf(giftId);
  return k >= 0 ? { installmentId: rows[k].id, pledgeId } : null;
}

// Pure: installment amounts (in due order) and payments (oldest first), in
// cents → the gift id that completes each installment, or null while the money
// has not reached its end.
function flagsFor(amounts, payments) {
  const out = [];
  let need = 0, paid = 0, p = 0;
  for (const a of amounts) {
    need += a;
    while (p < payments.length && paid < need) { paid += payments[p].cents; p++; }
    out.push(paid >= need && p > 0 ? payments[p - 1].id : null);
  }
  return out;
}

// Inside the delete's transaction, before the pledge goes: what it created on
// the timeline and the open collect tasks are moved aside (returned for Undo),
// and one "Pledge deleted" line is written.
async function trashWith(client, pledgeId, orgId) {
  const [p] = await queryTx(client, "SELECT donor_id, amount FROM pledges WHERE id=? AND org_id=?", [pledgeId, orgId]);
  if (!p) return null;
  const lines = await queryTx(client,
    `SELECT * FROM interactions WHERE org_id=? AND donor_id=? AND (metadata->>'pledge_id' = ? OR metadata->>'line_key' = ?)`,
    [orgId, p.donor_id, pledgeId, `pledge_created:${pledgeId}`]);
  if (lines.length) await runTx(client, "DELETE FROM interactions WHERE id = ANY(?) AND org_id=?", [lines.map(l => l.id), orgId]);
  // The collect move's tasks (Insights' "Open pledges to collect"), while this
  // was the person's only open pledge: with it gone there is nothing to collect.
  const [others] = await queryTx(client, "SELECT COUNT(*)::int AS n FROM pledges WHERE org_id=? AND donor_id=? AND id<>? AND status='open'",
    [orgId, p.donor_id, pledgeId]);
  let taskIds = [];
  if (!others || !others.n) {
    taskIds = (await queryTx(client,
      `UPDATE tasks SET voided_at=NOW(), voided_reason='The pledge was deleted.' WHERE org_id=? AND donor_id=? AND done=0 AND voided_at IS NULL
         AND title LIKE 'Open pledges to collect:%' RETURNING id`, [orgId, p.donor_id])).map(t => t.id);
  }
  return { timeline: lines, voided_task_ids: taskIds, donor_id: p.donor_id, amount: Number(p.amount) };
}

// The "Pledge deleted" line, written after the delete commits.
async function deletedLine({ orgId, donorId, amount, pledgeId, who }) {
  const TL = require("../../timelineLine");
  return TL.timelineLine({ orgId, donorId, note: `Pledge deleted: ${TL.lineMoney(amount)}.`, actorId: who.id, actorName: who.name,
    metadata: { via: "pledge", pledge_deleted: pledgeId } });
}

// Undo: the timeline lines and tasks come back, and the "Pledge deleted" line goes.
async function restoreWith(client, x, pledgeId, orgId) {
  if (!x) return;
  if (Array.isArray(x.timeline) && x.timeline.length)
    await runTx(client, "INSERT INTO interactions SELECT * FROM jsonb_populate_recordset(NULL::interactions, ?::jsonb) ON CONFLICT DO NOTHING",
      [JSON.stringify(x.timeline)]);
  if (Array.isArray(x.voided_task_ids) && x.voided_task_ids.length)
    await runTx(client, "UPDATE tasks SET voided_at=NULL, voided_reason=NULL WHERE id = ANY(?) AND org_id=? AND voided_reason='The pledge was deleted.'",
      [x.voided_task_ids, orgId]);
  await runTx(client, "DELETE FROM interactions WHERE org_id=? AND metadata->>'pledge_deleted' = ?", [orgId, pledgeId]);
}

module.exports = { overBalance, relay, flagsFor, trashWith, deletedLine, restoreWith };
