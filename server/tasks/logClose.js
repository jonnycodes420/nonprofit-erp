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

module.exports = { closeOnLog, CLOSE_ALL_SQL };
