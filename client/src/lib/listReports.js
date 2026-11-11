// client/src/lib/listReports.js · FLOWS-5 (W-1110-Fundraising-14). THE LIST REPORTS.
//
// A list report is a call list of people. Each one offers "Save as a group"
// every time it is drawn, from this definition, never from a flag set on a
// first load: the fleet saw it on LYBUNT, SYBUNT and Lost once and then never
// again. The group keeps the people on the rows (a hand-kept group).
export const LIST_REPORTS = Object.freeze({
  lybunt: { group: "Gave last year, not yet this year" },
  sybunt: { group: "Gave before, not this year" },
  "std:lapsed-24": { group: "Lost: over 24 months" },
});
export const listReportOf = id => LIST_REPORTS[id] || null;
// "LYBUNT, Nov 11, 2026": the group's name, with the day the list was read.
export const listGroupName = (id, day = new Date()) => {
  const d = listReportOf(id);
  return d ? `${d.group}, ${day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "";
};
