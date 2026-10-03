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
// Eight, and each one is an event Steward already observes. `needsAmount` marks
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
  // FIX-4 1c — the two events an org already records and could not act on.
  // Coming to an event and joining as a member are both moments somebody
  // stepped closer, and both were invisible to a journey until now.
  { key: "attended_event", label: "They attend an event",
    sentence: "Starts when somebody is marked as having attended an event." },
  { key: "became_member",  label: "They become a member",
    sentence: "Starts when somebody's membership begins." },
  // PARITY-1 Part D — the rest of the entry triggers a fundraiser expects.
  // Each one is an event Steward already records; none of them sends anything.
  { key: "first_recurring", label: "They start giving monthly", gift: true,
    sentence: "Starts on the first successful payment of someone's first recurring gift." },
  { key: "next_gift",      label: "They give again", gift: true,
    sentence: "Starts on any gift after somebody's first." },
  { key: "membership_payment", label: "They pay for a membership", gift: true,
    sentence: "Starts when a membership is paid for: a new one, or a renewal." },
  { key: "became_prospect", label: "They become a prospect",
    sentence: "Starts when somebody is moved into the Prospect stage." },
  { key: "joined_group",   label: "They join a group", needsGroup: true,
    sentence: "Starts when somebody joins the group you pick. Added by hand, it starts at once; for a group by rule, it starts when a gift moves them in, or at the next morning's check." },
  { key: "giving_anniversary", label: "The anniversary of their first gift",
    sentence: "Starts each year on the day of somebody's first gift, checked every morning." },
  { key: "by_hand",        label: "You put them in it yourself",
    sentence: "Never starts on its own — you choose who goes in it." },
];
// The triggers a gift fires. Each can be narrowed by an amount, a fund and a
// campaign (gift_over needs the amount; the rest take it if you set one).
const GIFT_ORIGINALS = ["first_gift", "gift_over", "lapsed_return"];
for (const t of TRIGGERS) if (GIFT_ORIGINALS.includes(t.key)) t.gift = true;
export const GIFT_TRIGGER_KEYS = TRIGGERS.filter(t => t.gift).map(t => t.key);
export const isGiftTrigger = k => GIFT_TRIGGER_KEYS.includes(k);

// ── PARITY-1 Part D · THE FOUR STATES A JOURNEY IS IN ──────────────────────
// Derived, never stored, so `journey_enabled` keeps meaning exactly what it
// always has (it fires on its own):
//   archived  it was archived
//   running   it is switched on
//   paused    it is off now, but it has been on, or somebody is in it
//   draft     it has never been switched on and nobody has ever been in it
export const STATES = [
  { key: "running", label: "Running", sentence: "Switched on: it starts by itself when its trigger happens." },
  { key: "paused", label: "Paused", sentence: "Switched off after running. Nobody new goes in; people already in it carry on." },
  { key: "draft", label: "Draft", sentence: "Never switched on and nobody has been in it yet." },
  { key: "archived", label: "Archived", sentence: "Put away. It starts nothing and is kept so the people who went through it still have a record." },
];
export function journeyState({ enabled, everEnabled, archived, everIn } = {}) {
  if (archived) return "archived";
  if (enabled) return "running";
  if (everEnabled || Number(everIn) > 0) return "paused";
  return "draft";
}
export const TRIGGER_KEYS = TRIGGERS.map(t => t.key);
export const triggerByKey = k => TRIGGERS.find(t => t.key === k) || null;

// ── FIX-4 1c · WHO IT IS FOR ──────────────────────────────────────────────
// A trigger says WHEN a journey starts. An audience says WHO it may start on,
// and until now the answer was "anybody the trigger touched" — which is why
// applying a welcome journey to everyone who qualified swept in the board,
// the monthly givers and the volunteers who had never given.
//
// Seven filters, and every one of them is a fact Steward already holds about
// a person rather than a segment somebody has to maintain by hand. They are
// AND-ed: each one narrows, none of them widens. An empty audience is the
// honest default — no filter at all is "everyone the trigger touched", which
// is what the button did before and still says on its face.
//
// `kind` tells the UI what control to draw and the server how to read the
// value. Pure data: no SQL here, because this file is shared with the
// browser. routes/crm.js owns the one translation into SQL.
export const AUDIENCE_FILTERS = [
  { key: "volunteers",    kind: "flag", label: "Volunteers",
    sentence: "Only people who are on the volunteer roster." },
  { key: "attendedEvent", kind: "flag", label: "Attended an event",
    sentence: "Only people marked as having attended an event." },
  { key: "members",       kind: "flag", label: "Members",
    sentence: "Only people whose membership is active or in its grace period." },
  { key: "recurring",     kind: "flag", label: "Recurring givers",
    sentence: "Only people with a recurring gift that is still running." },
  { key: "stage",         kind: "choice", label: "Stage",
    sentence: "Only people in the stage you pick." },
  { key: "tag",           kind: "text", label: "Tag",
    sentence: "Only people carrying the tag you name." },
  { key: "giftSize",      kind: "range", label: "Gift size",
    sentence: "Only people whose largest single gift falls inside the range you set." },
  // PARITY-1 Part D — a Group is an audience: only the people in it right now.
  { key: "groupId",       kind: "group", label: "Group",
    sentence: "Only people in the group you pick, at the moment the trigger happens." },
];
export const AUDIENCE_KEYS = AUDIENCE_FILTERS.map(f => f.key);

// Normalise whatever the page sent into the shape the query builder reads.
// Anything unrecognised is DROPPED rather than guessed at: a filter nobody
// understands must not silently widen who a journey reaches.
export function validateAudience(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const out = {};
  for (const f of AUDIENCE_FILTERS) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (f.kind === "flag") { out[f.key] = true; continue; }
    if (f.kind === "choice" || f.kind === "text" || f.kind === "group") {
      const s = String(v).trim().slice(0, 80);
      if (s) out[f.key] = s;
      continue;
    }
    if (f.kind === "range") {
      const min = Number(v.minCents), max = Number(v.maxCents);
      const range = {};
      if (Number.isInteger(min) && min > 0) range.minCents = min;
      if (Number.isInteger(max) && max > 0) range.maxCents = max;
      // A range whose floor is above its ceiling selects nobody, which is
      // never what somebody meant. Swap rather than refuse.
      if (range.minCents && range.maxCents && range.minCents > range.maxCents) {
        const t = range.minCents; range.minCents = range.maxCents; range.maxCents = t;
      }
      if (range.minCents || range.maxCents) out[f.key] = range;
    }
  }
  return out;
}

// The sentence under the count, built from what is actually set — so a
// narrowed audience says how it was narrowed instead of leaving somebody to
// guess why the number dropped.
export function audienceSentence(audience = {}) {
  const set = AUDIENCE_FILTERS.filter(f => audience[f.key] !== undefined);
  if (!set.length) return "Everyone the trigger touched. No filters are set.";
  const parts = set.map(f => {
    if (f.kind === "flag") return f.label.toLowerCase();
    if (f.kind === "group") return "membership of the group you picked";
    if (f.key === "giftSize") {
      const r = audience.giftSize || {};
      const d = c => "$" + Math.round(Number(c) / 100).toLocaleString("en-US");
      if (r.minCents && r.maxCents) return `a largest gift between ${d(r.minCents)} and ${d(r.maxCents)}`;
      if (r.minCents) return `a largest gift of ${d(r.minCents)} or more`;
      return `a largest gift of ${d(r.maxCents)} or less`;
    }
    return `${f.label.toLowerCase()} ${audience[f.key]}`;
  });
  return `Narrowed to people with ${parts.join(", and ")}.`;
}

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
    // FIX-4 1a — SEVEN TOUCHES OVER TWELVE MONTHS, not seven. The first year
    // of a donor's life is a year, and the old timing spent all seven touches
    // inside seven months and then went quiet for five — which is precisely
    // the stretch a first-year donor lapses in. The last step is the ask, and
    // it now lands at month twelve, where the renewal conversation belongs.
    steps: [
      { type: "thank",        label: "Call to say thank you",        offsetDays: 2,   draft: null },
      { type: "send",         label: "Send a handwritten note",      offsetDays: 7,   draft: null },
      { type: "send",         label: "Send the impact report",       offsetDays: 90,  draft: "impact_report" },
      { type: "follow_up",    label: "Ask them for a visit",         offsetDays: 150, draft: null },
      { type: "follow_up",    label: "Invite them to something",     offsetDays: 210, draft: "event_invitation" },
      { type: "follow_up",    label: "Check in, no ask",             offsetDays: 270, draft: null },
      { type: "check_in_ask", label: "Make the ask",                 offsetDays: 360, draft: "the_ask" },
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

// ── FIX-5 · HOW A STEP'S TIMING IS EXPRESSED, AND WHAT IS STORED ──────────
// "Fourteen days after the trigger" and "two weeks after the previous step"
// are two ways of saying a thing, and a fundraiser says whichever one the step
// actually is: the thank-you call is three days after the gift, and the
// follow-up is a fortnight after the call, not day seventeen.
//
// BUT THE ENGINE KEEPS ONE NUMBER. `offsetDays` is days from the trigger,
// full stop, because that is what plan dates are computed from and a second
// unit would be a second source of truth for a date. So timing is INPUT and
// `offsetDays` is DERIVED: `resolveTiming` turns what she said into the one
// number, and the `timing` object is stored alongside so the screen can show
// her back the words she chose rather than an arithmetic result.
//
// A month is 30 days here. It is a plan's spacing, not an invoice's due date,
// and "month 3" on a cultivation timeline has never meant the 3rd.
export const TIMING_UNITS = [
  { key: "days",   label: "days",   days: 1 },
  { key: "weeks",  label: "weeks",  days: 7 },
  { key: "months", label: "months", days: 30 },
];
export const TIMING_FROM = [
  { key: "trigger",  label: "after the trigger" },
  { key: "previous", label: "after the previous step" },
];
const unitDays = k => (TIMING_UNITS.find(u => u.key === k) || TIMING_UNITS[0]).days;

// What one step's timing means, given the step before it. Returns the timing as
// it will be stored AND the offsetDays it resolves to. A first step can only be
// "after the trigger" — there is no previous step for it to follow, and reading
// "after the previous step" on step one would be reading nothing.
export function resolveTiming(raw = {}, prevOffsetDays = null) {
  const t = raw && typeof raw.timing === "object" && raw.timing ? raw.timing : null;
  const hasPrev = Number.isInteger(prevOffsetDays);
  if (!t) {
    // No timing given: the step is whatever `offsetDays` says, expressed in
    // days from the trigger. Every journey stored before FIX-5 lands here, so
    // an old journey opens with correct words rather than blank controls.
    const off = Math.max(0, Math.round(Number(raw.offsetDays) || 0));
    return { timing: { from: "trigger", value: off, unit: "days" }, offsetDays: off };
  }
  const unit = TIMING_UNITS.some(u => u.key === t.unit) ? t.unit : "days";
  const from = hasPrev && t.from === "previous" ? "previous" : "trigger";
  const value = Math.max(0, Math.round(Number(t.value) || 0));
  const span = value * unitDays(unit);
  const offsetDays = from === "previous" ? prevOffsetDays + span : span;
  return { timing: { from, value, unit }, offsetDays };
}

// The words under a node: "Day 3", "Week 2", "Month 12" when it hangs off the
// trigger, and "+2 weeks" when it hangs off the step before it. Built from the
// timing so a retimed step relabels itself and cannot disagree with its date.
export function timingWord(timing = {}, offsetDays = 0) {
  const value = Math.max(0, Math.round(Number(timing.value) || 0));
  const unit = TIMING_UNITS.find(u => u.key === timing.unit) || TIMING_UNITS[0];
  if (timing.from === "previous") {
    if (!value) return "Same day";
    return `+${value} ${value === 1 ? unit.label.replace(/s$/, "") : unit.label}`;
  }
  const d = Math.max(0, Math.round(Number(offsetDays) || 0));
  if (d === 0) return "Same day";
  if (d < 7) return `Day ${d}`;
  if (d < 45) { const w = Math.round(d / 7); return `Week ${w}`; }
  return `Month ${Math.round(d / 30)}`;
}

// The one-line description under a journey's name. Not a second name and not a
// paragraph: one sentence a person reads in a row without opening it.
export function sanitizeDescription(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 200);
}
// A step's private note. Longer, because it is where "she hates the phone" goes.
export function sanitizeNote(s) {
  return String(s == null ? "" : s).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

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
  // FIX-5 — TIMING IS RESOLVED BEFORE THE STEPS ARE VALIDATED. A step that says
  // "two weeks after the previous step" has to become a number of days from the
  // trigger before planShape can check the ordering rule, or every relative
  // step would read as offset 14 and the second one would look like it goes
  // backwards. Resolved left to right, because "the previous step" means the
  // one already resolved.
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  const timed = [];
  let prev = null;
  for (const s of rawSteps) {
    const r = resolveTiming(s, prev);
    timed.push({ ...s, offsetDays: r.offsetDays, timing: r.timing });
    prev = r.offsetDays;
  }

  const base = validateTemplate({ name: input.name, steps: timed });
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
  } else if (t && t.gift && input.amountCents !== undefined && input.amountCents !== null && input.amountCents !== "") {
    // PARITY-1 Part D — any gift trigger may carry a floor. Optional here.
    const a = Number(input.amountCents);
    if (Number.isInteger(a) && a > 0) amountCents = a;
  }
  // PARITY-1 Part D — what narrows a trigger beyond its amount. A fund and a
  // campaign only mean something on a gift; the group only on "joins a group".
  const rawF = input.triggerFilters && typeof input.triggerFilters === "object" ? input.triggerFilters : {};
  const triggerFilters = {};
  const idOf = v => (v === undefined || v === null || v === "" ? null : String(v).trim().slice(0, 80) || null);
  if (t && t.gift) {
    if (idOf(rawF.fundId)) triggerFilters.fundId = idOf(rawF.fundId);
    if (idOf(rawF.campaignId)) triggerFilters.campaignId = idOf(rawF.campaignId);
  }
  if (t && t.needsGroup) {
    if (idOf(rawF.groupId)) triggerFilters.groupId = idOf(rawF.groupId);
    else errors.push({ field: "triggerFilters.groupId", message: "Pick the group this journey watches." });
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
    const raw = timed[i] || {};
    const draft = raw.draft == null || raw.draft === "" ? null : String(raw.draft);
    if (draft && !DRAFT_KINDS.includes(draft)) {
      errors.push({ field: `steps.${i}.draft`,
        message: `Step ${i + 1} names a draft Steward does not write: ${draft}.` });
    }
    // `ownerMode` defaults to the relationship owner, which is the answer in
    // almost every case and the one the brief names.
    const ownerMode = raw.ownerMode === "specific" ? "specific" : "relationship_owner";
    // FIX-5 — the timing as she expressed it, carried through. `base.steps` has
    // already thrown everything but type/label/offsetDays away, so the words
    // have to come back from the resolved copy rather than from base.
    const timing = i === 0 && raw.timing && raw.timing.from === "previous"
      ? { ...raw.timing, from: "trigger" } : (raw.timing || { from: "trigger", value: s.offsetDays, unit: "days" });
    return { ...s, timing, note: sanitizeNote(raw.note),
             draft: DRAFT_KINDS.includes(draft) ? draft : null, ownerMode,
             ownerId: ownerMode === "specific" ? (raw.ownerId || null) : null,
             ownerName: ownerMode === "specific" ? sanitizeLabel(raw.ownerName) : "" };
  });

  return { ok: errors.length === 0, name: base.name, description: sanitizeDescription(input.description),
           trigger, amountCents, priority, steps, triggerFilters,
           audience: validateAudience(input.audience), errors };
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
