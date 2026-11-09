// server/outreach/journeyActive.js · FLOWS-3 (W-1107-Fundraising-28). The
// by-hand doors (profile apply, the Journeys page's apply, the Donors list's
// batch preview and start) ask this before doing anything: a Draft or Paused
// journey answers 409 with the reason the picker shows. The start path
// (server/shared/journeyStart.js) refuses as well, so a door that forgets
// cannot start one.
"use strict";

async function journeyStateOf(query, J, orgId, t) {
  const everIn = t.journey_enabled ? 0 : (await query(`SELECT 1 FROM cultivation_plans WHERE org_id=? AND template_id=? LIMIT 1`, [orgId, t.id])).length;
  return J.journeyState({ enabled: !!t.journey_enabled, everEnabled: !!t.ever_enabled, archived: !!t.archived_at, everIn });
}

// Sends the 409 and returns true when `t` can't start people.
async function refuseNotActive(res, query, J, orgId, t) {
  const JR = await import("../../shared/journeyStartRule.js");
  const state = await journeyStateOf(query, J, orgId, t);
  if (JR.canStartState(state)) return false;
  const why = JR.notActiveWhy(state);
  res.status(409).json({ error: "journey_not_active", state, sentence: `${t.name} is ${why.charAt(0).toLowerCase()}${why.slice(1)}.`, message: `${t.name} is ${why.charAt(0).toLowerCase()}${why.slice(1)}.` });
  return true;
}

module.exports = { journeyStateOf, refuseNotActive };
