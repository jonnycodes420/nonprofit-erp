// server/atlas/noSource.js · FLOWS-13 item 6 (W-1114-Atlas-23). A QUESTION NOTHING IN STEWARD ANSWERS, ANSWERED AT ONCE.
//
// "The Check 7 unknowable question was asked at 03:37 … answered after the minute
// boundary, over 20 seconds. A user waiting on an answer Atlas cannot give waits the
// longest for it." Atlas read every request with the model first (up to 12 s), and
// only then asked its own code whether the question was one it could answer; a
// question it could not went on to Ask's lookup loop (up to 20 s more) to come back
// with "I can't answer that".
//
// Now a question is checked in code before any model is asked. One that names
// nothing Steward keeps (no person on file, and none of the words for what Steward
// holds: gifts, people, events, volunteers, tasks, grants, mail, money, dates) is
// answered at once: "I can't see that in your data." Anything that might be about
// her records still goes the usual way.
"use strict";

const LINE = "I can't see that in your data. Ask me about your people, their gifts and pledges, events, volunteers, tasks or grants, and I'll read it from your records.";

// A question, in her words: a question mark, or a question word first.
const ASKING = /\?\s*$|^\s*(?:what|what's|whats|who|who's|whom|whose|when|where|why|how|which|is|are|was|were|do|does|did|can|could|will|would|should|tell me)\b/i;
// Anything Steward keeps, or a way of asking about the org's own people and money.
const KEPT = new RegExp("\\b(?:" + [
  "donor", "donors", "donat\\w*", "gave", "give", "gives", "giving", "given", "gift\\w*", "pledg\\w*", "rais\\w*", "money", "dollars?", "revenue", "income", "amount\\w*", "total\\w*", "average", "largest", "biggest", "smallest",
  "lifetime", "recurring", "monthly", "sustain\\w*", "lapsed", "lybunt", "sybunt", "retention", "retain\\w*", "drift\\w*", "quiet", "stopped", "upgrad\\w*", "downgrad\\w*",
  "people", "person", "someone", "anyone", "everyone", "who", "whom", "whose", "contacts?", "members?", "membership\\w*", "household\\w*", "famil\\w*", "spouse", "board", "staff", "team", "officer\\w*", "portfolio\\w*",
  "event\\w*", "gala", "guests?", "attend\\w*", "came", "rsvp\\w*", "tickets?", "volunteer\\w*", "shifts?", "hours?",
  "tasks?", "calls?", "call", "visits?", "meetings?", "met", "follow[- ]?ups?", "next steps?", "thank\\w*", "acknowledg\\w*", "receipts?", "letters?", "emails?", "mail\\w*", "notes?", "conversations?",
  "grants?", "funders?", "foundations?", "deadlines?", "reports?", "campaigns?", "appeals?", "funds?", "restricted", "goals?", "journeys?", "groups?", "segments?", "tags?", "asks?", "pipeline", "moves?", "proposals?",
  "top", "first", "last", "latest", "recent\\w*", "new", "today", "yesterday", "week", "month", "quarter", "year", "fy", "fiscal", "since", "ago", "between",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  // A request, not a question about the world: anything she asks Atlas to do is read as usual.
  "remind\\w*", "add\\w*", "log\\w*", "draft\\w*", "writ\\w*", "wrote", "schedul\\w*", "book\\w*", "start\\w*", "stop", "undo", "put", "mov\\w*", "mark\\w*", "record\\w*", "send\\w*", "sent",
  "creat\\w*", "make", "set", "find", "show", "list", "open", "remove", "delete", "brief", "tomorrow", "tonight", "morning", "afternoon", "noon",
  "our", "we", "us", "my", "mine", "me", "i", "org", "organization", "steward", "atlas", "address\\w*", "phone", "birthday", "employer", "wealth", "capacity", "score\\w*", "engag\\w*",
].join("|") + ")\\b", "i");
const MONEY_OR_YEAR = /\$\s?\d|\b(?:19|20)\d{2}\b/;

// Does `text` name someone on file? `names`: the org's people's names (any case).
// One pass: every word of three letters or more in a name, against her words.
function namesSomeone(text, names) {
  const words = new Set(String(text || "").toLowerCase().match(/[a-z\u00c0-\u024f'-]{3,}/g) || []);
  if (!words.size) return false;
  for (const n of names || []) {
    for (const part of String(n || "").toLowerCase().split(/[^a-z\u00c0-\u024f'-]+/)) if (part.length >= 3 && words.has(part)) return true;
  }
  return false;
}

// The line, when `text` is a question nothing in Steward could answer; else null.
function noSource(text, names) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || !ASKING.test(t)) return null;
  if (KEPT.test(t) || MONEY_OR_YEAR.test(t)) return null;
  if (namesSomeone(t, names)) return null;
  return LINE;
}

module.exports = { noSource, namesSomeone, LINE };
