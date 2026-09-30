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

// Reports names a fiscal year by the year it ENDS in (that is the number its
// year picker holds). Same label, one conversion.
export function fyLabelFromEnd(endYear, fiscalStartMonth = 7) {
  const y = Number(endYear);
  return fyLabelFromStart(Number(fiscalStartMonth) === 1 ? y : y - 1, fiscalStartMonth);
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
