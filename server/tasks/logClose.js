// server/tasks/logClose.js · SENDS-1 item 3 (W-1107-Donors-36, a repeat of FEEL-1).
//
// THE ONE ANSWER TO "WHAT DOES LOGGING A CONVERSATION CLOSE?". Every place a
// person logs a conversation with a next-step choice (the profile, Home, the
// Thread, Tasks and the Calendar through POST /donors/:id/conversations, and
// an email sent from its task through POST /tasks/:id/complete) asks this.
//
//   - A next step set: the conversation is the outcome of every open step on
//     the person, which close, and the new step opens (the caller opens it).
//   - "Skip the next step": the conversation is logged and NOTHING ELSE moves.
//     FEEL-1 still closed the follow-up the dialog was opened on; the fleet
//     read that as Skip completing her follow-up, twice. A skip touches nothing.
//
// Finishing a task on purpose (Mark done on that task) is not a skip: that
// task's own step closes in /tasks/:id/complete, because she finished it.
"use strict";

const CLOSE_ALL_SQL = `UPDATE threads SET closed_at = NOW(), close_kind = 'outcome', closing_interaction_id = ?
                         WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL RETURNING id`;

async function closeOnLog(client, queryTx, { orgId, donorId, interactionId, skipped }) {
  if (skipped) return [];
  return queryTx(client, CLOSE_ALL_SQL, [interactionId, orgId, donorId]);
}

// FLOWS-6 (W-1110-Donors-35X) · ONE LOG, ONE FOLLOW-UP. A log whose next step
// is the step already open ("Follow up" while "Follow up" is open) carries that
// step to its new day instead of closing it and opening a twin: closing it wrote
// a Done "Follow up" beside the new open one, the same title and day, and the
// fleet read the touch as a Done task. The log stays on the timeline as a touch.
// Returns the carried thread, or null when the open step is a different one.
const sameStep = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
async function carrySameStep(client, queryTx, { orgId, donorId, interactionId, step }) {
  if (!step) return null;
  const [open] = await queryTx(client, "SELECT id, next_step_label FROM threads WHERE org_id = ? AND donor_id = ? AND closed_at IS NULL", [orgId, donorId]);
  if (!open || !sameStep(open.next_step_label, step.label)) return null;
  const [t] = await queryTx(client,
    `UPDATE threads SET next_step_label = ?, due_date = ?, due_time = ?, snoozed_until = NULL, opening_interaction_id = ?
      WHERE id = ? AND org_id = ? AND closed_at IS NULL RETURNING *`,
    [step.label, step.due, step.time || null, interactionId, open.id, orgId]);
  return t || null;
}

module.exports = { closeOnLog, carrySameStep, sameStep, CLOSE_ALL_SQL };
