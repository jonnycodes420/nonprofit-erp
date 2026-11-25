// server/majorGifts/planStepUndo.js · SENDS-3 item 6. THE RAIL'S MARK DONE IS A WRITE WITH AN UNDO.
//
// UNDO-1: "the Journeys rail's own Mark done on a journey step (POST
// /plan-steps/:id/done) advances the journey without recording it". A task
// tick, Home's Done and a logged touch already record every change they make
// (server/effects/writeEffects.js) and have a Recent changes line with Undo.
// Now the rail's Mark done does too:
//   · a header line, "Marked done: <step> for <name>.", whose Undo is
//     POST /plan-steps/:id/reopen;
//   · the step's own close and its Thread's close, recorded before they happen;
//   · the journey's advance through advanceWithEffects (the next step opened,
//     a finished journey), recorded as it happens.
// Reopen takes every one of them back, newest first: the next step it opened
// goes (its timeline line and draft with it, planEffects.retireReopened), the
// journey is active again, the Thread and the step are open again, and the
// one line Mark done wrote on the timeline is taken off.
"use strict";

const WE = require("../effects/writeEffects");
const PE = require("../effects/planEffects");

const KIND = "plan_step_done";

// Before Mark done writes: the header and the two closes it is about to make.
async function beginDone({ query, run }, orgId, step, who) {
  const db = { query, run };
  const parent = { orgId, kind: KIND, id: step.id, donorId: step.donor_id, who };
  const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [step.donor_id, orgId]);
  await WE.finish(db, orgId, KIND, step.id, who, "done again");   // one line per step, the latest
  await WE.begin(db, { ...parent, sentence: `Marked done: ${step.label}${d && d.name ? ` for ${d.name}` : ""}.`,
    undo: { label: "Undo", path: `/plan-steps/${encodeURIComponent(step.id)}/reopen`, body: {} } });
  await WE.record(db, parent, { kind: "plan_advanced", table: "cultivation_plan_steps", rowId: step.id, before: step, after: { status: "done" } });
  if (step.thread_id) {
    const [th] = await query("SELECT * FROM threads WHERE id=? AND org_id=?", [step.thread_id, orgId]);
    if (th && !th.closed_at) await WE.record(db, parent, { kind: "step_closed", table: "threads", rowId: th.id, before: th, after: { closed: true } });
  }
  return parent;
}

// The journey moves on, every change recorded against this Mark done.
function advance(advanceCultivationPlan, parent, step, opts) {
  return PE.advanceWithEffects(advanceCultivationPlan, parent, step.thread_id || null, opts);
}

// POST /plan-steps/:id/reopen. -> { status, body }
async function reopen({ query, run }, orgId, step, who) {
  const db = { query, run };
  if (step.status !== "done") return { status: 409, body: { error: "not_done", sentence: "That step is not marked done." } };
  const [h] = await query(`SELECT id FROM write_effects WHERE org_id=? AND parent_kind=? AND parent_id=? AND kind='write' AND undone_at IS NULL`,
    [orgId, KIND, step.id]);
  if (!h) return { status: 409, body: { error: "no_undo", sentence: "This step was marked done before Steward kept a record of what that changed, so it can't be undone here." } };
  const back = await PE.reverseForParent(db, orgId, KIND, step.id, who);
  // The line Mark done wrote, once nothing points at it any more.
  await run(`DELETE FROM interactions i WHERE i.org_id=? AND i.donor_id=? AND i.metadata->>'via' = ? AND i.metadata->>'step_id' = ?
               AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.org_id = i.org_id AND t.closing_interaction_id = i.id)`,
    [orgId, step.donor_id, KIND, step.id]);
  await WE.finish(db, orgId, KIND, step.id, who, "reopened");
  const kept = WE.keptSentence(back);
  const nextBack = back.some(r => r.ok && r.kind === "step_opened");
  return { status: 200, body: { ok: true, reopened: true,
    sentence: `${step.label} is open again.${nextBack ? " The step that opened after it is waiting again." : ""}${back.some(r => r.ok && r.kind === "journey_completed") ? " The journey is active again." : ""}${kept ? " " + kept : ""}` } };
}

module.exports = { beginDone, advance, reopen, KIND };
