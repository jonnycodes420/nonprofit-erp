// shared/atlasNote.js · ATLAS-4. A CONVERSATION ATLAS LOGS KEEPS HER WORDS.
//
// Walk B: "Log a call with Henderson. Notes: she wants to fund the bus. Next
// step: send the budget." saved a note without "Notes:" and "Next step:" and
// often without what followed them. The note was the read's `words` for the
// conversation step: the model's copy of the part it judged to be the call,
// or (AI off) only the clause "Log a call with Henderson", since every
// sentence after the first full stop was read as a step of its own.
//
// The note is now cut from what she typed, verbatim: from the sentence that
// names the conversation through every sentence after it that is part of it
// (a labelled line such as "Notes:" or "Next step:", or anything that is not
// a request of its own), until another request starts. Pure.
//
// ATLAS-5 (W-1108-Atlas-03X): "Sterling prefers morning calls. QA A5" saved
// the note without "QA A5", and "QA A5" came back as a second request Atlas
// could not do. A note is cut the same way as a conversation (noteText): the
// whole message, until a request of its own starts. Only an explicit
// "and also …" splits it.
import { readClause } from "./atlas.js";

// A request of its own ends the note: what follows is not about the call.
const OWN_REQUEST = new Set(["add_to_journey", "remove_from_journey", "add_to_group", "remove_from_group", "gift", "pledge", "draft_email", "send_now",
  "find", "question", "merge", "link", "came_to_event", "register_for_event", "undo", "about", "recurring_change", "log_conversation", "send_receipt", "reminder"]);
const LABEL = /^[A-Z][A-Za-z' -]{0,30}:\s*\S/;
const BREAK = "\u0001";   // where she said "and also": the note ends there
const sentencesOf = text => String(text || "").replace(/,?\s+and also\s+/gi, `\u0002 ${BREAK}`).split(/(?<=[.!?;\u0002])\s+|\n+/).map(s => s.trim()).filter(Boolean);
const said = s => s.replace(/[\u0001\u0002]/g, "").trim();
const lower = s => String(s || "").toLowerCase();

export function conversationNote(text, step) {
  const all = sentencesOf(text);
  const who = lower(String((step && step.who) || "").split(/\s+/)[0]);
  const how = lower(step && step.how);
  const words = String((step && step.words) || "").trim();
  if (!all.length) return words;
  // Where the conversation starts: the sentence naming the person, with the
  // kind of conversation if there is one.
  const own = s => OWN_REQUEST.has(readClause(s.replace(/[.!?;]+$/, "")).kind) && readClause(s.replace(/[.!?;]+$/, "")).kind !== "log_conversation";
  let at = all.findIndex(s => who && lower(s).includes(who) && (!how || lower(s).includes(how)));
  // "Add Marlowe to the journey. Had lunch with her.": the call's sentence, not the request before it.
  if (at < 0 && how) at = all.findIndex(s => lower(s).includes(how) && !own(s));
  if (at < 0) at = all.findIndex(s => who && lower(s).includes(who) && !own(s));
  if (at < 0 && words) at = all.findIndex(s => lower(s).includes(lower(words).slice(0, 24)));
  if (at < 0) return words;
  const out = [said(all[at])];
  for (let i = at + 1; i < all.length; i++) {
    const s = all[i];
    if (s.startsWith(BREAK)) break;
    if (LABEL.test(s)) { out.push(said(s)); continue; }
    const k = readClause(s.replace(/[.!?;]+$/, "")).kind;
    if (OWN_REQUEST.has(k)) break;
    out.push(said(s));
  }
  const note = out.join(" ");
  // Her words for the call, if the read had more than this cut (it never should).
  return words && !lower(note).includes(lower(words)) && lower(text).includes(lower(words)) ? `${note} ${words}` : note;
}

// A note ("Sterling prefers morning calls. QA A5"): from the sentence that
// holds her words for it through every sentence that is not a request of its own.
export function noteText(text, step) {
  const all = sentencesOf(text);
  const words = String((step && step.words) || "").trim();
  if (!all.length) return words;
  const who = lower(String((step && step.who) || "").split(/\s+/)[0]);
  const key = lower(words).replace(/[.!?;]+$/, "").slice(0, 24);
  let at = key ? all.findIndex(s => lower(said(s)).includes(key)) : -1;
  if (at < 0) at = all.findIndex(s => who && lower(s).includes(who));
  if (at < 0) return words;
  const out = [said(all[at])];
  for (let i = at + 1; i < all.length; i++) {
    const s = all[i];
    if (s.startsWith(BREAK)) break;
    if (LABEL.test(s)) { out.push(said(s)); continue; }
    if (OWN_REQUEST.has(readClause(said(s).replace(/[.!?;]+$/, "")).kind)) break;
    out.push(said(s));
  }
  const note = out.join(" ");
  return words && !lower(note).includes(lower(words).replace(/[.!?;]+$/, "")) && lower(text).includes(lower(words)) ? `${words} ${note}` : note;
}

export default { conversationNote, noteText };
