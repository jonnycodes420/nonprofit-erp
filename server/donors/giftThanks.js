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
  // NUMBERS-10 item 6: the open step's own words, for the timeline line that says it was cancelled.
  const openSteps = (await queryTx(client, `SELECT label FROM cultivation_plan_steps WHERE org_id = ? AND plan_id = ANY(?::text[]) AND status = 'open'`, [orgId, ids])).map(s => s.label);
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
  return { tasks, journeys: plans.map(p => p.template_name || "a journey"), openSteps };
}

// NUMBERS-10 item 6 (W-1127-Finance-03): "deleting a donor's gifts still leaves the 'Call to say thank
// you' journey step and note in place with no gift behind it". The step was skipped and its task voided,
// but the timeline kept "Journey step: Call to say thank you, due …" with nothing after it to say the
// thank-you would not happen. So when a delete cancels a thank-you (a journey's open step, or a task
// Steward made for the gift), the timeline gets ONE line saying so; the gift's Undo takes the line away
// (giftDeleteUndo.js, `cancelLineId`), so an undone delete leaves the timeline as it was (THANKS-1's
// complaint was a note that never went away). Inside the delete's transaction. Answers the line's id or null.
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = d => /^\d{4}-\d{2}-\d{2}/.test(String(d || "")) ? `${MON[Number(String(d).slice(5, 7)) - 1]} ${Number(String(d).slice(8, 10))}, ${String(d).slice(0, 4)}` : "";
function cancelWords(g, { tasks = 0, journeys = [], openSteps = [] } = {}) {
  if (!(tasks > 0) && !journeys.length) return null;
  const day = dayWords(g.date);
  const what = `the ${usd(Math.round((Number(g.amount) || 0) * 100))} gift${day ? ` of ${day}` : ""} was removed`;
  if (journeys.length) {
    const step = openSteps.length ? `${openSteps.join(", ")} (${journeys.join(", ")}) is cancelled` : `the journey it started (${journeys.join(", ")}) is stopped`;
    return `Thank-you cancelled: ${what}, so ${step}.`;
  }
  return `Thank-you cancelled: ${what}, so ${tasks === 1 ? "the thank-you task Steward made for it is" : `the ${tasks} tasks Steward made for it are`} cancelled.`;
}
async function cancelLine(client, { orgId, g, who, tasks, journeys, openSteps }) {
  const note = g && g.donor_id ? cancelWords(g, { tasks, journeys, openSteps }) : null;
  if (!note) return null;
  const [o] = await queryTx(client, "SELECT timezone FROM orgs WHERE id = ?", [orgId]);
  const day = require("../../orgTime").orgToday({ timezone: o && o.timezone });   // ORG_TZ_SEAM_OK (the org's civil today)
  const id = require("../shared/newId").newId("i");
  await runTx(client, `INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata)
                        VALUES (?, ?, ?, 'activity', ?, ?, ?, ?, ?)`,
    [id, orgId, g.donor_id, note, day, (who && who.id) || "system:gift-delete", (who && who.name) || null,
     JSON.stringify({ via: "gift_delete", removed_gift_id: g.id, line_key: `thanks-cancelled:${g.id}` })]);
  return id;
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

// THANKS-1: what the delete cancelled, for the Recent changes line ("" when nothing was).
function cancelledWords(tasks, journeys = []) {
  const n = deleteNote(tasks, journeys);
  return n ? n.replace(/^Gift removed, thank-you cancelled\.\s*/, "Its thank-you was cancelled. ").trim() : "";
}

module.exports = { stopJourneysOfGift, deleteNote, cancelledWords, cancelLine, cancelWords, STARTED_BY, SKIPPED };
