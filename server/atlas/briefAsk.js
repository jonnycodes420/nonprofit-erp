// server/atlas/briefAsk.js · ATLAS-12 item 6. A BRIEF READS AS A BRIEF, ON ANYONE ON FILE.
//
// Jarvis (21 Nov, a repeat): "Atlas briefs still read as labeled chips, not a
// brief, the staging [donor] brief returns a can't-answer line, and a brief
// does not say 'No conversation logged' when none exists." On staging (26 Nov)
// "Brief me on Fenwick Holdings, Inc." said "I couldn't find Fenwick Holdings"
// (the reader stopped at the comma), "Brief on …" was a can't-read, and
// "Prep me for my call with Hester Vanderpool" looked for a person called "my
// call with Hester Vanderpool".
//
//   read      the brief's words in any of their shapes, and the name matched
//             against every name on file, longest first, punctuation and case
//             aside: the whole name, commas and all. No name on file: null,
//             and the usual read says it couldn't find them.
//   summary   the two or three plain sentences a brief opens with: who they are
//             to the org and their giving shape, the last conversation (or "No
//             conversation logged yet."), and the next move. Every fact in them
//             is one the brief's own lines carry.
"use strict";

const LEAD = /^(?:(?:hey|ok|okay|so)\s+)?(?:atlas[,]?\s+)?(?:(?:please|can you|could you|would you|will you)\s+)?(?:brief me (?:on|about)|give me (?:a )?brief(?:ing)? (?:on|about)|(?:a )?brief(?:ing)? (?:on|about)|prep me (?:for|on)|get me ready for|tell me about|what do (?:we|i) know about|who is)\s+(.+?)\s*[?.!]*$/i;
const EVENT = /^(?:my |the |our |a |this )?(?:call|meeting|lunch|coffee|visit|chat|conversation|breakfast|dinner|ask)\s+(?:with\s+)?/i;
const TAIL = /\s+(?:before|ahead of|for)\s+(?:my|the|our|a|this)\s+.*$|\s+(?:today|tomorrow|this (?:morning|afternoon|week)|please)$/i;
const flat = s => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// [{ kind: "about", who }] when her words ask for a brief on a name on file; null otherwise.
function read(text, all) {
  const m = String(text || "").replace(/\s+/g, " ").trim().match(LEAD);
  if (!m) return null;
  const said = m[1].replace(EVENT, "").replace(/^(?:(?:dr|mr|mrs|ms|mx)\.?\s+)/i, "").replace(TAIL, "").trim();
  const f = flat(said);
  if (f.length < 3) return null;
  let best = null;
  for (const p of all || []) {
    const n = flat(p && p.name);
    if (n.length < 3) continue;
    if ((f === n || f.startsWith(n + " ")) && (!best || n.length > flat(best.name).length)) best = p;
  }
  return best ? [{ kind: "about", who: best.name, target: "", amountWords: "", whenWords: "", how: "", words: text }] : null;
}

// The opening sentences. `p`: what personAnswer read.
const CONTACT = new Set(["call", "meeting", "email", "visit", "ask", "text", "letter", "stewardship", "event", "volunteer"]);
const KIND = { call: "a call", meeting: "a meeting", email: "an email", visit: "a visit", ask: "an ask", text: "a text", letter: "a letter",
  stewardship: "a thank-you", event: "an event they came to", volunteer: "a volunteer shift" };
function summary({ name, first, isOrg, giftCount, lifetime, lastAmount, lastDay, since, rhythm, convs, next, day }) {
  const who = isOrg ? `${name} is an organization on file` : `${name} is ${giftCount ? `a donor${since ? ` since ${day(since)}` : ""}` : "on file as a contact"}`;
  const shape = giftCount
    ? `${who}, and has given ${lifetime} across ${giftCount} ${giftCount === 1 ? "gift" : "gifts"}${rhythm ? `, ${rhythm}` : ""}, most recently ${lastAmount} on ${day(lastDay)}.`
    : `${who} and has not given yet.`;
  const talk = (convs || []).find(c => CONTACT.has(c.type));
  const contact = talk ? `The last conversation was ${KIND[talk.type] || "a conversation"} on ${day(talk.date)}.` : "No conversation logged yet.";
  const move = next ? `Next: ${next.replace(/^(?:Next move|Next step|Next):\s*/i, "").replace(/^(\w)/, c => c.toLowerCase()).replace(/\.$/, "")}.` : `There is no next step planned for ${first}.`;
  return `${shape} ${contact} ${move}`;
}

module.exports = { read, summary, CONTACT };
