// orgTime.js — BUILD-72 Part 4. THE ONE SEAM for civil dates.
//
// ── THE TYPE DISCIPLINE ────────────────────────────────────────────────────
// Two kinds of time exist in this product and they never touch except here.
//
//   INSTANTS     A moment on the world clock. created_at, webhook receipt
//                times, payment times, session times. `timestamptz`, always
//                UTC, never rendered without a timezone. `now()` on one of
//                these is correct and is not this module's business.
//
//   CIVIL DATES  A day on a calendar. Gift date, pledge due date, task due
//                date, campaign start/end. `YYYY-MM-DD`. NO TIMEZONE, and
//                NEVER CONVERTED — a gift given on March 15 was given on
//                March 15 in every timezone on earth, and any code that
//                shifts it is wrong.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
// Never compare a civil date to `now()`, `CURRENT_DATE`, `CURRENT_TIMESTAMP`
// or a JavaScript `new Date()`. That comparison IS the bug, in all ~150 of the
// forms `scripts/build72-date-audit.js` enumerates.
//
// BUILD-72 Part 0 captured it live. A task due today, on the day view, with
// nothing changing but the wall clock:
//
//     19:59:58 EDT  (23:59:58 UTC, 2026-08-29)  daysOverdue 0
//     20:00:58 EDT  (00:00:58 UTC, 2026-08-30)  daysOverdue 1
//
// The org is still on Saturday. The task is still due Saturday. Only the UTC
// calendar date moved. Four hours early, every evening, on the first screen of
// the product — during the hours the demos actually happen.
//
// ── THE SEAM ───────────────────────────────────────────────────────────────
// Everything here answers in CIVIL DATES computed in the ORGANIZATION's
// timezone. Nothing here returns an instant, so nothing downstream can
// accidentally compare one to a date.

// The product's fiscal year starts July 1 (month index 6). One definition.
const FISCAL_START_MONTH = 6;
const DEFAULT_TZ = "America/New_York";

// Format an instant as the civil date it is IN A GIVEN ZONE. Intl is the only
// correct way to do this — it knows the offset for that instant, including DST
// and half-hour zones. Manual offset arithmetic is what produced the bug.
const _fmt = new Map();
function partsIn(tz, instant) {
  let f = _fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    _fmt.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute };
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return true; } catch { return false; }
}
function normalizeTimezone(tz) { return isValidTimezone(tz) ? tz : DEFAULT_TZ; }

const pad = n => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// ── Civil-date arithmetic. Pure calendar math on Y/M/D — NEVER milliseconds.
// `+ 7 * 24 * 60 * 60 * 1000` is wrong by definition: a week containing a DST
// transition is 167 or 169 hours long, so millisecond arithmetic silently
// lands on the wrong day twice a year.
function parseCivil(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
// Days since epoch for a civil date — a pure calendar quantity with no zone.
function civilToDays(c) { return Math.floor(Date.UTC(c.y, c.m - 1, c.d) / 86400000); }
function daysToCivil(n) {
  const dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function addDays(dateStr, n) {
  const c = parseCivil(dateStr); if (!c) return null;
  const r = daysToCivil(civilToDays(c) + n);
  return ymd(r.y, r.m, r.d);
}
// 0 = Monday … 6 = Sunday, matching the product's Monday-based week.
function dayOfWeek(dateStr) {
  const c = parseCivil(dateStr); if (!c) return null;
  return (new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay() + 6) % 7;
}
function compareCivil(a, b) {
  const ca = parseCivil(a), cb = parseCivil(b);
  if (!ca || !cb) return null;
  return civilToDays(ca) - civilToDays(cb);
}
function daysBetween(a, b) { const d = compareCivil(b, a); return d == null ? null : d; }

// ── THE PUBLIC SEAM ────────────────────────────────────────────────────────

// today(org) — the civil date it currently IS for that organization.
function orgToday(org, atInstant = new Date()) {
  const tz = normalizeTimezone(org && (org.timezone || org.tz));
  const p = partsIn(tz, atInstant);
  return ymd(p.y, p.m, p.d);
}

// The org's current local wall-clock hour/minute, for the few surfaces gated on
// a time of day (the morning-reminder window).
function orgClock(org, atInstant = new Date()) {
  const tz = normalizeTimezone(org && (org.timezone || org.tz));
  const p = partsIn(tz, atInstant);
  return { hour: p.hh, minute: p.mm, date: ymd(p.y, p.m, p.d) };
}

// isOverdue(dueDate, org) — a comparison of TWO CIVIL DATES and nothing else.
// This is the function whose absence produced the Part 0 capture.
function orgIsOverdue(dueDate, org, atInstant = new Date()) {
  const c = compareCivil(dueDate, orgToday(org, atInstant));
  return c == null ? false : c < 0;
}
function orgDaysOverdue(dueDate, org, atInstant = new Date()) {
  const n = daysBetween(dueDate, orgToday(org, atInstant));
  return n == null || n <= 0 ? 0 : n;
}

// range(org, period[, offset]) — inclusive civil-date {start, end} for a named
// period, in the organization's timezone. offset 0 = current, -1 = previous.
const PERIODS = ["today", "week", "month", "quarter", "year", "fiscal_year"];
function orgPeriodBounds(org, period, offset = 0, atInstant = new Date()) {
  const today = orgToday(org, atInstant);
  const c = parseCivil(today);

  switch (period) {
    case "today": {
      const d = addDays(today, offset);
      return { start: d, end: d, key: `day:${d}` };
    }
    case "week": {
      // Monday-based. Calendar arithmetic, never + 7*24*60*60*1000.
      const monday = addDays(today, -dayOfWeek(today) + offset * 7);
      return { start: monday, end: addDays(monday, 6), key: `wk:${monday}` };
    }
    case "month": {
      const mIdx = c.y * 12 + (c.m - 1) + offset;
      const y = Math.floor(mIdx / 12), m = (mIdx % 12) + 1;
      const start = ymd(y, m, 1);
      const endIdx = mIdx + 1;
      const ey = Math.floor(endIdx / 12), em = (endIdx % 12) + 1;
      return { start, end: addDays(ymd(ey, em, 1), -1), key: `mo:${y}-${pad(m)}` };
    }
    case "quarter": {
      const qIdx = Math.floor((c.m - 1) / 3) + offset + c.y * 4;
      const y = Math.floor(qIdx / 4), q = qIdx % 4;
      const start = ymd(y, q * 3 + 1, 1);
      const nIdx = qIdx + 1, ny = Math.floor(nIdx / 4), nq = nIdx % 4;
      return { start, end: addDays(ymd(ny, nq * 3 + 1, 1), -1), key: `q:${y}-Q${q + 1}` };
    }
    case "year": {
      const y = c.y + offset;
      return { start: ymd(y, 1, 1), end: ymd(y, 12, 31), key: `cy:${y}` };
    }
    case "fiscal_year": {
      // FY labelled by its START year: July 1 → June 30.
      const fyStart = (c.m - 1 < FISCAL_START_MONTH ? c.y - 1 : c.y) + offset;
      return {
        start: ymd(fyStart, FISCAL_START_MONTH + 1, 1),
        end: addDays(ymd(fyStart + 1, FISCAL_START_MONTH + 1, 1), -1),
        key: `fy:${fyStart}`,
      };
    }
    default:
      throw new Error(`orgPeriodBounds: unknown period "${period}" (known: ${PERIODS.join(", ")})`);
  }
}

// The current fiscal-year START date, the single most-repeated boundary in the
// codebase (31 hand-rolled copies before this build).
function orgFiscalYearStart(org, atInstant = new Date()) {
  return orgPeriodBounds(org, "fiscal_year", 0, atInstant).start;
}
// The year a report labels "current", for both bases.
function orgReportYear(org, yearMode, atInstant = new Date()) {
  const c = parseCivil(orgToday(org, atInstant));
  if (yearMode === "fiscal") return c.m - 1 < FISCAL_START_MONTH ? c.y : c.y + 1;
  return c.y;
}

module.exports = {
  DEFAULT_TZ, FISCAL_START_MONTH, PERIODS,
  isValidTimezone, normalizeTimezone,
  orgToday, orgClock, orgIsOverdue, orgDaysOverdue,
  orgPeriodBounds, orgFiscalYearStart, orgReportYear,
  addDays, dayOfWeek, compareCivil, daysBetween, parseCivil,
};
