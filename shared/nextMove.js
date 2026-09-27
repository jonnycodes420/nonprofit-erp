// shared/nextMove.js — FIX-3 finding 11. THE NEXT MOVE, IN THREE PLAIN SENTENCES.
//
// The walk (27 September) opened Sunrise's profile and the Suggested panel
// read "When to make it is now… What to say is… What it is for is…". The
// prompt had asked for "the move to make, when to make it, what to say, and
// what it is for", and the model echoed the labels back as the subjects of
// its sentences. It also spoke of "underserved NYC youth" and "the cycle
// deadline approaching", which the validator never looked at.
//
// Now the model fills three fields — when, say, for — and THIS module turns
// them into three short plain sentences: the label scaffolding is cut, a
// fragment gets the few words that make it a sentence, and every sentence
// goes through the FIX-1 validator (shared/suggestionGuard.js) against the
// record.
//
// HOTFIX-1 changed two things about what comes out.
//   · A REFUSED LINE IS SILENT. It is counted and its reason is returned for
//     the log; it never becomes a sentence on the screen. When nothing
//     survives and nothing is open, the text is EMPTY and the panel does not
//     render — an empty answer is better than an answer about itself.
//   · THE OPEN WORK LEADS. The walk's profile answered "what do I do next"
//     with nothing while a proposal and a follow-up sat open on the same
//     screen. The record knows the next real step, so the record says it
//     first, and the model's surviving sentences follow.
//
// Pure: no DB, no network, no clock, no JSX. `record.today` is the caller's.
import { guardSuggestion, dropLog, plainText, sentencesOf } from "./suggestionGuard.js";

export const NEXT_MOVE_FIELDS = ["when", "say", "for"];

// "When to make it is now" / "What to say: …" / "The move to make — …"
const LABELS = [
  ["move", /^(?:the\s+)?(?:next\s+)?move(?:\s+to\s+make)?\s*(?:is|:|—|–|-)\s*/i],
  ["when", /^when(?:\s+to\s+(?:make\s+it|reach\s+out|do\s+it))?\s*(?:is|:|—|–|-)\s*/i],
  ["say", /^what\s+to\s+say\s*(?:is|:|—|–|-)\s*/i],
  ["for", /^what\s+it(?:'s|\s+is)\s+for\s*(?:is|:|—|–|-)\s*/i],
];
// The words a "when" fragment starts with.
const TIME_START = /^(now|today|tonight|tomorrow|this|next|within|before|after|by|in|on|soon|early|late|at|once|during|over|ahead)\b/i;
const FOR_NOUN_START = /^(the|a|an|their|your|our|its|this|that|general|unrestricted|operating|program|programs)\b/i;

const labelOf = s => {
  for (const [field, re] of LABELS) if (re.test(s)) return [field, s.replace(re, "")];
  return [null, s];
};
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);
const endStop = s => (/[.!?]$/.test(s) ? s : s.replace(/[,;:\s—–-]+$/, "") + ".");

// A value as one plain sentence. A value that is already a sentence (it
// starts with a capital) is kept as it is; a fragment gets its lead-in.
function sentenceFor(field, raw, move) {
  let s = plainText(raw).replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = labelOf(s)[1].trim();
  if (!s) return "";
  if (/^[a-z]/.test(s)) {
    if (field === "when" && TIME_START.test(s)) s = (move ? "Make " + move.replace(/[.!?]+$/, "") : "Reach out") + " " + s;
    else if (field === "say" && /^that\b/i.test(s)) s = "Say " + s;
    else if (field === "say" && /^to\s/i.test(s)) s = s.replace(/^to\s+/i, "");
    else if (field === "for" && /^for\b/i.test(s)) s = "It is " + s;
    else if (field === "for" && /^to\s/i.test(s)) s = "It is " + s;
    else if (field === "for" && FOR_NOUN_START.test(s)) s = "It is for " + s;
  }
  return endStop(capital(s));
}

// The model's reply as fields: JSON when it answered as asked, otherwise its
// prose read sentence by sentence, each labelled sentence going to its field.
export function parseNextMove(reply) {
  if (reply && typeof reply === "object") return reply;
  const text = String(reply == null ? "" : reply).trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o === "object" && NEXT_MOVE_FIELDS.some(f => typeof o[f] === "string")) return o;
    } catch { /* not JSON: read it as prose below */ }
  }
  const fields = {};
  let last = null;
  for (const sent of sentencesOf(text)) {
    const [f] = labelOf(sent);
    const field = f || last || "say";
    fields[field] = fields[field] ? fields[field] + " " + sent : sent;
    last = field === "move" ? "when" : field;
  }
  return fields;
}

// openStepSentence(record) → the next real step, as one sentence, or "".
//
// `record.openItems` is what the screen already has: the open threads, tasks
// and proposals for this person, most urgent first, each with a `label` and
// an optional `dueLabel` already formatted by the caller (this module has no
// clock and no date formatter). Nothing is invented — every word comes from
// a row.
export function openStepSentence(record) {
  const open = ((record && record.openItems) || []).filter(Boolean);
  if (!open.length) return "";
  const it = open[0];
  const what = plainText(it.label || "").replace(/\s+/g, " ").trim();
  if (!what) return "";
  const when = it.dueLabel ? `, ${it.overdue ? "overdue since" : "due"} ${String(it.dueLabel).trim()}` : "";
  const whose = it.kind === "proposal" ? "The open proposal: " : "";
  return endStop(capital(`${whose}${what}${when}`));
}

// composeNextMove(reply, record) → { sentences, dropped, reasons, text, log }
//   sentences — the open step from the record first (when there is one), then
//               at most three of the model's: when, what to say, what it is
//               for, each the first sentence of its field the record supports.
//   text      — what the panel shows, or "" when there is nothing to show.
//   log       — the one console line about what was refused, or "".
export function composeNextMove(reply, record = {}) {
  const f = parseNextMove(reply);
  const move = f.move ? labelOf(plainText(f.move).trim())[1].replace(/^to\s+/i, "") : "";
  const sentences = [];
  const reasons = [];
  let dropped = 0;
  for (const field of NEXT_MOVE_FIELDS) {
    const value = f[field];
    if (!value || typeof value !== "string") continue;
    // Each sentence of the field on its own, so one invented clause costs
    // one line, not the field.
    const parts = sentencesOf(value).map((s, i) => sentenceFor(field, s, i === 0 && field === "when" ? move : "")).filter(Boolean);
    const g = guardSuggestion(parts.map(text => ({ text })), record);
    dropped += g.dropped;
    reasons.push(...g.reasons);
    if (g.kept.length) sentences.push(g.kept[0].text);
  }
  // The record's own open step leads, and never repeats a sentence the model
  // already wrote.
  const open = openStepSentence(record);
  if (open && !sentences.some(s => s.toLowerCase() === open.toLowerCase())) sentences.unshift(open);
  return { sentences, dropped, reasons, text: sentences.join(" "), log: dropLog(dropped, reasons) };
}
