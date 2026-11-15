// server/donors/giftThanks.js · FLOWS-11 item 6 (W-1114-Finance-04X). DELETING A GIFT CANCELS
// EVERY THANK-YOU IT STARTED, ONE WAY.
//
// The fleet deleted a past gift and kept "Call to say thank you, Due Nov 16" on the profile; a
// future gift's delete voided its thank-you with a logged note. One door, two outcomes: the
// delete voided tasks by `tasks.source_gift_id` (FIX-10), which a gift's own thank-you carries,
// but a past first gift's thank-you is the first step of the journey it started ("New donor,
// first year"), and a journey's step names its thread, never the gift. So the journey ran on for a
// gift that no longer existed.
//
// Inside the delete's own transaction, this stops every active journey the gift started: its
// open step's thread is closed with the reason `gift_deleted` (as the gift's own thread is), the
// task on that thread is voided with the same reason, and every step not done is skipped,
// "Skipped, the gift was removed". The count of voided tasks joins the delete's own count, so the
// one timeline note ("Gift removed, thank-you cancelled. …") says both.
//
// Which journeys a gift started: `source_gift_id` (stamped by journeyStart.js since FLOWS-11), a
// gift trigger's event `gift:<id>`, and, for a first-gift journey started before the stamp, a
// first-gift journey whose person has no other gift left (the gift that started it is gone).
"use strict";
const { queryTx, runTx } = require("../db/query");

const SKIPPED = "Skipped, the gift was removed";

// SQL: the active journeys gift `?` (args: org, donor, gift, gift, gift) started.
const STARTED_BY = `SELECT p.id, p.template_name FROM cultivation_plans p
   WHERE p.org_id = ? AND p.donor_id = ? AND p.status = 'active'
     AND (p.source_gift_id = ? OR p.trigger_event = 'gift:' || ?
          OR (p.source_gift_id IS NULL AND p.trigger_key = 'first_gift'
              AND NOT EXISTS (SELECT 1 FROM gifts og WHERE og.org_id = p.org_id AND og.donor_id = p.donor_id AND og.id <> ? AND og.amount > 0)))`;   // any gift row left, refunded or not: only a gift that is GONE stops it

// In the delete's transaction, before the gift row goes. Answers { tasks, journeys: [names] }.
async function stopJourneysOfGift(client, orgId, donorId, giftId, who) {
  if (!donorId) return { tasks: 0, journeys: [] };
  const plans = await queryTx(client, STARTED_BY, [orgId, donorId, giftId, giftId, giftId]);
  if (!plans.length) return { tasks: 0, journeys: [] };
  const ids = plans.map(p => p.id);
  const steps = await queryTx(client, `SELECT id, thread_id, status FROM cultivation_plan_steps
                                        WHERE org_id = ? AND plan_id = ANY(?::text[]) AND status IN ('open','pending')`, [orgId, ids]);
  const threads = steps.filter(s => s.status === "open" && s.thread_id).map(s => s.thread_id);
  let tasks = 0;
  if (threads.length) {
    // Void first: closing a thread marks its task done (the thread's trigger), and a voided task is
    // never "Done" on the timeline (the walk caught it reading done).
    const v = await runTx(client, `UPDATE tasks SET voided_at = NOW(), voided_reason = 'gift_deleted', updated_at = NOW()
                                    WHERE org_id = ? AND thread_id = ANY(?::text[]) AND voided_at IS NULL AND COALESCE(done, 0) = 0`, [orgId, threads]);
    tasks = Number(v && v.changes) || 0;
    await runTx(client, `UPDATE threads SET closed_at = NOW(), close_kind = 'dismissed', close_reason = 'gift_deleted'
                          WHERE org_id = ? AND id = ANY(?::text[]) AND closed_at IS NULL`, [orgId, threads]);
  }
  if (steps.length) {
    await runTx(client, `UPDATE cultivation_plan_steps SET status = 'skipped', closed_at = NOW(), closed_by = ?, closed_by_name = ?, skip_reason = ?
                          WHERE org_id = ? AND id = ANY(?::text[])`, [who.id, who.name, SKIPPED, orgId, steps.map(s => s.id)]);
  }
  await runTx(client, `UPDATE cultivation_plans SET status = 'abandoned', closed_at = NOW(), end_reason = 'gift_deleted'
                        WHERE org_id = ? AND id = ANY(?::text[])`, [orgId, ids]);
  return { tasks, journeys: plans.map(p => p.template_name || "a journey") };
}

// The timeline's one note for a delete: the words FIX-10 wrote for the gift's own tasks, and the
// journeys it stopped. null when nothing was cancelled.
function deleteNote(tasks, journeys = []) {
  if (!(tasks > 0) && !journeys.length) return null;
  const n = Math.max(0, tasks);
  let s = "Gift removed, thank-you cancelled.";
  if (n > 0) s += ` ${n === 1 ? "One task" : `${n} tasks`} Steward had created for this gift ${n === 1 ? "was" : "were"} voided.`;
  if (journeys.length) s += ` The journey it started (${journeys.join(", ")}) was stopped.`;
  return s;
}

module.exports = { stopJourneysOfGift, deleteNote, STARTED_BY, SKIPPED };
