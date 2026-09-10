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
  { key: "call_reached",   label: "Call · reached",        interactionType: "call" },
  { key: "call_no_answer", label: "Call · no answer",      interactionType: "call" },
  { key: "meeting",        label: "Meeting",               interactionType: "meeting" },
  { key: "visit",          label: "Visit",                 interactionType: "meeting" },
  { key: "email",          label: "Email sent",            interactionType: "email" },
  { key: "ask",            label: "Ask or proposal made",  interactionType: "ask" },
  { key: "gift",           label: "Gift received",         interactionType: "other" },
  { key: "note_only",      label: "Note (no touch)",       interactionType: "note" },
];

// FIX (2026-09-09) — the defaults table, rewritten.
//
// A thank-you is what you send when someone GIVES. It was the default for
// meetings and visits too, which made the most common touch in a fundraiser's
// week propose the one step it almost never needs. Thank-you now belongs to
// the gift row alone; every other touch proposes the thing that touch actually
// leads to, on its own cadence.
//
// `subject: true` means the label completes itself from the note ("Follow up
// on the gala"); with no subject to find it stays the bare verb, never a
// literal placeholder. A key ABSENT from this table has no automatic step —
// a note with no touch is the one such row, deliberately: the flow asks.
//
// `followon` (the BUILD-81 meeting/visit chain) is still read on both sides
// and still lives on old threads, but no default defines one any more — it
// existed to walk a meeting from its thank-you to the real follow-up, and the
// meeting row now IS the follow-up.
export const NEXT_STEP_DEFAULTS = {
  gift:           { type: "thank_you_note",     label: "Send thank-you note",    plusDays: 2 },
  meeting:        { type: "follow_up",          label: "Follow up",              plusDays: 5, subject: true },
  visit:          { type: "follow_up",          label: "Follow up",              plusDays: 5, subject: true },
  call_reached:   { type: "follow_up",          label: "Follow up",              plusDays: 5 },
  // Not in the spec's six rows, kept on its own merit: a call nobody answered
  // leads to another call, not to a follow-up on a conversation that did not
  // happen. Collapse it into `call_reached` if that ever stops being true.
  call_no_answer: { type: "try_again",          label: "Try again",              plusDays: 2 },
  email:          { type: "follow_up_no_reply", label: "Follow up if no reply",  plusDays: 4 },
  ask:            { type: "check_in_ask",       label: "Check in on the ask",    plusDays: 14 },
  // note_only: deliberately absent — no automatic step.
};

// Every next-step type a thread may carry (the defaults plus the user's own
// choice from the same set — the prompt offers types, not free text).
export const NEXT_STEP_TYPES = [
  { type: "follow_up",      label: "Follow up" },
  { type: "try_again",      label: "Try again" },
  { type: "thank_you_note", label: "Send thank-you note" },
  { type: "thank",          label: "Thank" },
  { type: "send",               label: "Send" },
  { type: "follow_up_no_reply", label: "Follow up if no reply" },
  { type: "check_in_ask",       label: "Check in on the ask" },
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

// What a meeting was ABOUT — the weaker sibling of stepFromNote, used only to
// complete a `subject: true` label ("Follow up on the gala"). An ask in the
// note outranks this; a note with no subject leaves the label bare rather than
// rendering a placeholder nobody can read.
export const NOTE_SUBJECT_RULES = [
  /\b(?:talked|spoke|chatted|caught\s+up)\s+(?:with\s+[\w'’-]+\s+)?about\s+(.+)/i,
  /\b(?:conversation|call|meeting|visit|discussion|chat)\s+about\s+(.+)/i,
  /\b(?:discussed|revisited|walked\s+(?:her|him|them)\s+through|went\s+(?:over|through))\s+(.+)/i,
  /\bre:\s*(.+)/i,
  /\babout\s+(.+)/i,
];

export function subjectFromNote(note) {
  const text = String(note || "").trim();
  if (!text) return null;
  for (const re of NOTE_SUBJECT_RULES) {
    const m = re.exec(text);
    if (!m) continue;
    const obj = trimNoteObject(m[1]);
    if (obj.length < 3 || NOTE_STOP_OBJECTS.has(obj.toLowerCase())) continue;
    return obj;
  }
  return null;
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

  if (!def) return null;                 // no default: the flow asks for one
  const subject = def.subject ? subjectFromNote(note) : null;
  const out = {
    type: def.type, label: subject ? `${def.label} on ${subject}` : def.label,
    due: addCivilDays(today, def.plusDays),
    source: { from: "touch", touch: touchKey, subject: subject || undefined,
              why: (touchTypeFor(touchKey)?.label || "This touch type") + " default" },
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

// ── BUILD-84 FEATURE — A TASK WITH A TIME ON IT EMAILS AT THAT TIME ────────
//
// PREREQUISITE, ESTABLISHED FIRST: the due field held NO TIME before this
// build. `threads.due_date` is `TEXT NOT NULL` carrying a civil `YYYY-MM-DD`,
// and every default in NEXT_STEP_DEFAULTS above is expressed as `+N days` —
// so there was no 2:00 to fire at. The time is added BESIDE the date as a
// nullable `HH:MM` (db.js), not by converting the date column to a timestamp:
// a civil date is a day on a calendar in every timezone on earth (orgTime.js's
// type discipline) and dragging every existing date-only task through a zone
// it never had would be the larger change and the wrong one. Nothing needed
// backfilling — every pre-existing row is date-only and stays date-only.
//
// SETTING A TIME IS OPTIONAL. A user who never sets one sees no change
// anywhere: no new email, no change to the digest, no new row on any screen.

// The org's local wall-clock time a step is due at, or null. Stored as the
// literal 24-hour "HH:MM" string; the ORG's timezone turns it into a moment.
export function sanitizeStepTime(raw) {
  if (raw == null || raw === "") return null;
  const m = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/.exec(String(raw));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

// "14:00" → "2:00 PM". Display only; never parsed back.
export function formatStepTime(hhmm) {
  const t = sanitizeStepTime(hhmm);
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

// ── PRECEDENCE — THE PART THAT GOES WRONG IF IT IS NOT WRITTEN DOWN ────────
// A task must never be reported twice. ONE rule covers it, and both the digest
// and the timed sender read THIS function rather than each re-deriving it:
//
//   · a task WITH a time sends its own email at that time, and is excluded
//     from the morning digest ON ITS DUE DATE ONLY;
//   · a task with a date and NO time stays in the digest exactly as before and
//     sends nothing of its own;
//   · a timed task that comes due and is not closed REJOINS the digest the
//     next morning as overdue, counted like everything else — the exclusion is
//     for the day it is due, not forever.
//
// The user chooses which kind of reminder they get by whether they set a time.
// Nothing else in the interface has to explain it.
export function digestShouldSkip(thread, today) {
  const t = sanitizeStepTime(thread && thread.dueTime !== undefined ? thread.dueTime : thread && thread.due_time);
  if (!t) return false;                                    // date-only: always the digest's
  const due = (thread.dueDate || thread.due_date || "");
  return due === today;                                    // its own day only
}

// A timed step fires when the org's clock has reached its time on its due
// date, and it has not been sent yet. `nowHHMM` is the org's local wall clock.
// The delivery window is bounded so a server that was down for three hours
// does not fire a 2:00 reminder at 5:00 — that reminder has already lost the
// only thing that made it worth sending.
export const STEP_REMINDER_WINDOW_MINUTES = 90;
export function stepReminderDue(thread, today, nowHHMM, { windowMinutes = STEP_REMINDER_WINDOW_MINUTES } = {}) {
  const t = sanitizeStepTime(thread && (thread.dueTime ?? thread.due_time));
  if (!t) return false;
  const due = thread.dueDate || thread.due_date || "";
  if (due !== today) return false;
  const now = sanitizeStepTime(nowHHMM);
  if (!now) return false;
  const mins = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const delta = mins(now) - mins(t);
  return delta >= 0 && delta <= windowMinutes;
}

// THE WEEKEND RULE INVERTS HERE. The digest does not send on weekends by
// default, because a list of open threads on a Saturday is an intrusion nobody
// asked for. A time is different: setting Saturday at 10:00 is an explicit
// commitment to a moment, so a timed task fires on weekends REGARDLESS of the
// org's weekend toggle. (Said next to the toggle, in Settings, so it is not a
// surprise.)
export const TIMED_STEPS_IGNORE_WEEKEND_TOGGLE = true;
