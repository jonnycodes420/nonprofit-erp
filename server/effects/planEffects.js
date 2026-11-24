// server/effects/planEffects.js · UNDO-1 item 3. A JOURNEY MOVED BY A TICK MOVES BACK WITH IT.
//
// Closing a next step (a task tick, Home's Done, a logged touch) runs
// advanceCultivationPlan: the journey's step is marked done, a one-step journey
// is finished, the next step's Thread opens. Reopening the step reopened the
// Thread and nothing else, so Renee's Birthday card stayed "completed" with
// its task open again.
//
// `advanceWithEffects` reads the person's journeys before and after the
// advance and records each change as an effect (write_effects), tagged with
// the next step whose close caused it. `reverseForThread` takes them back,
// newest first, when that step is reopened, by whichever door.
"use strict";

const { query: dbQuery, run: dbRun } = require("../../db");
const WE = require("./writeEffects");

async function snapshot(orgId, donorId) {
  const plans = await dbQuery("SELECT id, status, closed_at FROM cultivation_plans WHERE org_id=? AND donor_id=?", [orgId, donorId]);
  const steps = plans.length ? await dbQuery(
    "SELECT id, plan_id, status, closed_at, closed_by, closed_by_name, thread_id FROM cultivation_plan_steps WHERE org_id=? AND plan_id = ANY(?::text[])",
    [orgId, plans.map(p => p.id)]) : [];
  return { plans: new Map(plans.map(p => [p.id, p])), steps: new Map(steps.map(s => [s.id, s])) };
}

// Run the advance and record what it changed. `parent` is the write
// ({ orgId, kind, id, donorId, who }); `causeThreadId` the step that closed.
async function advanceWithEffects(advance, parent, causeThreadId, opts = {}) {
  const { orgId, donorId } = parent;
  const before = await snapshot(orgId, donorId);
  const out = await advance(orgId, donorId, opts);
  if (!before.plans.size) return out;
  const after = await snapshot(orgId, donorId);
  const db = { query: dbQuery, run: dbRun };
  for (const [id, s] of after.steps) {
    const b = before.steps.get(id);
    if (!b || (b.status === s.status && b.thread_id === s.thread_id)) continue;
    await WE.record(db, parent, { kind: "plan_advanced", table: "cultivation_plan_steps", rowId: id, before: b,
      after: { status: s.status }, causeThreadId });
  }
  for (const [id, p] of after.plans) {
    const b = before.plans.get(id);
    if (!b || b.status === p.status) continue;
    await WE.record(db, parent, { kind: "journey_completed", table: "cultivation_plans", rowId: id, before: b,
      after: { status: p.status }, causeThreadId });
  }
  // The next step the advance opened goes first on a reverse (newest first).
  for (const [id, s] of after.steps) {
    const b = before.steps.get(id);
    if (b && s.thread_id && s.thread_id !== b.thread_id && s.status === "open" && b.status === "pending") {
      await WE.record(db, parent, { kind: "step_opened", table: "threads", rowId: s.thread_id, before: null, causeThreadId });
    }
  }
  return out;
}

// Reopening step `threadId`: every journey change its close caused goes back.
function reverseForThread(db, orgId, threadId, who) {
  return WE.reverse(db || { query: dbQuery, run: dbRun }, orgId, { causeThreadId: threadId }, who,
    { kinds: ["plan_advanced", "journey_completed", "step_opened"], reason: "the step was reopened" });
}

module.exports = { advanceWithEffects, reverseForThread, snapshot };
