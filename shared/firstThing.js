// shared/firstThing.js — TASKS-2. THE FIRST THING, SAID LIKE A PERSON.
//
// Home's "First thing" card printed the donor's whole name and then the
// logged line with its first letter lowered: "Christine Stewart she asked for
// the impact report today." Two subjects, one sentence. The line she typed is
// written from her side ("She asked for…"), so the pronoun is the person, and
// the person's first name goes where the pronoun was:
//
//   "Christine asked for the impact report. Send it today."
//
// The second sentence is the step, said with its day. When the step's object
// is already in the first sentence ("the impact report"), it becomes "it".
// Pure: no clock of its own (the caller passes the org's civil today).

import { agoPhrase, durationPhrase } from "./homeNote.js";

const PRONOUN = /^(she|he|they)\s+(.+)$/i;
const ARTICLE = /^(the|a|an|her|his|their|our|your)\s+/i;
const ORG_WORD = /\b(foundation|fund|trust|inc|llc|church|company|co|corp|corporation|association|society|council|bank|group|partners|university|school|college|ministries|institute)\b\.?/i;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const civil = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
export function civilDays(from, to) {
  const a = civil(from), b = civil(to);
  return a == null || b == null ? null : Math.round((b - a) / 86400000);
}

// A person's first name; an organisation keeps its whole name.
export function callName(name) {
  const s = String(name || "").trim();
  if (!s) return "They";
  if (ORG_WORD.test(s) || !/\s/.test(s)) return s;
  return s.split(/\s+/)[0];
}

// "today" · "tomorrow" · "by Friday" (inside six days) · "by Oct 14" · late.
export function whenPhrase(due, today) {
  const d = civilDays(today, due);
  if (d == null) return "";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 0) return `${durationPhrase(-d)} late`;
  const t = civil(due);
  const dt = new Date(t);
  if (d < 7) return `by ${WEEKDAYS[dt.getUTCDay()]}`;
  return `by ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

const clean = s => String(s || "").trim().replace(/\s+/g, " ").replace(/[.!?\s]+$/, "");

// What happened, with the person as the subject.
export function whatHappened({ donorName, line, touchDate, today, fallback }) {
  const name = String(donorName || "").trim() || "Someone";
  const said = clean(line);
  const ago = touchDate && today ? civilDays(touchDate, today) : null;
  const when = ago != null && ago > 0 ? ` (${agoPhrase(ago)})` : "";
  if (said) {
    const p = PRONOUN.exec(said);
    if (p) return `${callName(name)} ${p[2]}${when}.`;
    if (said.toLowerCase().startsWith(name.toLowerCase()) || said.toLowerCase().startsWith(callName(name).toLowerCase() + " "))
      return `${said}${when}.`;
    return `${name}: ${/^[A-Z][a-z]/.test(said) ? said.charAt(0).toLowerCase() + said.slice(1) : said}${when}.`;
  }
  // No line was logged: a planned step, or a gift that opened the thread.
  const agoWord = ago != null && ago > 0 ? ` ${agoPhrase(ago)}` : " today";
  const gift = /^\$[\d,.]+ received$/.exec(clean(fallback));
  if (gift) return `${name} gave ${clean(fallback).replace(/ received$/, "")}${agoWord}.`;
  return `You planned this for ${name}${agoWord}.`;
}

// The step, with "it" when its object was just named, and its day.
export function stepPhrase({ label, due, today, said }) {
  let step = clean(label);
  if (!step) return "";
  const m = /^(\S+)\s+(.+)$/.exec(step);
  if (m) {
    const obj = m[2].replace(ARTICLE, "").replace(/^(to|for)\s+/i, "");
    const heard = String(said || "").toLowerCase();
    if (obj.length > 2 && !/^[A-Z]/.test(obj) && heard.includes(obj.toLowerCase()) && !/^(about|with|on|in|re|at)\b/i.test(m[2])) step = `${m[1]} it`;
  }
  step = step.charAt(0).toUpperCase() + step.slice(1);
  const w = whenPhrase(due, today);
  if (!w) return `${step}.`;
  return /late$/.test(w) ? `${step}, ${w}.` : `${step} ${w}.`;
}

// The card's two sentences, from one Thread row (composeThreads' shape).
export function firstThingSentences(row, today) {
  const lt = (row && row.lastTouch) || {};
  const fallback = lt.kind === "gift" && lt.amount != null ? `$${Number(lt.amount).toLocaleString("en-US")} received` : (lt.kind === "none" ? "planned" : "logged");
  const happened = whatHappened({ donorName: row && row.donorName, line: lt.line, touchDate: lt.date || (row && row.openedOn), today, fallback });
  // A one-word step ("Thank", "Call") takes the person: "Thank Ruth today."
  const raw = clean(row && row.nextStep && row.nextStep.label);
  const label = raw && !/\s/.test(raw) ? `${raw} ${callName(row && row.donorName)}` : raw;
  const next = stepPhrase({ label, due: row && row.nextStep && row.nextStep.due, today, said: happened });
  return { happened, next };
}
