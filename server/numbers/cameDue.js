// NUMBERS-6 · A SCHEDULED GIFT'S DAY COMES, AND THE TOTALS KEPT ON ITS PERSON MOVE.
//
// A postdated gift (TRUTH-6, gifts.scheduled_on) is money on its day, not
// before, so the stored totals leave it out until then (shared/numbers/money.js
// DUE). Nothing wrote to the person on that day, so their stored total, count
// and last gift stayed short until the next write to them. Once an hour this
// recomputes, through the one writer (shared/numbers/donorTotals.js), the
// people with a scheduled gift whose day came in the last few days in their
// org's own time. The recompute writes only a person whose totals differ, so
// running it again changes nothing.
"use strict";
const { DUE } = require("../../shared/numbers/scheduled");
const { recomputeStoredTotals } = require("../../shared/numbers/donorTotals");

const LOOKBACK_DAYS = 3;   // a missed hour or a restart is caught up, never a whole history

async function recomputeCameDue(query, { orgId = null } = {}) {
  const rows = await query(
    `SELECT g.org_id, ARRAY_AGG(DISTINCT g.donor_id) AS ids FROM gifts g
      WHERE g.scheduled_on IS NOT NULL AND g.donor_id IS NOT NULL AND ${DUE("g")}
        AND g.scheduled_on >= to_char(CURRENT_DATE - ${LOOKBACK_DAYS}, 'YYYY-MM-DD')
        AND ($1::text IS NULL OR g.org_id = $1)
      GROUP BY g.org_id`, [orgId]);
  let people = 0;
  for (const r of rows) { await recomputeStoredTotals(query, r.org_id, r.ids); people += r.ids.length; }
  return { orgs: rows.length, people };
}

module.exports = { recomputeCameDue, LOOKBACK_DAYS };
