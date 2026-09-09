// shared/threadShape.js — BUILD-81. The next-step defaults, defined ONCE.
//
// The client prefills the next-step prompt from this table and the server
// validates/derives from the same one, so the two can never disagree (the
// two-truths class). Pure module: no imports, no dates read from the clock —
// callers pass "today" as a civil YYYY-MM-DD string (the ORG's today, through
// the BUILD-72/75 seam; this file never decides what day it is).
//
// The rule this build adds: never fight the tasks battle, fight the
// remembering battle. Nothing here asks the user to create a task — logging a
// conversation IS creating the follow-up, and these defaults are what make the
// prompt a decision instead of a guess.

// Touch types a conversation can be logged as. `label` is what the user sees;
// `interactionType` is what lands on the interactions row (the existing
// vocabulary — call/meeting/email/other — so timelines and filters keep
// working unchanged).
export const TOUCH_TYPES = [
  { key: "call_reached",   label: "Call · reached",    interactionType: "call" },
  { key: "call_no_answer", label: "Call · no answer",  interactionType: "call" },
  { key: "meeting",        label: "Meeting",           interactionType: "meeting" },
  { key: "visit",          label: "Visit",             interactionType: "meeting" },
  { key: "email",          label: "Email sent",        interactionType: "email" },
  { key: "gift",           label: "Gift received",     interactionType: "other" },
];

// The defaults table from the BUILD-81 spec, verbatim. `followon` is the
// meeting/visit chain: closing the thank-you thread with an outcome opens a
// second thread (Follow up) dated from the ORIGINAL touch, not the close.
export const NEXT_STEP_DEFAULTS = {
  call_reached:   { type: "follow_up", label: "Follow up",           plusDays: 7 },
  call_no_answer: { type: "try_again", label: "Try again",           plusDays: 2 },
  meeting:        { type: "thank_you_note", label: "Send thank-you note", plusDays: 2,
                    followon: { type: "follow_up", label: "Follow up", plusDays: 14 } },
  visit:          { type: "thank_you_note", label: "Send thank-you note", plusDays: 2,
                    followon: { type: "follow_up", label: "Follow up", plusDays: 14 } },
  email:          { type: "follow_up", label: "Follow up",           plusDays: 5 },
  gift:           { type: "thank",     label: "Thank",               plusDays: 2 },
};

// Every next-step type a thread may carry (the defaults plus the user's own
// choice from the same set — the prompt offers types, not free text).
export const NEXT_STEP_TYPES = [
  { type: "follow_up",      label: "Follow up" },
  { type: "try_again",      label: "Try again" },
  { type: "thank_you_note", label: "Send thank-you note" },
  { type: "thank",          label: "Thank" },
  { type: "send",           label: "Send" },
];

// Pure civil-date addition (YYYY-MM-DD + n days), no Date-object timezone
// hazards: the arithmetic runs in UTC on a date-only value, which cannot
// cross a civil boundary.
export function addCivilDays(dateStr, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── FIX (2026-09-09) — the note outranks the touch type ────────────────────
//
// A touch type says what KIND of contact happened; the note says what was
// actually asked for or promised. When the two disagree, the note wins: a
// meeting whose note reads "she asked for the import report" proposes
// "Send the import report", not the meeting template. The proposal is a
// PREFILL, never a commitment — it is editable before it is saved, and the
// surface always says which rule produced it so a wrong guess is visible.
//
// The rules match the shapes people actually write. `lead` is the verb the
// step needs when the captured object has none ("the import report" →
// "Send the import report"); a null `lead` means the capture already starts
// with its own verb ("said I'd send the report" → "Send the report").
export const NOTE_STEP_RULES = [
  { rule: "asked_for",   re: /\basked\s+(?:me\s+|us\s+)?(?:for|to\s+send|to\s+email)\s+(.+)/i,                        lead: "Send" },
  { rule: "asked_about", re: /\basked\s+(?:me\s+|us\s+)?about\s+(.+)/i,                                               lead: "Follow up on" },
  { rule: "promised",    re: /\b(?:said\s+(?:i|we)(?:'|’)?d|told\s+\w+\s+(?:i|we)(?:'|’)?d|promised\s+to)\s+(.+)/i,   lead: null },
  { rule: "promised",    re: /\bpromised\s+(?:her|him|them)?\s*(.+)/i,                                                lead: "Send" },
  { rule: "wants",       re: /\b(?:wants|would\s+like|is\s+asking\s+for)\s+(.+)/i,                                    lead: "Send" },
  { rule: "needs",       re: /\bneeds\s+(.+)/i,                                                                       lead: "Send" },
  { rule: "following_up",re: /\bfollowing\s+up\s+(?:with|on)\s+(.+)/i,                                                lead: "Follow up on" },
];

// A note with an ask but no touch type still needs a date: the note said
// what, nothing said when, so it gets the ordinary follow-up window.
export const NOTE_ONLY_PLUS_DAYS = 5;
const NOTE_OBJECT_MAX = 80;          // a step is a line, not a paragraph
const NOTE_STOP_OBJECTS = new Set(["it", "that", "this", "them", "one", "more", "some", "a", "an", "the"]);

// Human-readable names for the rules, for the "why this was proposed" line.
export const NOTE_RULE_LABELS = {
  asked_for:    "From your note — an ask",
  asked_about:  "From your note — a question",
  promised:     "From your note — a promise",
  wants:        "From your note — something wanted",
  needs:        "From your note — something needed",
  following_up: "From your note — a follow-up",
};

// Trim a captured phrase down to the one thing the step is about: stop at the
// first sentence boundary or conjunction, drop trailing punctuation, and cap
// the length at a word boundary.
function trimNoteObject(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  s = s.split(/[.;!?\n]/)[0];
  s = s.split(/\s+(?:and then|but|so that|because)\s+/i)[0];
  s = s.replace(/\s*[,–—-]\s*$/, "").replace(/[\s,]+$/, "").trim();
  if (s.length > NOTE_OBJECT_MAX) {
    const cut = s.slice(0, NOTE_OBJECT_MAX);
    const sp = cut.lastIndexOf(" ");
    s = (sp > 20 ? cut.slice(0, sp) : cut).trim();
  }
  return s;
}

function capitalizeFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// The next-step TYPE for a free-text label — read from the label's own verb,
// so the stored vocabulary matches the sentence the user sees.
export function nextStepTypeForLabel(label) {
  const s = String(label || "").trim();
  if (/^(send|email|e-mail|mail|share|forward|get|put)\b/i.test(s)) return "send";
  if (/^thank\b/i.test(s)) return "thank";
  return "follow_up";
}

// The step a note itself asks for, or null when nothing matches. Returns
// {label, rule, matched} — `matched` is the phrase that triggered it, so the
// surface can show the user exactly what was read.
export function stepFromNote(note) {
  const text = String(note || "").trim();
  if (!text) return null;
  let best = null;
  for (const r of NOTE_STEP_RULES) {
    const m = r.re.exec(text);
    if (!m) continue;
    if (best && m.index >= best.index) continue;   // earliest phrase in the note wins
    let obj = trimNoteObject(m[1]);
    let lead = r.lead;
    // "wants to meet in October" — the object carries its own verb.
    if (lead && /^to\s+\w/i.test(obj)) { obj = obj.replace(/^to\s+/i, ""); lead = null; }
    if (obj.length < 3 || NOTE_STOP_OBJECTS.has(obj.toLowerCase())) continue;
    const label = lead ? `${lead} ${obj}` : capitalizeFirst(obj);
    best = { index: m.index, rule: r.rule, matched: m[0].trim().replace(/[.;,!?]+$/, ""), label };
  }
  if (!best) return null;
  return { label: best.label, rule: best.rule, matched: best.matched };
}

// The suggestion for one logged touch: {type, label, due, source, followon?}
// or null for an unknown touch key. `today` is the org's civil today.
//
// PRECEDENCE (the FIX): a note that names an ask or a promise outranks the
// touch-type default. `source.from` is "note" or "touch" and rides all the way
// to the screen — a wrong guess has to be visible before it can be corrected.
export function nextStepSuggestion(touchKey, today, note) {
  const def = NEXT_STEP_DEFAULTS[touchKey];
  if (!today) return null;

  const fromNote = stepFromNote(note);
  if (fromNote) {
    // The note decides WHAT; the touch type still decides WHEN (a note-only
    // log has no touch cadence to borrow, so it uses the note default).
    const plusDays = def ? def.plusDays : NOTE_ONLY_PLUS_DAYS;
    return {
      type: nextStepTypeForLabel(fromNote.label),
      label: fromNote.label,
      due: addCivilDays(today, plusDays),
      source: { from: "note", rule: fromNote.rule, matched: fromNote.matched,
                why: NOTE_RULE_LABELS[fromNote.rule] || "From your note" },
    };
  }

  if (!def) return null;
  const out = {
    type: def.type, label: def.label, due: addCivilDays(today, def.plusDays),
    source: { from: "touch", touch: touchKey, why: (touchTypeFor(touchKey)?.label || "This touch type") + " default" },
  };
  if (def.followon) {
    out.followon = {
      type: def.followon.type, label: def.followon.label,
      due: addCivilDays(today, def.followon.plusDays),
    };
  }
  return out;
}

// The most a next-step label may be: one line, trimmed, bounded. A step the
// user retyped is still a step, so the label is free text — but it is never
// allowed to be blank, multi-line, or longer than a row can show.
export const NEXT_STEP_LABEL_MAX = 120;
export function sanitizeStepLabel(raw) {
  const s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > NEXT_STEP_LABEL_MAX ? s.slice(0, NEXT_STEP_LABEL_MAX).trim() : s;
}

export function nextStepLabelFor(type) {
  const hit = NEXT_STEP_TYPES.find(t => t.type === type);
  return hit ? hit.label : null;
}

export function touchTypeFor(key) {
  return TOUCH_TYPES.find(t => t.key === key) || null;
}

// Dismissal reasons — the short fixed list. `revisit` is the snooze: the
// thread stays open and resurfaces on the chosen date.
export const DISMISS_REASONS = [
  { key: "no_longer_prospect", label: "No longer a prospect" },
  { key: "handled_outside",    label: "Handled outside Steward" },
  { key: "revisit",            label: "Not now, revisit on a date" },
];
