// shared/numbers/fiscalYear.js · NUMBERS-3. THE ORG'S FISCAL YEAR, IN ONE PLACE.
//
// The year starts on the first day of the org's start month (Settings, "When
// does your year start?"; July when the org never said) and is named by its
// dates: "Jul 2026 to Jun 2027", or "Jan to Dec 2026" when it is the calendar
// year. The boundary itself is orgTime.orgPeriodBounds(org, "fiscal_year"),
// which every caller here reaches through this file. "To date" stops at the
// org's today, so a gift dated in the future is never in this year's money.
//
// Before this file there were four more copies of the boundary: server.js
// finPeriodBounds and computeRetentionRate's fyOf, donorStatus.windowsFor
// and insights.js's fyStart. Each now calls one of the functions below.
//
// Server-side, CommonJS (shared/numbers/package.json), no database.
"use strict";
const orgTime = require("../../orgTime");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = n => String(n).padStart(2, "0");
const RANGE_DASH = "–";

const startMonth = org => orgTime.orgFiscalStartMonth(org || {});

// The fiscal year a civil date falls in, named by the year it STARTS in.
function startYearOf(date, sm) {
  const c = orgTime.parseCivil(String(date || "").slice(0, 10));
  if (!c) return null;
  return c.m < sm ? c.y - 1 : c.y;
}

// The year that starts in `startYear`, for an org whose year starts in month `sm`.
function yearStarting(startYear, sm) {
  const start = `${startYear}-${pad(sm)}-01`;
  const end = orgTime.addDays(`${startYear + 1}-${pad(sm)}-01`, -1);
  const endY = Number(end.slice(0, 4)), endM = Number(end.slice(5, 7));
  return {
    start, end, startYear, startMonth: sm, key: `fy:${startYear}`,
    // The words a person reads: the months and years it covers.
    label: sm === 1 ? `Jan to Dec ${startYear}` : `${MON[sm - 1]} ${startYear} to ${MON[endM - 1]} ${endY}`,
    // shared/fiscalPeriod.js fyLabelFromStart, the chip's short name (the test holds them equal).
    chartLabel: sm === 1 ? `FY ${startYear}` : `FY ${startYear}${RANGE_DASH}${String(startYear + 1).slice(2)}`,
    // The month buckets, in the year's order from its first month (m is 0-based).
    months: [...Array(12)].map((_, i) => ({ y: startYear + Math.floor((sm - 1 + i) / 12), m: (sm - 1 + i) % 12 })),
  };
}

// The org's fiscal year `offset` years from this one (0 this year, -1 last).
function fiscalYear(org, offset = 0, atInstant = new Date()) {
  const b = orgTime.orgPeriodBounds(org || {}, "fiscal_year", offset, atInstant);
  return yearStarting(Number(b.start.slice(0, 4)), startMonth(org));
}

// That year from its first day to the org's today (the whole year once it has
// passed; nothing once it has not started).
function fiscalYearToDate(org, offset = 0, atInstant = new Date()) {
  const fy = fiscalYear(org, offset, atInstant);
  const today = orgTime.orgToday(org || {}, atInstant);
  return { ...fy, from: fy.start, to: today < fy.end ? today : fy.end, today };
}

// A screen that offers "fiscal" or "calendar" years. `periodLabel` is the label
// those screens already print ("Jul 2026 – Jun 2027"), kept so no screen's copy
// moves; `label` is the one above.
function period(org, yearMode, offset = 0, atInstant = new Date()) {
  if (yearMode === "fiscal") {
    const fy = fiscalYear(org, offset, atInstant);
    const endY = Number(fy.end.slice(0, 4)), endM = Number(fy.end.slice(5, 7));
    return { ...fy, periodLabel: fy.startMonth === 1 ? `Jan – Dec ${fy.startYear}` : `${MON[fy.startMonth - 1]} ${fy.startYear} – ${MON[endM - 1]} ${endY}` };
  }
  const y = Number(orgTime.orgToday(org || {}, atInstant).slice(0, 4)) + offset;
  return {
    start: `${y}-01-01`, end: `${y}-12-31`, startYear: y, startMonth: 1, key: `cy:${y}`,
    label: `Jan to Dec ${y}`, periodLabel: `Jan – Dec ${y}`, chartLabel: `${y}`,
    months: [...Array(12)].map((_, m) => ({ y, m })),
  };
}

// The fiscal year `today` is in and the one before, as civil dates, for a
// caller that already holds the org's today and start month (the tags).
function thisAndLast(today, sm) {
  const y = startYearOf(today, sm);
  const cur = yearStarting(y, sm), prev = yearStarting(y - 1, sm);
  return { cyFrom: cur.start, cyTo: cur.end, lyFrom: prev.start, lyTo: prev.end };
}

module.exports = { startMonth, startYearOf, yearStarting, fiscalYear, fiscalYearToDate, period, thisAndLast };
