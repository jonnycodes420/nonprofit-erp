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

// The suggestion for one logged touch: {type, label, due, followon?} or null
// for an unknown touch key. `today` is the org's civil today.
export function nextStepSuggestion(touchKey, today) {
  const def = NEXT_STEP_DEFAULTS[touchKey];
  if (!def || !today) return null;
  const out = { type: def.type, label: def.label, due: addCivilDays(today, def.plusDays) };
  if (def.followon) {
    out.followon = {
      type: def.followon.type, label: def.followon.label,
      due: addCivilDays(today, def.followon.plusDays),
    };
  }
  return out;
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
