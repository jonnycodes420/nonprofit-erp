// server/outreach/audienceReach.js · COUNTS-1. AN AUDIENCE'S NUMBER IS THE
// NUMBER A CAMPAIGN TO IT WOULD REACH.
//
// Communications' Audiences rail said "Volunteers 13" (everyone in it with an
// email address) while a campaign to Volunteers said "Send to 1": the builder
// counts by the send's own decision for each person (campaignAudience in
// server.js, TRUST-1's campaignReach), and the rail counted addresses. The
// rail now counts the builder's way, step for step: the segment resolved
// (resolveSegmentSpec), its people (filterBySegment over every live person),
// and each one with an address kept only when donorMailDecision says send.
// The people are read once and the decisions once, for every audience.
"use strict";

async function audienceReach(orgId, segments, { query, resolveSegmentSpec, filterBySegment }) {
  const { donorMailDecisions } = require("../../routes/email");
  const everyone = await query("SELECT * FROM donors WHERE org_id = ? AND deleted_at IS NULL", [orgId]);
  const hasEmail = d => !!(d.email && String(d.email).trim());
  const decisions = await donorMailDecisions("campaign", everyone.filter(hasEmail), orgId, { personOnly: true });
  const out = [];
  for (const raw of segments) {
    const seg = await resolveSegmentSpec(raw || {}, orgId);
    const inSegment = filterBySegment(everyone, seg);
    out.push({
      inSegment: inSegment.length,
      reach: inSegment.filter(d => hasEmail(d) && (decisions.get(d.id) || {}).send).length,
    });
  }
  return out;
}

module.exports = { audienceReach };
