// shared/fiscalPeriod.js — FIX-10 Part B. ONE NAME FOR A FISCAL YEAR.
//
// Fundraising's header read "$0 RAISED · FY 2026–27" to an org that had just
// imported $19,750, while Reports, two clicks away, showed the money under a
// chip reading "This FY" with no year on it at all. Reports also defaults
// itself to LAST year when the current one is nearly empty, which is a kind
// thing to do and a dangerous one: the chip said "Last FY" and the label
// carried no year, so the total on screen belonged to a year the reader had
// not chosen and could not name.
//
// Two implementations of the same label was how that happened. Reports built
// its own from the browser clock; the server built its own in
// finPeriodBounds. This file is the one that builds it, and both read it, so
// the same label can never sit over different money.
//
// A fiscal year is named for the two calendar years it spans, from the year it
// STARTS in: FY 2026–27. An org whose fiscal year IS the calendar year gets
// one year, FY 2026, because "FY 2026–27" would be a lie about its dates.

// The en dash here is the range dash, which is what a year span takes. It is
// not an em dash: those are banned in customer copy and none is used.
const RANGE_DASH = "–";

export function fyLabelFromStart(startYear, fiscalStartMonth = 7) {
  const y = Number(startYear);
  if (Number(fiscalStartMonth) === 1) return `FY ${y}`;
  return `FY ${y}${RANGE_DASH}${String(y + 1).slice(2)}`;
}

// POLISH-7 (W-1107-Fundraising-05): the one long form, for the first use on a
// page: "FY 2026–27 (Jul 1, 2026 to Jun 30, 2027)". Same short label, its
// dates after it, never a second name for the year.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fyLongLabel(startYear, fiscalStartMonth = 7) {
  const y = Number(startYear), m = Number(fiscalStartMonth) || 1;
  const endY = m === 1 ? y : y + 1, endM = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(endY, endM, 0)).getUTCDate();
  return `${fyLabelFromStart(y, m)} (${MON[m - 1]} 1, ${y} to ${MON[endM - 1]} ${lastDay}, ${endY})`;
}
// The start year of the fiscal year a short label names ("FY 2026–27" → 2026).
export function fyStartOfLabel(label) {
  const m = /^FY (\d{4})/.exec(String(label || ""));
  return m ? Number(m[1]) : null;
}

// Reports names a fiscal year by the year it ENDS in (that is the number its
// year picker holds). Same label, one conversion.
// LEDGER-2: for a year that starts in January too. The server's year number is
// the year its boundary falls in (reportYearBounds: 2027 is Jan to Dec 2026,
// and Reports' own range label already said so), so "FY 2027" sat over 2026's
// money on a calendar-year org. One conversion for every start month.
export function fyLabelFromEnd(endYear, fiscalStartMonth = 7) {
  const y = Number(endYear);
  return fyLabelFromStart(y - 1, fiscalStartMonth);
}

// Just the years, for a chip that already says "FY": "2026–27".
export function fyYearsFromEnd(endYear, fiscalStartMonth = 7) {
  return fyLabelFromEnd(endYear, fiscalStartMonth).replace(/^FY /, "");
}

// The label a period chip wears. "This FY" and "Last FY" on their own are
// exactly the two labels that hid which year was on screen, so the years ride
// along, always, on every chip that has a year.
export function periodChipLabel(kind, { fy, cy, fiscalStartMonth = 7 } = {}) {
  switch (kind) {
    case "thisFY": return `This FY · ${fyYearsFromEnd(fy, fiscalStartMonth)}`;
    case "lastFY": return `Last FY · ${fyYearsFromEnd(fy - 1, fiscalStartMonth)}`;
    case "thisCY": return `This CY · ${cy}`;
    case "lastCY": return `Last CY · ${cy - 1}`;
    default: return "Custom";
  }
}

// LEDGER-2 · ONE "TODAY". Which fiscal and calendar year are "this" one is the
// server's answer (the giving summary's `fiscalYear` and `calendarYear`, on the
// org's own calendar). Reports used to fall back to the browser's calendar year
// until the server answered, or for good when the request failed, and read it
// as the year a fiscal year ENDS in: on 5 Nov 2026 that is "This FY 2025–26",
// a year behind the server's "2026–27". Null until both years are known, and
// a screen with null shows no year at all rather than a guessed one.
export function reportYearsFrom(summary) {
  const fy = Number(summary && summary.fiscalYear), cy = Number(summary && summary.calendarYear);
  return fy && cy ? { fy, cy } : null;
}
