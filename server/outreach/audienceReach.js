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
const EV = require("../../shared/numbers/everyone");
const AR = require("../../shared/numbers/audienceReasons");

async function audienceReach(orgId, segments, { query, resolveSegmentSpec, filterBySegment }) {
  const { donorMailDecisions } = require("../../routes/email");
  const everyone = await query("SELECT * FROM donors WHERE org_id = ? AND deleted_at IS NULL", [orgId]);
  const hasEmail = d => !!(d.email && String(d.email).trim());
  const decisions = await donorMailDecisions("campaign", everyone.filter(hasEmail), orgId, { personOnly: true });
  const out = [];
  for (const raw of segments) {
    const seg = await resolveSegmentSpec(raw || {}, orgId);
    const inSegment = filterBySegment(everyone, seg);
    // TRUTH-6 (W-1110-Fundraising-16): everyone the audience holds, and each
    // one who can't get the email with why, so "0 can get this email" is never
    // said beside a group of 1,217 without the reasons that add up to it.
    // FLOWS-7: the one audience-reasons rule (shared/numbers/audienceReasons.js),
    // the same call the campaign editor makes, so the two always agree and add up.
    const a = AR.audienceReasons(inSegment, id => decisions.get(id));
    out.push({
      members: a.audience.length,
      cannot: a.groups.map(g => ({ reason: g.reason, count: g.count })),
      // TRUTH-4 (W-1108-Fundraising-25X): "N people in it" is the audience's
      // people by Everyone's one rule (everyone.js: not in the trash, archived
      // or erased) who have an email address, so it is never above Everyone.
      inSegment: a.audience.filter(EV.hasEmail).length,
      reach: a.reach.length,
    });
  }
  return out;
}

module.exports = { audienceReach };
