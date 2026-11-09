// server/reports/overviewPeriod.js · TRUTH-5 (W-1109-Fundraising-07). THE
// PERIOD FUNDRAISING OVERVIEW SHOWS.
//
// Fundraising Overview had no period switch, so last fiscal year could not be
// set beside this one. `?period=` takes this_fy (the default, as before),
// last_fy, or custom with `from` and `to` (civil days). The figures are read
// over the span by the one computation Reports reads (givingBetween, cut at
// today), so Overview and Reports' Giving summary agree for the same dates.
"use strict";
const NUMBERS = require("../../shared/numbers");
const isDay = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = d => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;

// { cur: { start, end, chartLabel }, key, periodWords } or { error }.
function overviewPeriod(q, tz, yearMode) {
  const key = ["this_fy", "last_fy", "custom"].includes(q && q.period) ? q.period : "this_fy";
  const fiscal = yearMode === "fiscal";
  if (key === "custom") {
    const from = String((q && q.from) || ""), to = String((q && q.to) || "");
    if (!isDay(from) || !isDay(to) || to < from) return { error: "A custom period needs a from and a to day, the from first." };
    return { key, cur: { start: from, end: to, chartLabel: `${short(from)} to ${short(to)}` }, periodWords: `from ${short(from)} to ${short(to)}` };
  }
  const cur = NUMBERS.fiscalYear.period(tz, yearMode, key === "last_fy" ? -1 : 0);
  return { key, cur, periodWords: key === "last_fy" ? (fiscal ? "last fiscal year" : "last year") : (fiscal ? "this fiscal year" : "this year") };
}

module.exports = { overviewPeriod };
