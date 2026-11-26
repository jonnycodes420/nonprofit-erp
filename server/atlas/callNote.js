// server/atlas/callNote.js · ATLAS-12 item 4. A CALL SHE REPORTS IS LOGGED, NOT REFUSED.
//
// Jarvis (25 Nov, a repeat): "'I called Renee Castillo today. She said she
// will give $5,000 in January. Remind me Jan 5' got 'I can't predict future
// giving', so no call was saved and no Jan 5 task was created." The forecast
// guard (grounded.js isPrediction) read "will give $5,000" as her asking
// Atlas to predict; and with AI off nothing read "I called <name>" at all.
//
// Here, when no model reads her words (AI off, or the read failed: routes/atlas.js readSteps): a message that opens with a conversation she had
// ("I called", "spoke with", "met with", "had coffee with" a name) is that
// conversation, logged with her words as the note (routes/atlas.js
// log_conversation, through atlasNote.js), and a "remind me <day>" in it is a
// follow-up on that person on the day she named. Both are PROPOSED (SENDS-1):
// nothing is written until she presses Save. What the person said they will
// give is her note, never a gift or a pledge: money waits for her own words.
"use strict";

const NAME = "((?:[A-Z][\\w'’.-]*)(?:\\s+(?:[A-Z][\\w'’.-]*|de|da|del|van|von|der|la|le)){0,3})";
// The verb in any case; the name only as a Name (capitalized), so "today" is never part of it.
const OPEN = /^(?:so |ok |okay |well |just )?(?:i |we )?(?:just )?(called|phoned|rang|spoke (?:with|to)|talked (?:with|to)|met(?: with)?|visited|had (?:a |an )?(?:call|phone call|coffee|lunch|breakfast|dinner|meeting|visit|chat) with|caught up with)\s+(.*)$/i;
const NAME_AT = new RegExp(`^${NAME}(.*)$`);
const HOW = w => (/call|phone|rang/i.test(w) ? "call" : /coffee/i.test(w) ? "coffee" : /lunch/i.test(w) ? "lunch" : /breakfast/i.test(w) ? "breakfast" : /dinner/i.test(w) ? "dinner"
  : /visit/i.test(w) ? "visit" : /met|meeting/i.test(w) ? "meeting" : "call");
const REMIND = /\b(?:remind me|set a reminder|follow up|add a task|make a task)\b(.*)$/i;
const OTHER_ASK = /\b(?:gave|donated|wrote (?:a|us) (?:check|cheque)|pledged|draft|email (?:her|him|them)|send|add (?:her|him|them)|put (?:her|him|them)|register|rsvp|sign (?:her|him|them) up|(?:come|coming|go|going) to (?:the|our)|attend\w*|gala|event|journey|group|receipt|thank)\b/i;
const sentences = t => String(t || "").split(/(?<=[.!?])\s+|\s*;\s*/).map(x => x.trim()).filter(Boolean);

// The steps her message is, or null when it is not a conversation she is reporting.
function read(text) {
  const parts = sentences(text);
  if (!parts.length) return null;
  const v = parts[0].match(OPEN);
  const n = v && v[2].match(NAME_AT);
  if (!n) return null;
  const m = [null, v[1], n[1], n[2]];
  const who = m[2].replace(/[.,]+$/, "").replace(/\s+(?:Today|Yesterday|This|Last|On)$/, "").trim();
  if (!who || /^(?:I|We|She|He|They|Her|Him|Them)$/.test(who)) return null;
  const rest0 = String(m[3] || "").replace(/^[,.\s]+/, "");
  const whenWords = (rest0.match(/\b(today|yesterday|this (?:morning|afternoon|evening)|last (?:night|week|\w+day)|on \w+day|on [A-Z][a-z]+ \d{1,2})\b/i) || [])[1] || "";
  const steps = [{ kind: "log_conversation", who, target: "", amountWords: "", whenWords, how: HOW(`${m[1]} ${rest0}`), words: parts[0] }];   // atlasNote.js takes the note from her message, from this sentence on
  // A gift she reports, a draft, a journey or a group is more than a call note: the usual read takes the whole message.
  if (parts.slice(1).some(p => !REMIND.test(p) && OTHER_ASK.test(p))) return null;
  const said = parts.slice(1).filter(p => !REMIND.test(p)).join(" ").trim();
  const r = parts.map(p => p.match(REMIND)).find(Boolean);
  if (r) {
    const remindWords = r[1].replace(/^\s*(?:me\s+)?(?:to\s+)?/i, "").trim();
    const first = who.split(/\s+/)[0];
    const about = said ? `: ${said.replace(/^(?:she|he|they)\s+/i, m0 => m0.toLowerCase()).replace(/[.!]+$/, "")}` : "";
    steps.push({ kind: "reminder", who, target: "", amountWords: "", whenWords: remindWords || "", how: "", words: `Follow up with ${first}${about}`,
      title: `Follow up with ${first}${about}`.slice(0, 200) });
  }
  return steps;
}

module.exports = { read };
