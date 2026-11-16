// server/shared/thankYouOnce.js · SENDS-1 item 3 (W-1107-Fundraising-14X, W-1107-Volunteers-14X).
//
// ONE THANK-YOU TASK PER GIFT. An online gift wrote "Send personal thank-you
// to …" in the Stripe webhook, and a moment later the gift's own work (the
// journey's "Say thank you" step, or the gift's "Send thank-you note" step on
// the Thread) opened a second one for the same gift. The rule, the RACE-1 way:
//   - the gift's thank-you is ONE thing: an open thank-you step on the person's
//     Thread, or else one task keyed to the gift (tasks.thanks_gift_id);
//   - this is the one writer of that task, under the person's lock, and the
//     unique index tasks_one_thanks_per_gift (server/db/race1Indexes.js) says
//     the same rule to the database, so ten writers at once make one row;
//   - when the gift's step opens after the task was written, settleThankYous
//     voids the task (voided, never deleted), because the step is the thank-you.
//
// FLOWS-17 (Justin's Place, a paying customer): "every time I put in a gift,
// two tasks pop up to mail a thank you". The "Gift received → notify the team"
// workflow, on for every new org, wrote its own "Thank X · $Y just came in"
// task straight into tasks, beside the gift's own "Send thank-you note" step.
// Every writer of a gift's thank-you task now comes through thankYouTaskOnce
// (the webhook and the workflow; a Thread step is the thank-you itself), and
// the settle takes the same person lock as the write, so a step that opens
// while a task is being written still voids it. tests/flows17-one-thanks.test.js
// plants a second writer and goes red.
"use strict";
const { query, run } = require("../../db");
const { newId } = require("./newId");
const { withPersonLock } = require("./personLock");

const THANK_TYPES = ["thank", "thank_you_note"];
const THANK_LABEL_SQL = `(next_step_type = ANY(?::text[]) OR next_step_label ~* '^(call to )?(say |send )?(a )?(personal )?thank')`;

async function openThankStep(orgId, donorId) {
  if (!donorId) return null;
  const [th] = await query(`SELECT id FROM threads WHERE org_id=? AND donor_id=? AND closed_at IS NULL AND ${THANK_LABEL_SQL} LIMIT 1`,
    [orgId, donorId, THANK_TYPES]);
  return th || null;
}

async function thankYouTaskOnce({ orgId, donorId = null, giftId, title, actor, priority = "high", due = null, assignee = null }) {
  if (!orgId || !giftId) return { skipped: "no_gift" };
  return withPersonLock("thank-you", orgId, donorId || `gift:${giftId}`, async () => {
    const [has] = await query(`SELECT id FROM tasks WHERE org_id=? AND (thanks_gift_id=? OR source_gift_id=?) AND voided_at IS NULL LIMIT 1`, [orgId, giftId, giftId]);
    if (has) return { id: has.id, existed: true };
    const step = await openThankStep(orgId, donorId);
    if (step) return { threadId: step.id, existed: true };
    const id = newId("t");
    // source_gift_id too: deleting the gift voids its thank-you (FIX-10 Part C).
    const r = await run(
      `INSERT INTO tasks (id,org_id,title,priority,done,due,donor_id,type,thanks_gift_id,source_gift_id,assigned_to,assigned_to_name,
                          created_at,updated_at,created_by,created_by_name)
       VALUES (?,?,?,?,0,?,?,'donor',?,?,?,?,NOW(),NOW(),?,?) ON CONFLICT DO NOTHING`,
      [id, orgId, String(title || "Send a personal thank-you").slice(0, 300), priority, due || "", donorId, giftId, giftId,
       (assignee && assignee.id) || null, (assignee && assignee.id && assignee.name) || null, actor.id, actor.name]);
    return r && r.changes ? { id, created: true } : { existed: true };
  });
}

// After the gift's journey or Thread step opened: the step is the thank-you,
// so a task written for the same gift a moment earlier is voided.
// Under the writer's own lock: a write that checked before the step opened has
// finished by the time this looks, so it is voided here rather than left beside it.
async function settleThankYous(orgId, donorId, giftId) {
  if (!orgId || !donorId || !giftId) return 0;
  return withPersonLock("thank-you", orgId, donorId, async () => {
    if (!(await openThankStep(orgId, donorId))) return 0;
    const r = await run(`UPDATE tasks SET voided_at=NOW(), voided_reason='one_thank_you', updated_at=NOW()
                          WHERE org_id=? AND thanks_gift_id=? AND done=0 AND voided_at IS NULL AND thread_id IS NULL`, [orgId, giftId]);
    return (r && r.changes) || 0;
  });
}

module.exports = { thankYouTaskOnce, settleThankYous, openThankStep, THANK_TYPES };
