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

module.exports = { fyLabelOf, orgFyLabel, fyLongLabelOf };
