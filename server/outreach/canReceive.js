// server/outreach/canReceive.js · CAMPAIGN-2 item 3 (SENDS-3 item 3). WHO CAN RECEIVE IT, SAID FIRST.
//
// Jarvis (staging): "Campaign emails: 1,117 of 1,119 staging donors cannot receive one until
// Campaign emails are turned on; the gap is not surfaced before planning." The audience line said
// it as the last of its reasons ("· 1,117 wait until Campaign emails are on"). At the audience
// step the one thing that stops most of the list now leads, as a sentence over the whole
// audience, with where the switch is (campaignTurnOn.js); the other reasons follow it as figures
// that open their people (AudienceLine). Nothing here turns anything on.
//
// The waiting reason is the org's: Campaign emails off (the "campaign" mail type), or Donor mail
// off for the whole org. A reason that is a person's own (no address, unsubscribed, deceased) is
// never the headline.
"use strict";

const WAITING = { type_off: "Campaign emails are off for your organization." };

// line: audienceLine's { total, groups }. Returns null when nothing is waiting on the org.
// orgWhy: the sentence for the org-wide gate (Donor mail off), from audienceLine.
function canReceiveHeadline({ total, groups, orgWhy = null }) {
  const waits = (groups || []).filter(g => WAITING[g.reason] || /^org_/.test(g.reason));
  if (!waits.length || !total) return null;
  const count = waits.reduce((n, g) => n + g.count, 0);
  // Donor mail off first (it stops everything), then Campaign emails off.
  const whys = [...waits.filter(g => /^org_/.test(g.reason)).map(() => orgWhy), ...waits.filter(g => WAITING[g.reason]).map(g => WAITING[g.reason])].filter(Boolean);
  const why = whys.map((x, i) => i ? x : x.charAt(0).toUpperCase() + x.slice(1)).join(" ");
  const others = (groups || []).filter(g => !waits.includes(g));
  return {
    reasons: waits.map(g => g.reason),
    count,
    of: total,
    // "1,117 of 1,119 can't receive this yet: Campaign emails are off for your organization."
    sentence: `${count.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} can't receive this yet${why ? ": " + why : "."}`,
    others: others.map(g => g.reason),
    othersSentence: others.length ? "The rest can't receive it for their own reasons:" : null,
  };
}

module.exports = { canReceiveHeadline, WAITING };
