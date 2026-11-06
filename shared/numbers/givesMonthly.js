// shared/numbers/givesMonthly.js · FLOWS-2 item 3. WHO "GIVES MONTHLY".
//
// The Donors filter "Gives monthly: yes" read any recurring plan at any
// interval, so a person on a two-monthly plan, or anyone with a plan of any
// kind, stayed on the list (the walk's Dir 4: "someone who gives about every
// two months stayed in"). One rule now, written once, and its words are the
// filter's tooltip:
//
//   a monthly recurring plan that is still running (WIRE-1's running states),
//   OR 6 or more giving days in the last 12 months (the org's today and the
//   364 days before it) whose usual gap, the median between giving days, is
//   about a month: 21 to 45 days.
//
// A giving day is a day with at least one gift of money (soft and matching
// credits are recognition, never money), so two gifts on one day are one.
// The median is rhythm.js's own (STATUS-1: one rhythm), never a copy.
"use strict";

const { median } = require("./rhythm");
const { MONEY } = require("./money");
const orgTime = require("../../orgTime");

const RUNNING = ["active", "past_due", "recovering", "recovered"];   // groups.js ACTIVE_RECURRING_STATUSES
const MIN_DAYS = 6, GAP_MIN = 21, GAP_MAX = 45;

const SENTENCE = "Gives monthly: a monthly recurring gift that is still running, or gifts on 6 or more days in the last 12 months that came about a month apart (the usual gap between them is 3 to 6 weeks).";

// The usual gap, in days, between the sorted giving days given.
function usualGap(days) {
  const s = [...new Set(days)].filter(d => orgTime.parseCivil(d)).sort();
  const gaps = [];
  for (let i = 1; i < s.length; i++) gaps.push(orgTime.daysBetween(s[i - 1], s[i]));
  return { days: s.length, gap: median(gaps.filter(g => g != null)) };
}
const isMonthlyRhythm = days => { const u = usualGap(days); return u.days >= MIN_DAYS && u.gap != null && u.gap >= GAP_MIN && u.gap <= GAP_MAX; };

// Every person in the org who gives monthly, as of `today` (the org's civil day).
async function givesMonthlyIds(query, orgId, today) {
  const from = orgTime.addDays(today, -364);
  const plans = await query(
    `SELECT DISTINCT donor_id FROM recurring_subscriptions
      WHERE org_id = ? AND interval = 'month' AND status = ANY(?::text[]) AND donor_id IS NOT NULL`, [orgId, RUNNING]);
  const rows = await query(
    `SELECT g.donor_id, array_agg(DISTINCT LEFT(g.date, 10)) AS days
       FROM gifts g
      WHERE g.org_id = ? AND g.amount > 0 AND ${MONEY("g")}
        AND LEFT(g.date, 10) >= ? AND LEFT(g.date, 10) <= ?
      GROUP BY g.donor_id
     HAVING COUNT(DISTINCT LEFT(g.date, 10)) >= ?`, [orgId, from, today, MIN_DAYS]);
  const ids = new Set(plans.map(r => r.donor_id));
  for (const r of rows) if (isMonthlyRhythm(r.days || [])) ids.add(r.donor_id);
  return [...ids];
}

module.exports = { givesMonthlyIds, isMonthlyRhythm, usualGap, SENTENCE, MIN_DAYS, GAP_MIN, GAP_MAX };
