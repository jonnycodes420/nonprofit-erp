// server/grants/applicationOpen.js · MONEY-4 (W-1107-Finance-31).
// Once a grant is awarded (or reporting, or closed), its application is closed
// and its application deadlines DISAPPEAR: the LOI, the proposal, the decision
// and the grant's own deadline date. Report deadlines and custom ones stay.
// The SQL twin of shared/grantMilestones.js applicationClosed, for the
// Calendar and Home's count; the Deadlines list filters on that function.
"use strict";
const AWARDED = ["awarded", "active", "reporting", "closed"];
const APPLICATION_KINDS = ["loi_due", "proposal_due", "decision"];
// m: grant_milestones alias, g: grants alias. True while the deadline still matters.
const APPLICATION_DEADLINE_SHOWS = (m = "m", g = "g") =>
  `NOT (lower(COALESCE(${g}.status, '')) IN (${AWARDED.map(s => `'${s}'`).join(",")}) AND ${m}.kind IN (${APPLICATION_KINDS.map(s => `'${s}'`).join(",")}))`;
module.exports = { APPLICATION_DEADLINE_SHOWS, AWARDED, APPLICATION_KINDS };
