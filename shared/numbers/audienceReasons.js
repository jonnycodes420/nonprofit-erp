// shared/numbers/audienceReasons.js · FLOWS-7 (W-1112-Fundraising-16X). ONE
// ANSWER TO "WHO IN THIS AUDIENCE CAN'T GET IT, AND WHY".
//
// The first staging night: Communications' Overview said "Everyone with an
// email" was 1,232 people, and its reasons added to 1,231; the campaign editor,
// for the same audience, said 2 unsubscribed and 1 bounced and added to 1,232.
// Two functions counted it: the Overview (audienceReach.js) over Everyone's
// people, the editor (campaignAudience) over every record not deleted,
// archived and erased included. A person on both sides of that line, or an
// address carrying both an unsubscribe and a bounce, landed differently.
//
// THE RULE, for both screens:
//   · The audience is the segment's people by Everyone's rule (everyone.js:
//     not in the trash, archived or erased). Nobody outside it is counted,
//     reached or mailed.
//   · Each person is in exactly ONE place: can get it, or one reason. The
//     reason is the send's own decision (routes/email.js donorMailDecision),
//     which tries its rules in a fixed order (sample, deceased, bounced, do not
//     contact, unsubscribed, the suppression list, then the campaign switch),
//     so a person both unsubscribed and bounced is counted once, as bounced.
//   · Two spellings of one reason are one bucket ("unsubscribe" from the
//     suppression list is "unsubscribed").
//   · reach + every reason's count = the audience. Always.
// Pure: the caller reads the people and the decisions; this only sorts them.
"use strict";
const { isEveryone, hasEmail } = require("./everyone");

// The order the reasons are listed in (the editor's order since EDITOR-1).
const REASON_ORDER = ["no_email", "deceased", "do_not_contact", "unsubscribed", "bounced", "complained", "blocked_address",
  "sample_donor", "donor_never", "skipped", "not_chosen", "type_off", "auto_email_off", "not_sendable"];
const SAME = { unsubscribe: "unsubscribed" };
const canonical = r => SAME[r] || r || "not_sendable";

// people: the segment's records (any state); decisionOf: id -> { send, reason }
function audienceReasons(people, decisionOf) {
  const audience = (people || []).filter(isEveryone);
  const reach = [];
  const by = new Map();
  for (const d of audience) {
    const dec = hasEmail(d) ? (decisionOf(d.id) || { send: false, reason: "not_sendable" }) : { send: false, reason: "no_email" };
    if (dec.send) { reach.push(d); continue; }
    const r = canonical(dec.reason);
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(d);
  }
  const rank = r => { const i = REASON_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  const groups = [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length)
    .map(([reason, ppl]) => ({ reason, count: ppl.length, people: ppl }));
  return { audience, reach, groups, leftOutCount: groups.reduce((n, g) => n + g.count, 0) };
}

module.exports = { audienceReasons, REASON_ORDER, canonicalReason: canonical };
