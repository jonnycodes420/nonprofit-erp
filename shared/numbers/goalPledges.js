// shared/numbers/goalPledges.js · GIFTS-2. DOES A GOAL COUNT PLEDGES?
//
// Each goal says. "Count pledges toward this goal" is a switch on the goal:
// off by default for the org's annual goal (money in the door is the annual
// fund's measure), on by default for a campaign (a capital campaign is
// pledges). Nothing is hidden either way:
//   on   "Raised $225,116 + $23,750 pledged = $248,866 committed", and pace
//        compares COMMITTED with the share of the window gone.
//   off  "Raised $225,116. $23,750 more is pledged, not counted toward this
//        goal.", and pace compares raised.
// Pledged is what is still owed on open pledges (amount less what has been
// paid, shared/numbers/pledges.js), never the pledge's face value: a payment is
// a gift and is already in Raised, so committed never counts a dollar twice.
"use strict";
const { PAID_BY_PLEDGE } = require("./pledges");

// The stored switch (true, false or null) and the goal's kind → on or off.
function countsPledges(kind, stored) {
  if (stored === true || stored === false) return stored;
  return kind === "campaign";
}

const dollars = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

// { raised, pledged, committed, countPledges, paceBasis, sentence, definition }. Dollars.
function committedOf({ raised, pledged, countPledges }) {
  const r = Math.round((Number(raised) || 0) * 100) / 100;
  const p = Math.round((Number(pledged) || 0) * 100) / 100;
  const committed = Math.round((r + p) * 100) / 100;
  const on = !!countPledges;
  const sentence = on
    // Whole dollars that foot on the screen: the shown parts add to the shown sum.
    ? `Raised ${dollars(r)} + ${dollars(p)} pledged = ${dollars(Math.round(r) + Math.round(p))} committed`
    : p > 0 ? `Raised ${dollars(r)}. ${dollars(p)} more is pledged, not counted toward this goal.`
            : `Raised ${dollars(r)}. Nothing is pledged and unpaid.`;
  return {
    raised: r, pledged: p, committed, countPledges: on, paceBasis: on ? committed : r, sentence,
    definition: on
      ? "Committed is the money given inside the goal's dates plus what is still owed on open pledges due by its last day. Pace compares committed with the share of the time gone."
      : "Pledged is what is still owed on open pledges due by the goal's last day. This goal counts money given only; turn on Count pledges to count them.",
  };
}

// What is still owed, in dollars, on the org's open pledges due on or before
// `through` (a goal's last day), from people still on file.
async function orgPledgedThrough(query, orgId, through) {
  const [r] = await query(
    `SELECT COALESCE(SUM(GREATEST(p.amount - COALESCE(pp.paid, 0), 0)), 0) AS pledged
       FROM pledges p
       JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
       LEFT JOIN ${PAID_BY_PLEDGE} pp ON pp.pledge_id = p.id
      WHERE p.org_id = ? AND p.status = 'open' AND LEFT(p.due_date, 10) <= ?`, [orgId, orgId, String(through).slice(0, 10)]);
  return Number(r && r.pledged) || 0;
}

module.exports = { countsPledges, committedOf, orgPledgedThrough };
