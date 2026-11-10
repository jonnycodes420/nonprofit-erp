// shared/numbers/offlineMrr.js · MONEY-4 (W-1107-Finance-24). AN OFFLINE PLAN'S SHARE OF MRR.
// A staff-recorded plan (offline_recurring_plans) counts toward Recurring
// giving's MRR as its monthly equivalent: its amount per period over the
// months in that period (weekly x 52 / 12, quarterly / 3, annually / 12),
// while it is active (not cancelled, not past its end date on the org's day).
// The card plans' share stays where it is (routes/give.js /recurring/movement);
// the screen shows both, labeled.
"use strict";
const MONTHLY = { weekly: "52.0 / 12", monthly: "1", quarterly: "1.0 / 3", annually: "1.0 / 12" };
// Active on the org's day, bound as `?`.
const OFFLINE_ACTIVE = (pl = "pl") => `${pl}.status = 'active' AND (${pl}.end_date IS NULL OR ${pl}.end_date >= ?)`;
const MONTHLY_OF = (pl = "pl") => `(${pl}.amount * CASE ${pl}.frequency ${Object.entries(MONTHLY).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(" ")} ELSE 0 END)`;
// One row { mrr (dollars), n (plans) }; binds (orgId, today).
const OFFLINE_MRR_SQL = `SELECT COALESCE(ROUND(SUM(${MONTHLY_OF("pl")}), 2), 0) AS mrr, COUNT(*)::int AS n
  FROM offline_recurring_plans pl JOIN donors d ON d.id = pl.donor_id AND d.org_id = pl.org_id AND d.deleted_at IS NULL
 WHERE pl.org_id = ? AND ${OFFLINE_ACTIVE("pl")}`;
// The same for one plan already read, in cents.
const monthlyCents = p => Math.round((Number(p.amount) || 0) * 100 * ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, annually: 1 / 12 }[p.frequency] || 0));
module.exports = { OFFLINE_MRR_SQL, OFFLINE_ACTIVE, MONTHLY_OF, monthlyCents };
