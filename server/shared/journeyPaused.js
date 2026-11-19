// server/shared/journeyPaused.js · FLOWS-19 item 3 (Area 1 Explore 8). A PAUSED JOURNEY NEVER ACTS.
//
// Pausing a journey stopped new people going in (every start reads
// journey_enabled), but the people already in it carried on: their next step
// still opened (a Thread, a task, a draft, a timeline line by "Steward
// (journey)"), a step set to send itself still went, and touches were still
// re-spaced around it. Now, while a journey is paused, everybody in it waits at
// the step they are on: nothing opens, nothing sends, nothing moves. Resuming
// it picks them up where they were. A step that was already open stays open (it
// already happened); a person can still do it, skip it or stop the journey.
//
// Paused is journeyShape.journeyState's "paused" for a journey that has run:
// switched off (journey_enabled false) after being on (ever_enabled), and not
// archived. An officer's plan template that was never a running journey is not
// paused and its plans advance as before.
"use strict";

// SQL: template `t` is a paused journey.
const PAUSED = (t = "t") => `(${t}.journey_enabled IS NOT TRUE AND ${t}.ever_enabled IS TRUE AND ${t}.archived_at IS NULL)`;

// The ids among `templateIds` that are paused journeys.
async function pausedJourneyIds(query, orgId, templateIds) {
  const ids = [...new Set((templateIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Set();
  const rows = await query(`SELECT t.id FROM cultivation_templates t WHERE t.org_id = ? AND t.id = ANY(?::text[]) AND ${PAUSED("t")}`, [orgId, ids]);
  return new Set(rows.map(r => r.id));
}

// Turned back on: everybody still in it takes their next step now (the one advance). Returns how many.
async function resume({ query, advanceCultivationPlan }, orgId, templateId, who) {
  const people = await query(`SELECT DISTINCT donor_id FROM cultivation_plans WHERE org_id=? AND template_id=? AND status='active'`, [orgId, templateId]);
  for (const p of people) {
    await advanceCultivationPlan(orgId, p.donor_id, { actorId: who.id, actorName: who.name }).catch(e => console.error("[journey] resume:", e.message));
  }
  return people.length;
}

module.exports = { PAUSED, pausedJourneyIds, resume };
