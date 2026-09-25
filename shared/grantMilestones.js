// shared/grantMilestones.js — BUILD-100 (grants) Part 2. DEADLINES THAT COME
// AND FIND YOU.
//
// ── THE CONSTRAINT THAT SHAPES THIS WHOLE PART ────────────────────────────
// A milestone, when its lead time arrives, IS a BUILD-81 thread on the
// officer. But `threads_one_open` allows exactly ONE open thread per donor,
// and a funder with three grants can easily have three milestones inside
// their lead windows at once. That index is not in the way — it is the rule
// that keeps a queue from becoming a wall, and BUILD-99's cultivation plans
// already met it and answered it the same way: **the second milestone WAITS,
// and the next close advances it.**
//
// So a milestone has three states and the middle one is the honest answer:
//   `pending` — its lead time has not arrived; nothing is owed yet.
//   `waiting` — its lead time HAS arrived and the funder already holds an
//               open thread. Nothing is lost and nothing is stuck; it is
//               next in line, and the screen says so.
//   `raised`  — a thread is open for it.
// Plus `done` (somebody closed it) and `skipped`.
//
// **MISSING A MILESTONE DOES NOT CLOSE IT** (the brief's own line, and
// BUILD-81's). An overdue milestone stays overdue and says how late, because
// a deadline that quietly disappears is worse than one that nags.
//
// Pure: no DB, no network, no clock — `today` is always a parameter.

// ── THE FIXED LIST, AND JONATHAN'S LEAD TIMES ─────────────────────────────
// `lead` is DAYS BEFORE the milestone that the thread opens. Decision is 0:
// there is nothing to do in advance of hearing back, so the thread opens on
// the day itself and means "chase them".
export const MILESTONE_TYPES = [
  { key: "loi_due",       label: "LOI due",           lead: 30, repeatable: false,
    verb: "Send the letter of inquiry" },
  { key: "proposal_due",  label: "Proposal due",      lead: 30, repeatable: false,
    verb: "Finish the proposal" },
  { key: "decision",      label: "Decision expected", lead: 0,  repeatable: false,
    verb: "Check in on the decision" },
  { key: "report_due",    label: "Report due",        lead: 21, repeatable: true,
    verb: "Write the report" },
  { key: "renewal_opens", label: "Renewal window opens", lead: 45, repeatable: false,
    verb: "Start the renewal" },
];
export const MILESTONE_KEYS = MILESTONE_TYPES.map(t => t.key);
export const DEFAULT_LEAD_DAYS = Object.fromEntries(MILESTONE_TYPES.map(t => [t.key, t.lead]));

export function milestoneType(key) {
  return MILESTONE_TYPES.find(t => t.key === key) || null;
}
export function milestoneLabel(key) { const t = milestoneType(key); return t ? t.label : ""; }

// THE ORG'S OWN LEAD TIMES, and a stored value is only honoured if it is a
// sane whole number of days. A negative lead would open a thread AFTER the
// deadline, which is the one thing this part exists to prevent.
export const LEAD_MAX_DAYS = 365;
export function normalizeLeadDays(raw) {
  const out = { ...DEFAULT_LEAD_DAYS };
  if (!raw || typeof raw !== "object") return out;
  for (const k of MILESTONE_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > LEAD_MAX_DAYS) continue;
    out[k] = n;
  }
  return out;
}
// AND THE PATCH SHAPE, which is not the same function. `normalizeLeadDays`
// fills every key from the DEFAULTS, which is right when reading a stored row
// and WRONG when merging an edit: a refused value silently fell through to the
// default rather than leaving the org's own choice alone. `pickLeadDays`
// returns only the keys actually present AND valid, so `{...stored, ...patch}`
// can never overwrite a good stored value with a default.
export function pickLeadDays(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of MILESTONE_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > LEAD_MAX_DAYS) continue;
    out[k] = n;
  }
  return out;
}

export function leadDaysFor(key, leadDays) {
  const d = normalizeLeadDays(leadDays);
  return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : 0;
}

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
export function isCivilDate(v) { return CIVIL.test(String(v || "")); }

// Pure civil-date arithmetic on the calendar the caller hands in. No Date
// object crosses this boundary — a Date is an instant and a due date is a day
// (the orgTime type discipline).
export function daysBetween(fromISO, toISO) {
  if (!isCivilDate(fromISO) || !isCivilDate(toISO)) return null;
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}
export function shiftDays(iso, n) {
  if (!isCivilDate(iso)) return null;
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ── IS IT TIME TO OPEN A THREAD? ──────────────────────────────────────────
// TRUE the moment `today` reaches (due − lead), and it STAYS true afterwards.
// A sweep that missed a day must not skip the milestone forever.
export function dueWithinLead(milestone, today, leadDays) {
  if (!milestone || !isCivilDate(milestone.dueDate) || !isCivilDate(today)) return false;
  const lead = leadDaysFor(milestone.kind, leadDays);
  return daysBetween(today, milestone.dueDate) <= lead;
}

// A CLOSED GRANT OPENS NOTHING. `closed` and `declined` are finished; an
// awarded grant's report is still live work, which is the whole point.
export const MILESTONE_OPEN_GRANT_STATUSES = ["researching", "loi", "submitted", "awarded"];
export function grantWantsMilestones(status) {
  return MILESTONE_OPEN_GRANT_STATUSES.includes(String(status || "").toLowerCase());
}

// ── WHAT THE THREAD SAYS ──────────────────────────────────────────────────
// The label carries the FUNDER and the PROGRAMME, because "Write the report"
// with no subject tells an officer nothing about which of four reports.
export function milestoneStepLabel(m) {
  const t = milestoneType(m && m.kind);
  const verb = t ? t.verb : "Follow up";
  const who = String((m && m.funderName) || "").trim();
  const prog = String((m && m.program) || "").trim();
  const subject = prog && who ? `${who}: ${prog}` : (who || prog);
  return subject ? `${verb} for ${subject}` : verb;
}

// ── HOW LATE IS IT ────────────────────────────────────────────────────────
// A FACT off the due date, never a judgement. `overdueDays` is computed ONCE
// here and shipped on the row — BUILD-86's defect was two surfaces deriving
// lateness separately and disagreeing by a day.
export function milestoneTiming(m, today) {
  if (!m || !isCivilDate(m.dueDate) || !isCivilDate(today)) {
    return { band: "unknown", days: null, overdueDays: 0, sentence: "" };
  }
  const days = daysBetween(today, m.dueDate);
  const label = milestoneLabel(m.kind) || "This";
  if (days < 0) {
    const late = -days;
    return { band: "overdue", days, overdueDays: late,
      sentence: `${label} was due ${late === 1 ? "yesterday" : late + " days ago"}.` };
  }
  if (days === 0) return { band: "today", days: 0, overdueDays: 0, sentence: `${label} is due today.` };
  return { band: "ahead", days, overdueDays: 0,
    sentence: `${label} is due in ${days === 1 ? "a day" : days + " days"}.` };
}

// ── THE HOME LINE ─────────────────────────────────────────────────────────
// ONLY when non-zero (the brief's own line, and the morning-sentence rule:
// a source with nothing contributes no clause — "0 grant deadlines" is the
// product filling a screen with its own scaffolding).
export const HOME_WINDOW_DAYS = 14;
export function homeDeadlineLine(milestones = [], today, { windowDays = HOME_WINDOW_DAYS } = {}) {
  if (!isCivilDate(today)) return null;
  const inWindow = milestones.filter(m => {
    if (!isCivilDate(m.dueDate)) return false;
    const d = daysBetween(today, m.dueDate);
    return d !== null && d <= windowDays;      // overdue counts — it is still owed
  });
  if (!inWindow.length) return null;
  const n = inWindow.length;
  return `${n} grant ${n === 1 ? "deadline" : "deadlines"} in the next ${windowDays} days`;
}

// ── THE CALENDAR ──────────────────────────────────────────────────────────
// Twelve months from the month `today` falls in. EVERY month is present so an
// empty month is visibly empty rather than missing — the same rule the
// pipeline's six status columns follow.
export function calendarMonths(today, { months = 12 } = {}) {
  if (!isCivilDate(today)) return [];
  const y0 = +today.slice(0, 4), m0 = +today.slice(5, 7);
  const out = [];
  for (let i = 0; i < months; i++) {
    const t = m0 - 1 + i, y = y0 + Math.floor(t / 12), m = (t % 12) + 1;
    out.push({ month: `${y}-${String(m).padStart(2, "0")}`, count: 0, items: [] });
  }
  return out;
}
export function calendarFromMilestones(milestones = [], today, opts = {}) {
  const months = calendarMonths(today, opts);
  const byMonth = new Map(months.map(m => [m.month, m]));
  for (const m of milestones) {
    if (!isCivilDate(m.dueDate)) continue;
    const slot = byMonth.get(m.dueDate.slice(0, 7));
    if (!slot) continue;                        // outside the twelve months
    slot.items.push(m);
    slot.count++;
  }
  for (const slot of months) slot.items.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return months;
}

// ── WAITING, AND WHY IT IS NOT STUCK ──────────────────────────────────────
// The sentence a WAITING milestone carries. It names the reason, because
// "waiting" with no reason reads as a bug.
export function waitingSentence(m) {
  const label = milestoneLabel(m && m.kind) || "This deadline";
  return `${label} is next for this funder — they already have one open follow-up, and this one opens when that closes. Nothing is stuck.`;
}

export function sortMilestones(rows = []) {
  const k = m => (isCivilDate(m.dueDate) ? m.dueDate : "9999-12-31");
  return rows.slice().sort((a, b) => k(a).localeCompare(k(b)));
}
