// server/shared/periodLabel.js · POLISH-6. ONE NAME FOR EACH PERIOD, ON THE SERVER.
//
// W-1107-Fundraising-05: one page called the same year "FY 2026-27", "Fiscal
// year 2026-27", "FY2026" and "this fiscal year". Every period label the server
// sends comes from shared/fiscalPeriod.js (the browser's own module), through
// this one door: fyLabelOf(bounds, startMonth) for a fiscal year by its bounds.
// A campaign or appeal name is a name, never a period label.
"use strict";
const FP = import("../../shared/fiscalPeriod.js");
const orgTime = require("../../orgTime");

// The org's fiscal year that `bounds` ({ start }) begins, as "FY 2026–27" (or
// "FY 2026" when it is the calendar year).
async function fyLabelOf(bounds, startMonth) {
  return (await FP).fyLabelFromStart(Number(String(bounds.start).slice(0, 4)), startMonth);
}
// The same for an org row: its current fiscal year (offset 0) or another.
async function orgFyLabel(org, offset = 0) {
  return fyLabelOf(orgTime.orgPeriodBounds(org, "fiscal_year", offset), orgTime.orgFiscalStartMonth(org));
}

// POLISH-7: the long form for a page's first use, from the year's bounds:
// "FY 2026–27 (Jul 1, 2026 to Jun 30, 2027)".
async function fyLongLabelOf(bounds) {
  const s = String(bounds.start);
  return (await FP).fyLongLabel(Number(s.slice(0, 4)), Number(s.slice(5, 7)));
}

// POLISH-9 (W-1107-Fundraising-05, the Board): one period had four names
// ("FY 2026-27", "Giving this year", "Same point last year", "This fiscal
// year"). The year, the one before it, and that one up to the same day, from
// the year's bounds and today: { cur: "FY 2026–27", prev: "FY 2025–26",
// samePoint: "FY 2025–26 to Nov 10" }.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
async function yearPairNames(bounds, today) {
  const F = await FP;
  const s = String(bounds.start), y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7));
  const t = String(today || "");
  const cur = F.fyLabelFromStart(y, m), prev = F.fyLabelFromStart(y - 1, m);
  const day = /^\d{4}-\d{2}-\d{2}/.test(t) ? `${MON[Number(t.slice(5, 7)) - 1]} ${Number(t.slice(8, 10))}` : null;
  return { cur, prev, samePoint: day ? `${prev} to ${day}` : prev };
}

module.exports = { fyLabelOf, orgFyLabel, fyLongLabelOf, yearPairNames };
