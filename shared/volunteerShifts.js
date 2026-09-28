// shared/volunteerShifts.js — VOL-1. SCHEDULING, CAPACITY, WAITLISTS,
// CREDENTIALS. The pure half.
//
// ── THE ONE DISTINCTION THIS FILE EXISTS TO KEEP ──────────────────────────
// Steward already had `volunteer_shifts` (BUILD-98), and that table is HOURS
// THAT WERE WORKED: a record of the past, one row per stint, summed into a
// person's total. What VOL-1 adds is the FUTURE: a SLOT somebody can sign up
// for, with a capacity and a waitlist. They are not the same object and they
// must never be merged, because the questions they answer are opposite — "who
// is coming on Saturday" versus "how many hours has Maria given".
//
// So the vocabulary, used everywhere from here on:
//   OPPORTUNITY  a standing thing to do. "Saturday harbour clean-up."
//   SLOT         one dated occurrence of it, with a capacity.
//   SIGN-UP      one person on one slot: confirmed, waitlisted or cancelled.
//   SHIFT        hours that were actually worked (the BUILD-98 table).
// A slot becomes a shift at CHECK-OUT, and only then. A sign-up nobody
// attended produces no hours, because nobody worked any.
//
// ── WHAT A VOLUNTEER PROGRAMME GETS WRONG, AND WHAT THIS REFUSES ──────────
// The failure mode of every volunteer tool is a capacity that is advisory.
// Twelve people are told they are confirmed for eight places, four of them
// drive across town on a Saturday morning, and the coordinator finds out at
// the door. Capacity here is decided by the DATABASE (a partial unique count
// enforced in the route's transaction), and this file is the arithmetic both
// sides agree on: the public page, the coordinator's screen and the route all
// read `slotState` and cannot disagree about whether a slot is full.
//
// Pure: no DB, no network, no clock (every function that needs "today" is
// GIVEN it, as the org's civil date), no JSX.

import { hoursToHundredths, hundredthsToHours, MAX_SHIFT_HOURS } from "./volunteerHours.js";

// ── TIME, AS CIVIL TIME ───────────────────────────────────────────────────
// A slot is a DATE and two clock times in the organisation's own timezone,
// never a UTC instant. A 9am shift is 9am where the volunteers are, and an
// org that crosses a DST boundary must not find its Saturday morning moved to
// 8am. The whole codebase keeps civil dates this way (orgTime.js); this is
// the same discipline applied to a time of day.
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function minutesOf(hhmm) {
  const m = TIME_RE.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// The length of a slot, in hundredths of an hour — the same unit the hours
// table counts in, so a checked-out slot lands there without a conversion
// anybody could get wrong. An end BEFORE the start is an overnight shift,
// which is a real thing a shelter runs, so it wraps rather than refusing.
export function slotHundredths({ startTime, endTime }) {
  const a = minutesOf(startTime), b = minutesOf(endTime);
  if (a === null || b === null) return null;
  const mins = b > a ? b - a : (24 * 60 - a) + b;
  if (mins <= 0 || mins > MAX_SHIFT_HOURS * 60) return null;
  return Math.round((mins / 60) * 100);
}

// "9:00am to 1:00pm" — the words, built once, so the public page, the
// volunteer's own page and the kiosk cannot phrase the same slot differently.
export function timeRangeWords(startTime, endTime) {
  const one = t => {
    const m = TIME_RE.exec(String(t || ""));
    if (!m) return "";
    let h = Number(m[1]);
    const suffix = h < 12 ? "am" : "pm";
    h = h % 12 === 0 ? 12 : h % 12;
    return m[2] === "00" ? `${h}${suffix}` : `${h}:${m[2]}${suffix}`;
  };
  const a = one(startTime), b = one(endTime);
  return a && b ? `${a} to ${b}` : a || "";
}

// ── CAPACITY, AND THE WAITLIST ────────────────────────────────────────────
// `capacity` null means unlimited, which is a real answer for a phone bank or
// a park clean-up. Zero is NOT unlimited: it is a slot that is closed, and
// conflating the two is how a tool tells somebody a shut shift is open.
export const SIGNUP_STATUSES = ["confirmed", "waitlisted", "cancelled", "no_show", "completed"];
export const OPEN_STATUSES = ["confirmed", "waitlisted"];

// Everything a page needs to know about one slot, from its capacity and the
// sign-ups already on it. ONE function, so "full" means the same thing to the
// public page, the coordinator's list and the route that refuses.
export function slotState({ capacity, confirmed = 0, waitlisted = 0 }) {
  const cap = capacity === null || capacity === undefined ? null : Number(capacity);
  const unlimited = cap === null || !Number.isFinite(cap);
  const closed = !unlimited && cap <= 0;
  const remaining = unlimited ? null : Math.max(0, cap - Number(confirmed || 0));
  const full = closed || (!unlimited && remaining === 0);
  return {
    capacity: unlimited ? null : cap,
    confirmed: Number(confirmed || 0),
    waitlisted: Number(waitlisted || 0),
    remaining, unlimited, closed, full,
    // What signing up right now would DO. The public button reads this, so
    // it can never say "Sign up" and then quietly waitlist somebody.
    nextStatus: closed ? null : full ? "waitlisted" : "confirmed",
    sentence: closed ? "This shift is closed."
      : unlimited ? `${confirmed} signed up. There is room for everyone.`
      : full ? (waitlisted
          ? `Full. ${waitlisted} ${waitlisted === 1 ? "person is" : "people are"} on the waiting list.`
          : "Full. Sign up and you go on the waiting list.")
      : `${remaining} of ${cap} ${cap === 1 ? "place" : "places"} left.`,
  };
}

// When a confirmed person cancels, the FIRST person waiting takes the place.
// Returned rather than performed, so the route writes it inside the same
// transaction that frees the place and two cancellations cannot promote the
// same person twice.
export function promoteFromWaitlist(waiting = []) {
  const list = waiting
    .filter(w => w && w.status === "waitlisted")
    .slice()
    .sort((a, b) => (Number(a.position || 0) - Number(b.position || 0))
      || String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      || String(a.id || "").localeCompare(String(b.id || "")));
  return list[0] || null;
}

// ── CREDENTIALS: WAIVERS AND BACKGROUND CHECKS ────────────────────────────
// Both are the same shape — a thing somebody did on a date that stops being
// true on another date — so they are one table and one set of rules. What
// differs is only the word.
//
// AN EXPIRY IS NOT A DEADLINE. A background check that lapsed last week does
// not mean the volunteer did something wrong; it means somebody has to book
// the next one. So the states are warm, the colour is brass (the codebase's
// overdue colour), and the Thread step it raises is addressed to the
// coordinator, never to the volunteer.
export const CREDENTIAL_KINDS = [
  { key: "waiver", label: "Waiver", noun: "waiver",
    lapsedVerb: "needs signing again",
    sentence: "A signed waiver. Steward records who signed it, when, and from what address." },
  { key: "background_check", label: "Background check", noun: "background check",
    lapsedVerb: "needs renewing",
    sentence: "A completed background check. Steward records the date and your own reference; it never holds the report." },
];
export const CREDENTIAL_KEYS = CREDENTIAL_KINDS.map(k => k.key);
export const credentialKind = k => CREDENTIAL_KINDS.find(x => x.key === k) || null;

// How soon is soon. Thirty days is the window a coordinator can actually act
// in: a background check takes two to three weeks to come back, so warning at
// seven would be warning after it was too late.
export const EXPIRING_SOON_DAYS = 30;

// Civil-date arithmetic, on strings, with no Date object anywhere near it —
// `new Date("2026-03-08")` is midnight UTC, which is the previous evening in
// most of the United States, and that one line is how a credential expires a
// day early for every org west of Greenwich.
export function daysBetweenCivil(fromISO, toISO) {
  const p = s => { const m = DATE_RE.exec(String(s || "")); return m ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null; };
  const a = p(fromISO), b = p(toISO);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

// The state of one credential on the org's today. `expiresOn` null means it
// does not expire, which is the honest answer for a one-time waiver an org
// does not renew.
export function credentialState(cred, today) {
  const kind = credentialKind(cred && cred.kind);
  const label = kind ? kind.noun : "credential";
  if (!cred || !cred.signedOn) {
    return { status: "missing", days: null, ok: false,
      sentence: `No ${label} on file.` };
  }
  if (!cred.expiresOn) {
    return { status: "current", days: null, ok: true,
      sentence: `${cap1(label)} on file since ${cred.signedOn}. It does not expire.` };
  }
  const days = daysBetweenCivil(today, cred.expiresOn);
  if (days === null) return { status: "current", days: null, ok: true, sentence: `${cap1(label)} on file.` };
  if (days < 0) {
    return { status: "lapsed", days, ok: false,
      sentence: `${cap1(label)} lapsed on ${cred.expiresOn}, ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago.` };
  }
  if (days <= EXPIRING_SOON_DAYS) {
    return { status: "expiring", days, ok: true,
      sentence: `${cap1(label)} expires on ${cred.expiresOn}, in ${days} ${days === 1 ? "day" : "days"}.` };
  }
  return { status: "current", days, ok: true,
    sentence: `${cap1(label)} is current until ${cred.expiresOn}.` };
}
const cap1 = s => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

// The Thread step a lapsed or expiring credential raises. Addressed to the
// COORDINATOR and phrased as the thing to do, not as a problem report: "Book
// Maria's background check" is a next step; "Maria's background check has
// expired" is a notification, and this product does not do notifications.
export function credentialNextStep({ personName, kind, state }) {
  const k = credentialKind(kind);
  // EXPIRING COUNTS. `ok` answers "may they volunteer today", and an expiring
  // credential still says yes to that; it is the NEXT STEP that differs. The
  // first version returned null here, so the one row on the coordinator's
  // "needs you" list that she could still act on in time was the one with no
  // action written on it.
  if (!k || !state || (state.status !== "lapsed" && state.status !== "expiring" && state.status !== "missing")) return null;
  const verb = k.key === "waiver" ? "Get a new waiver signed by" : "Book the next background check for";
  return {
    label: `${verb} ${personName}`,
    why: state.status === "missing"
      ? `${personName} has no ${k.noun} on file and is signed up to volunteer.`
      : state.sentence,
    kind: k.key,
  };
}

// ── THE MILESTONES ────────────────────────────────────────────────────────
// Twenty-five, fifty, a hundred hours. Crossing one produces a DRAFT for the
// coordinator to read and send, never a send: the same rule as every other
// word Steward writes. Each one fires ONCE, which the caller enforces by
// storing the milestone that has been reached; this file only says which one
// a total crosses.
export const HOUR_MILESTONES = [25, 50, 100];

// The highest milestone this total has reached, or null. Given the previous
// total too, it answers the only question that matters: did this shift cross
// one? A volunteer imported at 140 hours has not just crossed anything, and
// greeting them with "congratulations on your first 25 hours" is worse than
// silence.
export function milestoneCrossed(previousHundredths, newHundredths) {
  const before = Number(previousHundredths || 0) / 100;
  const after = Number(newHundredths || 0) / 100;
  const crossed = HOUR_MILESTONES.filter(m => before < m && after >= m);
  return crossed.length ? crossed[crossed.length - 1] : null;
}

export function milestoneSentence({ personName, hours, orgName }) {
  return `${personName} has now given ${hours} hours to ${orgName}.`;
}

// ── GROUPS ────────────────────────────────────────────────────────────────
// A church group, a company day. One sign-up action, many people, and every
// one of them is still their own record with their own hours — a group is a
// LABEL on a set of sign-ups, never a person and never a second roster.
export const GROUP_KINDS = [
  { key: "church", label: "Church or faith group" },
  { key: "company", label: "Company or team" },
  { key: "school", label: "School or class" },
  { key: "family", label: "Family" },
  { key: "other", label: "Other group" },
];
export const GROUP_KEYS = GROUP_KINDS.map(g => g.key);

// ── VALIDATION ────────────────────────────────────────────────────────────

export function validateOpportunity(raw = {}) {
  const errors = [];
  const name = String(raw.name || "").trim().slice(0, 160);
  if (!name) errors.push({ field: "name", message: "An opportunity needs a name people will recognise." });
  const description = String(raw.description || "").trim().slice(0, 4000) || null;
  const location = String(raw.location || "").trim().slice(0, 200) || null;
  const program = String(raw.program || "").trim().slice(0, 120) || null;
  const requiresWaiver = raw.requiresWaiver === true;
  const requiresBackgroundCheck = raw.requiresBackgroundCheck === true;
  const isPublic = raw.isPublic !== false;     // public by default: that is the point of it
  return { ok: errors.length === 0, errors,
    opportunity: { name, description, location, program, requiresWaiver, requiresBackgroundCheck, isPublic } };
}

export function validateSlot(raw = {}) {
  const errors = [];
  const date = String(raw.date || "").slice(0, 10);
  if (!DATE_RE.test(date)) errors.push({ field: "date", message: "A shift needs a date." });
  const startTime = String(raw.startTime || "").slice(0, 5);
  const endTime = String(raw.endTime || "").slice(0, 5);
  if (!TIME_RE.test(startTime)) errors.push({ field: "startTime", message: "A shift needs a start time, like 09:00." });
  if (!TIME_RE.test(endTime)) errors.push({ field: "endTime", message: "A shift needs an end time, like 13:00." });
  const hundredths = TIME_RE.test(startTime) && TIME_RE.test(endTime) ? slotHundredths({ startTime, endTime }) : null;
  if (TIME_RE.test(startTime) && TIME_RE.test(endTime) && hundredths === null) {
    errors.push({ field: "endTime", message: `A shift is more than zero and at most ${MAX_SHIFT_HOURS} hours long.` });
  }
  // CAPACITY: null is unlimited, a number is a number, and a number is
  // refused rather than rounded — somebody typing "eight" meant eight.
  let capacity = null;
  if (raw.capacity !== null && raw.capacity !== undefined && String(raw.capacity).trim() !== "") {
    capacity = Number(raw.capacity);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 1000) {
      errors.push({ field: "capacity", message: "Leave capacity empty for no limit, or give a whole number from 0 to 1000." });
      capacity = null;
    }
  }
  const notes = String(raw.notes || "").trim().slice(0, 1000) || null;
  return { ok: errors.length === 0, errors,
    slot: { date, startTime, endTime, capacity, notes, hundredths } };
}

export function validateCredential(raw = {}, today = null) {
  const errors = [];
  const kind = String(raw.kind || "");
  if (!CREDENTIAL_KEYS.includes(kind)) errors.push({ field: "kind", message: "Choose a waiver or a background check." });
  const signedOn = String(raw.signedOn || "").slice(0, 10);
  if (!DATE_RE.test(signedOn)) errors.push({ field: "signedOn", message: "When was it signed or completed?" });
  let expiresOn = String(raw.expiresOn || "").slice(0, 10) || null;
  if (expiresOn && !DATE_RE.test(expiresOn)) {
    errors.push({ field: "expiresOn", message: "An expiry date reads as YYYY-MM-DD, or leave it empty if it does not expire." });
    expiresOn = null;
  }
  if (expiresOn && DATE_RE.test(signedOn) && daysBetweenCivil(signedOn, expiresOn) < 0) {
    errors.push({ field: "expiresOn", message: "It cannot expire before it was signed." });
  }
  // A DATE IN THE FUTURE IS NOT A SIGNATURE. Typing next year by accident is
  // how a lapsed check reads as current for twelve months.
  if (today && DATE_RE.test(signedOn) && daysBetweenCivil(today, signedOn) > 0) {
    errors.push({ field: "signedOn", message: "That date is in the future." });
  }
  const reference = String(raw.reference || "").trim().slice(0, 200) || null;
  return { ok: errors.length === 0, errors,
    credential: { kind, signedOn, expiresOn, reference } };
}

// ── THE CROSSOVER ─────────────────────────────────────────────────────────
// The thing nobody else does: volunteers who give and givers who volunteer,
// on one record. These are the two sentences Home and the profile show, and
// they are built here so both surfaces say the same words.
export function crossoverSentences({ bothCount, volunteerNeverAskedCount, orgName = "your organisation" }) {
  const out = [];
  if (bothCount) {
    const one = bothCount === 1;
    out.push({ key: "gives_and_volunteers",
      label: "Gives and volunteers",
      value: bothCount,
      sentence: `${bothCount} ${one ? "person gives and volunteers" : "people give and volunteer"}. `
        + `Their hours and their giving are on one record, because they are one person.` });
  }
  if (volunteerNeverAskedCount) {
    const one = volunteerNeverAskedCount === 1;
    out.push({ key: "volunteer_never_asked",
      label: "Volunteers, never asked",
      value: volunteerNeverAskedCount,
      sentence: `${volunteerNeverAskedCount} ${one ? "person volunteers" : "people volunteer"} `
        + `and ${one ? "has" : "have"} never been asked to give. They already say yes to ${orgName} with their time.` });
  }
  return out;
}

export { hoursToHundredths, hundredthsToHours, MAX_SHIFT_HOURS };
