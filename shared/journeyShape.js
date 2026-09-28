// shared/journeyShape.js — THREAD-2a. A JOURNEY IS A PLAN WITH A TRIGGER.
//
// It is NOT a second follow-up engine, and that is the whole design. Steward
// already has Plans (shared/planShape.js, BUILD-99): an ordered list of steps,
// each of which becomes a BUILD-81 thread when its turn comes, with exactly
// one open at a time and a partial unique index enforcing it. A journey adds
// exactly two things to that:
//
//   1. a TRIGGER — the event that starts it, instead of an officer choosing
//   2. a PRIORITY — which one wins when a donor qualifies for two
//
// Everything else is the Plan machinery unchanged: the same `cultivation_*`
// tables, the same apply path, the same mark-done and skip, the same one
// active plan per person. An old plan and a journey are the same row; the
// journey ones simply know why they started. Old plans and sequences keep
// working and deep-link, because there is nothing new for them to break
// against.
//
// ── WHAT A JOURNEY MAY NOT DO ────────────────────────────────────────────
// SEND ANYTHING. A journey step is a reminder that becomes a thread, and a
// thread closes when a person logs that they did something. There is no
// schedule that fires, no template that mails, no "auto" anything. A step may
// carry a DRAFT — Steward writing words for her to read — and a draft is not
// a send: `requiresConfirmation` is true for every step that has one, and
// tests/thread2a-no-send.test.js is the guard.
//
// Pure: no DB, no network, no clock, no JSX.

import {
  validateTemplate, MAX_STEPS, MAX_OFFSET_DAYS, sanitizeName, sanitizeLabel,
} from "./planShape.js";

// ── THE TRIGGERS ──────────────────────────────────────────────────────────
// Six, and each one is an event Steward already observes. `needsAmount` marks
// the only one that carries a number the org sets for itself — there is no
// universal figure for "a big gift", and picking one for them would be
// pretending we know their shop.
//
// EVERY DATE A TRIGGER PRODUCES IS THE ORG'S CIVIL DATE. The trigger fires on
// a row, but the step dates are computed from the organisation's own today in
// its own timezone (orgTime.js), never from a UTC instant — a gift recorded
// at 9pm Eastern must not start a journey "tomorrow".
export const TRIGGERS = [
  { key: "first_gift",     label: "They give for the first time",
    sentence: "Starts when someone gives for the first time." },
  { key: "gift_over",      label: "They give more than a set amount", needsAmount: true,
    sentence: "Starts when a gift comes in over the amount you set." },
  { key: "stage_change",   label: "Their stage changes",
    sentence: "Starts when someone is moved into a new stage." },
  { key: "lapsed_return",  label: "A lapsed donor gives again",
    sentence: "Starts when someone who had stopped giving gives again." },
  { key: "new_volunteer",  label: "Someone signs up to volunteer",
    sentence: "Starts when a new volunteer signs up." },
  { key: "by_hand",        label: "You put them in it yourself",
    sentence: "Never starts on its own — you choose who goes in it." },
];
export const TRIGGER_KEYS = TRIGGERS.map(t => t.key);
export const triggerByKey = k => TRIGGERS.find(t => t.key === k) || null;

// ── PRIORITY ──────────────────────────────────────────────────────────────
// A donor is in AT MOST ONE journey. When somebody qualifies for two, the
// higher number wins and the lower one is replaced, with the reason written
// down. Major gifts outrank a first-gift welcome because a $25,000 first gift
// is a major gift before it is a first gift, and answering that the other way
// round would put the biggest donor of the year on the standard drip.
//
// The numbers are spaced by ten so an org can slot one between two without
// renumbering everything.
export const PRIORITY_MIN = 0, PRIORITY_MAX = 1000, PRIORITY_DEFAULT = 50;

// ── THE FIVE PRESETS, IN PLAIN FUNDRAISING LANGUAGE ──────────────────────
// Every label is something a person would actually say out loud. No "touch
// point", no "cadence", no "nurture". `offsetDays` is days from the trigger,
// and the step types are the ones the Thread engine already knows (planShape
// PLAN_STEP_TYPES), so a preset cannot hold a step the engine would refuse.
//
// `draft` names what Steward would write for her to read and send herself. A
// step with no `draft` is one she does entirely in her own hands — a call is
// a call, and Steward has no business drafting a phone conversation.
export const PRESETS = [
  {
    key: "new_donor_first_year",
    name: "New donor, first year",
    trigger: "first_gift",
    priority: 50,
    blurb: "Thank them properly, show them what it did, then ask again.",
    steps: [
      { type: "thank",        label: "Call to say thank you",        offsetDays: 2,   draft: null },
      { type: "send",         label: "Send a handwritten note",      offsetDays: 7,   draft: null },
      { type: "send",         label: "Send the impact report",       offsetDays: 90,  draft: "impact_report" },
      { type: "follow_up",    label: "Ask them for a visit",         offsetDays: 120, draft: null },
      { type: "follow_up",    label: "Invite them to something",     offsetDays: 150, draft: "event_invitation" },
      { type: "follow_up",    label: "Check in, no ask",             offsetDays: 180, draft: null },
      { type: "check_in_ask", label: "Make the ask",                 offsetDays: 210, draft: "the_ask" },
    ],
  },
  {
    key: "major_donor",
    name: "Major donor",
    trigger: "gift_over",
    priority: 90,   // outranks the first-year welcome, deliberately
    blurb: "Slower, fewer, and every one of them by a person.",
    steps: [
      { type: "thank",        label: "Call them the same week",           offsetDays: 3,   draft: null },
      { type: "follow_up",    label: "Ask them for a visit",              offsetDays: 21,  draft: null },
      { type: "send",         label: "Send what their gift paid for",     offsetDays: 120, draft: "impact_report" },
      { type: "follow_up",    label: "Check in, no ask",                  offsetDays: 240, draft: null },
      { type: "check_in_ask", label: "Talk about next year",              offsetDays: 330, draft: null },
    ],
  },
  {
    key: "welcome_back",
    name: "Welcome back",
    trigger: "lapsed_return",
    priority: 70,
    blurb: "Someone who had stopped has come back. Say so.",
    steps: [
      { type: "thank",     label: "Call and say you noticed",  offsetDays: 2,  draft: null },
      { type: "send",      label: "Send what has changed since they left", offsetDays: 14, draft: "impact_report" },
      { type: "follow_up", label: "Check in, no ask",          offsetDays: 42, draft: null },
    ],
  },
  {
    key: "monthly_giver",
    name: "Monthly giver",
    trigger: "by_hand",
    priority: 30,
    blurb: "Quiet. They already said yes every month.",
    steps: [
      { type: "thank",     label: "Thank them for setting it up", offsetDays: 3,   draft: null },
      { type: "send",      label: "Send the spring update",       offsetDays: 90,  draft: "impact_report" },
      { type: "send",      label: "Send the autumn update",       offsetDays: 270, draft: "impact_report" },
      { type: "follow_up", label: "Check the card is still good", offsetDays: 330, draft: null },
    ],
  },
  {
    key: "new_volunteer",
    name: "New volunteer",
    trigger: "new_volunteer",
    priority: 40,
    blurb: "Thank them, check the first shift, then ask how it went.",
    steps: [
      { type: "thank",     label: "Thank them for signing up",     offsetDays: 1,  draft: null },
      { type: "follow_up", label: "Check they know when to come",  offsetDays: 7,  draft: null },
      { type: "follow_up", label: "Ask how the first shift went",  offsetDays: 30, draft: null },
    ],
  },
];
export const PRESET_KEYS = PRESETS.map(p => p.key);
export const presetByKey = k => PRESETS.find(p => p.key === k) || null;

// ── DRAFTS, AND WHY EVERY ONE OF THEM STILL NEEDS A PERSON ───────────────
// A draft is words Steward writes for her to read. It is not a send and it
// never becomes one: the step is still a thread, the thread still closes on a
// logged human action, and `requiresConfirmation` is true for EVERY step that
// carries a draft. This constant exists so the guard can assert the property
// over the whole catalogue rather than step by step.
export const DRAFT_KINDS = ["impact_report", "event_invitation", "the_ask", "thank_you"];

// TRUE FOR EVERY STEP, DRAFT OR NOT. It is not a per-step setting an org can
// turn off — it is what a journey step IS. A function rather than a constant
// so a caller reads it as a question about the step it is holding.
export function requiresConfirmation(/* step */) {
  return true;
}

// Every step in the catalogue, flattened — what a guard walks.
export function allPresetSteps() {
  const out = [];
  for (const p of PRESETS) for (const s of p.steps) out.push({ preset: p.key, ...s });
  return out;
}

// ── VALIDATION ────────────────────────────────────────────────────────────
// Delegates the STEP rules to planShape.validateTemplate — there is one set
// of rules about what a step may be, and a journey does not get its own — and
// adds only what a journey has that a plan does not.
export function validateJourney(input = {}) {
  const base = validateTemplate({ name: input.name, steps: input.steps });
  const errors = [...base.errors];

  const trigger = String(input.trigger || "").trim();
  if (!TRIGGER_KEYS.includes(trigger)) {
    errors.push({ field: "trigger",
      message: `A journey needs a trigger — one of: ${TRIGGER_KEYS.join(", ")}.` });
  }

  const t = triggerByKey(trigger);
  let amountCents = null;
  if (t && t.needsAmount) {
    amountCents = Number(input.amountCents);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      errors.push({ field: "amountCents",
        message: "Set the amount that counts as a big gift for your organisation. There is no universal figure and Steward will not pick one for you." });
    }
  }

  let priority = input.priority === undefined || input.priority === null
    ? PRIORITY_DEFAULT : Number(input.priority);
  if (!Number.isInteger(priority) || priority < PRIORITY_MIN || priority > PRIORITY_MAX) {
    errors.push({ field: "priority",
      message: `Priority must be a whole number from ${PRIORITY_MIN} to ${PRIORITY_MAX}. The higher one wins when a donor qualifies for two.` });
    priority = PRIORITY_DEFAULT;
  }

  // The draft kind, per step, checked here because planShape does not know
  // about drafts. An unknown kind is refused rather than ignored: a step that
  // silently loses its draft is a step that quietly asks her to write it.
  const steps = base.steps.map((s, i) => {
    const raw = (input.steps || [])[i] || {};
    const draft = raw.draft == null || raw.draft === "" ? null : String(raw.draft);
    if (draft && !DRAFT_KINDS.includes(draft)) {
      errors.push({ field: `steps.${i}.draft`,
        message: `Step ${i + 1} names a draft Steward does not write: ${draft}.` });
    }
    // `ownerMode` defaults to the relationship owner, which is the answer in
    // almost every case and the one the brief names.
    const ownerMode = raw.ownerMode === "specific" ? "specific" : "relationship_owner";
    return { ...s, draft: DRAFT_KINDS.includes(draft) ? draft : null, ownerMode,
             ownerId: ownerMode === "specific" ? (raw.ownerId || null) : null };
  });

  return { ok: errors.length === 0, name: base.name, trigger, amountCents, priority, steps, errors };
}

// ── WHICH JOURNEY WINS ───────────────────────────────────────────────────
// Given the journeys a donor qualifies for, the one that should run. Highest
// priority; a tie is broken by the LOWER id so the answer is stable and two
// servers deciding at the same moment agree.
export function winningJourney(candidates = []) {
  const list = candidates.filter(Boolean);
  if (!list.length) return null;
  return list.slice().sort((a, b) => {
    const p = Number(b.priority || 0) - Number(a.priority || 0);
    return p !== 0 ? p : String(a.id || "").localeCompare(String(b.id || ""));
  })[0];
}

// Should an incoming journey REPLACE the plan a donor is already in? Only if
// it outranks it. Equal priority does not replace — being in a journey is a
// commitment somebody may already have acted on, and shuffling a donor between
// two equally good journeys helps nobody.
export function shouldReplace(current, incoming) {
  if (!current) return true;
  if (!incoming) return false;
  return Number(incoming.priority || 0) > Number(current.priority || 0);
}

// The reason, written down, in words a person reads in the timeline. This is
// the sentence stored on the replaced plan AND logged on the donor, so the
// record and the screen cannot disagree about why somebody moved.
export function replacementReason(current, incoming) {
  return `Moved from "${current}" to "${incoming}" because "${incoming}" takes priority.`;
}

// ── THE SENTENCES ────────────────────────────────────────────────────────
// "7 touches over 7 months. Nothing is sent without you." — built, not typed,
// so it cannot drift from the steps it describes.
export function touchesSentence(steps = []) {
  const n = steps.length;
  if (!n) return "No steps yet.";
  const last = Math.max(...steps.map(s => Number(s.offsetDays) || 0));
  const months = Math.round(last / 30);
  const span = last < 45 ? `${Math.max(1, Math.round(last / 7))} week${Math.round(last / 7) === 1 ? "" : "s"}`
             : `${months} month${months === 1 ? "" : "s"}`;
  return `${n} touch${n === 1 ? "" : "es"} over ${span}. Nothing is sent without you.`;
}

// Where a donor is, in the words the profile shows.
export function stepPositionSentence({ seq, total, label, dueDate }) {
  return `Step ${seq} of ${total} · ${label}${dueDate ? ` · due ${dueDate}` : ""}`;
}

export { MAX_STEPS, MAX_OFFSET_DAYS, sanitizeName, sanitizeLabel };
