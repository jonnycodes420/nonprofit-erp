// server/reports/periodNotes.js · TRUTH-6 (W-1110-Fundraising-06X). WHAT DOES NOT MOVE WITH THE PERIOD, SAID.
//
// Switching Fundraising to Last FY moved the gift totals and left the goal and
// the pledges on this year, silently. The goal now follows the period
// (fundraising.js reads a goal set for days in it). Pledges are what is open
// TODAY: a balance has no "last year" to go back to, so the page says so,
// and a period with no goal of its own says which period the goals are set for.
// [{ key, sentence }], empty on This FY.
"use strict";
const { query } = require("../../db");

async function periodNotes({ key, label, goal, orgId, today, pledges }) {
  if (key === "this_fy") return [];
  const out = [];
  const DD = await import("../../shared/displayDate.js");
  if (!goal) {
    const [g] = await query("SELECT label, period_start, period_end FROM fundraising_goals WHERE org_id = ? AND period_start <= ? AND period_end >= ? ORDER BY created_at DESC LIMIT 1", [orgId, today, today]);
    out.push({ key: "goal", sentence: g
      ? `No goal was set for ${label}. Goals are set for ${DD.displayDate(g.period_start) || g.period_start} to ${DD.displayDate(g.period_end) || g.period_end}${pledges && pledges.yearLabel ? ` (${pledges.yearLabel})` : ""}.`
      : `No goal was set for ${label}.` });
  }
  out.push({ key: "pledges", sentence: `Pledges are what is open today${pledges && pledges.yearLabel ? `, due in ${pledges.yearLabel}` : ""}. A pledge balance does not move with the period.` });
  return out;
}

module.exports = { periodNotes };
