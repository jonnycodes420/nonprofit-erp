// server/tasks/taskTickEffects.js · UNDO-1 item 3. A TICK IS A WRITE WITH AN UNDO.
//
// "profile task tick also completes the person's journey enrollment and
// reopening the task does not restore it; the completion never appears in
// Recent changes (no Undo)." (fleet, 22 Nov)
//
// After POST /tasks/:id/complete changes a task:
//   · ticked: a line in Recent changes ("Ticked: Mail a birthday card for
//     Renee Castillo.") whose Undo is the same untick, and, for a next step's
//     task, the journey moved on NOW, with every change it made recorded
//     (planEffects.js) against the step that closed;
//   · unticked: the line leaves Recent changes. The journey went back already,
//     in linkedTaskChange, before the step reopened.
"use strict";

const WE = require("../effects/writeEffects");
const PE = require("../effects/planEffects");

async function afterTick({ query, run, actor, advanceCultivationPlan }, req, t, done) {
  const orgId = req.user.orgId, who = actor(req), db = { query, run };
  if (!done) return WE.finish(db, orgId, "task_done", t.id, who, "unticked");
  const [d] = t.donor_id ? await query("SELECT name FROM donors WHERE id=? AND org_id=?", [t.donor_id, orgId]) : [];
  const parent = { orgId, kind: "task_done", id: t.id, donorId: t.donor_id || null, who };
  await WE.finish(db, orgId, "task_done", t.id, who, "ticked again");   // one line per task, the latest tick
  await WE.begin(db, { ...parent, sentence: `Ticked: ${t.title || "a task"}${d && d.name ? ` for ${d.name}` : ""}.`,
    undo: { label: "Undo", path: `/tasks/${encodeURIComponent(t.id)}/complete`, body: { done: false } } });
  if (t.link_kind !== "next_step" || !t.thread_id || !t.donor_id) return null;
  const [th] = await query("SELECT closed_at FROM threads WHERE id=? AND org_id=?", [t.thread_id, orgId]);
  if (!th || !th.closed_at) return null;
  return PE.advanceWithEffects(advanceCultivationPlan, parent, t.thread_id, { actorId: who.id, actorName: who.name })
    .catch(e => console.error("[plan] advance on tick:", e.message));
}

module.exports = { afterTick };
