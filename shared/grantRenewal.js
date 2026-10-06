// shared/grantRenewal.js · GRANTS-1. WHEN TO ASK AGAIN.
//
// A grant that closes is the best lead a grants office has: the funder said
// yes once. When it closes, Steward plans the renewal (routes/grantReports.js
// planRenewal): a new grant at Prospecting and one dated deadline on the
// Calendar. This file decides the date and the kind of deadline, and says why
// in a sentence. When the funder's record cannot give a date, it says so and
// plans nothing, because a guessed deadline on the Calendar is worse than none.
//
// The rules, in order:
//   · invitation_only: no date. They ask you; you do not apply.
//   · unknown (or no cycle on file): no date, and the sentence says to add it.
//   · rolling: they take applications any time, so nine months after the
//     grant closed (or today, if that is already past).
//   · the months they take applications are on file: the 1st of the next of
//     those months after the grant closed (or after today, if that is later).
//   · annual with no months on file: a year after the grant closed, less a
//     sixty-day lead for the letter of inquiry (rolled on a year at a time
//     until it is not in the past).
//   · biannual or quarterly with no months on file: no date. Twice a year
//     without the months is a guess, and Steward does not plan one.
//
// Pure: no DB, no network, no clock (today is passed in), no JSX.
import { normalizeStatus } from "./grantShape.js";
import { displayDate } from "./displayDate.js";

export const RENEWAL_CYCLES = [
  { key: "annual",          label: "Once a year" },
  { key: "biannual",        label: "Twice a year" },
  { key: "quarterly",       label: "Four times a year" },
  { key: "rolling",         label: "Any time (rolling)" },
  { key: "invitation_only", label: "By invitation only" },
  { key: "unknown",         label: "Not known" },
];
export const RENEWAL_CYCLE_KEYS = RENEWAL_CYCLES.map(c => c.key);
export const ANNUAL_LOI_LEAD_DAYS = 60;
export const ROLLING_MONTHS = 9;

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const pad = n => String(n).padStart(2, "0");

function parse(iso) {
  const m = CIVIL.exec(String(iso || "").slice(0, 10));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// Calendar arithmetic on civil dates, never through a clock.
export function addMonths(iso, n) {
  const c = parse(iso);
  if (!c) return null;
  const t = c.y * 12 + (c.m - 1) + n;
  const y = Math.floor(t / 12), m = (t % 12) + 1;
  return ymd(y, m, Math.min(c.d, lastDay(y, m)));
}
export function addDays(iso, n) {
  const c = parse(iso);
  if (!c) return null;
  const d = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function normalizeCycle(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return RENEWAL_CYCLE_KEYS.includes(s) ? s : "unknown";
}
export function normalizeDueMonths(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return [...new Set(arr.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12))].sort((a, b) => a - b);
}
function monthList(months) {
  const names = months.map(m => MONTHS[m - 1]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// → { date: "YYYY-MM-DD" | null, sentence }. `funderName` only shapes the
// sentence. `closedOn` falls back to today when the grant has no closed date.
export function nextRenewalDate({ cycle, dueMonths, closedOn, today, funderName } = {}) {
  const who = String(funderName || "").trim() || "This funder";
  const t = parse(today) ? String(today).slice(0, 10) : null;
  const closed = parse(closedOn) ? String(closedOn).slice(0, 10) : t;
  const c = normalizeCycle(cycle);
  const months = normalizeDueMonths(dueMonths);
  if (!closed) return { date: null, sentence: "There is no date to plan from: the grant has no closed date and today is not known." };

  if (c === "invitation_only") return { date: null, sentence: `${who} gives by invitation only, so there is no date to plan.` };
  if (c === "unknown") {
    return { date: null, sentence: `${who}'s giving cycle is not on file, so there is no date to plan. Add it on the funder's record and plan the renewal again.` };
  }
  if (c === "rolling") {
    const d = addMonths(closed, ROLLING_MONTHS);
    if (t && d < t) {
      return { date: t, sentence: `${who} takes applications at any time, and nine months after this grant closed has already passed, so the renewal is planned for today: ${displayDate(t)}.` };
    }
    return { date: d, sentence: `${who} takes applications at any time, so the renewal is planned nine months after this grant closed: ${displayDate(d)}.` };
  }
  if (months.length) {
    const base = t && t > closed ? t : closed;
    const b = parse(base);
    let date = null;
    for (let i = 0; i <= 12 && !date; i++) {
      const tm = b.y * 12 + (b.m - 1) + i, y = Math.floor(tm / 12), m = (tm % 12) + 1;
      const first = ymd(y, m, 1);
      if (months.includes(m) && first > base) date = first;
    }
    return { date, sentence: `${who} takes applications in ${monthList(months)}, so the renewal is planned for the next of those after ${displayDate(base)}: ${displayDate(date)}.` };
  }
  if (c === "annual") {
    let d = addDays(addMonths(closed, 12), -ANNUAL_LOI_LEAD_DAYS);
    let rolled = false;
    while (t && d < t) { d = addMonths(d, 12); rolled = true; }
    const when = rolled ? "sixty days before the next anniversary of this grant's close that is still to come:"
      : "a year after this grant closed, sixty days early to leave time for a letter:";
    return { date: d, sentence: `${who} gives once a year and the month is not on file, so the renewal is planned ${when} ${displayDate(d)}.` };
  }
  const how = c === "biannual" ? "twice a year" : "four times a year";
  return { date: null, sentence: `${who} gives ${how}, but the months are not on file, so there is no date to plan. Add the months on the funder's record and plan the renewal again.` };
}

// The deadline the renewal starts with: a letter of inquiry if the funder
// asked for one on the grant being renewed (it had an LOI deadline, or it sat
// at the LOI stage), otherwise the proposal itself.
export function renewalKind({ milestoneKinds = [], statuses = [] } = {}) {
  const usedLoi = (milestoneKinds || []).includes("loi_due")
    || (statuses || []).some(s => normalizeStatus(s) === "loi");
  return usedLoi ? "loi_due" : "proposal_due";
}
