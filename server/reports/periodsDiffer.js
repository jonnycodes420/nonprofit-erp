// server/reports/periodsDiffer.js · FLOWS-9 (W-1112-Fundraising-05). WHEN THE
// CARDS COUNT DIFFERENT DAYS, ONE LINE SAYS SO.
//
// Fundraising showed "Raised · FY 2026–27 $806,507.28" beside campaign cards
// on their own date ranges. FLOWS-7 named each card's dates (MoneyPeriod), and
// the fleet still read the two as one period. So when any campaign or goal
// card on the page counts days other than the Raised card's, one plain line
// sits under the cards:
//   "Campaigns count their own dates. Raised counts your fiscal year, Jul 1 to Jun 30."
// The words only: nothing is summed here. null when every card agrees.
"use strict";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = s => String(s || "").slice(0, 10);
const monthDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day(s)); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}` : ""; };

// period: { key, start, end, label } (the Raised card's); yearMode "fiscal" | "calendar";
// fyStartMonth 1..12; cards: [{ startDate, endDate }] (the campaign and goal cards shown).
function periodsDiffer({ period, yearMode = "fiscal", fyStartMonth = 1, cards = [] }) {
  if (!period || !period.start || !period.end) return null;
  const differs = (cards || []).some(c => c && (c.startDate || c.endDate)
    && (day(c.startDate) !== day(period.start) || day(c.endDate) !== day(period.end)));
  if (!differs) return null;
  const span = `${monthDay(period.start)} to ${monthDay(period.end)}`;
  const thisYear = !period.key || period.key === "this_fy";
  const what = !thisYear ? `${period.label || "the period you picked"}, ${span}`
    : yearMode === "calendar" || Number(fyStartMonth) === 1 ? `the calendar year, ${span}`
    : `your fiscal year, ${span}`;
  return `Campaigns count their own dates. Raised counts ${what}.`;
}

module.exports = { periodsDiffer };
