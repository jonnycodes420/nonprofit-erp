// shared/numbers/onboardTotals.js · ONBOARD-3. THE ROWS THAT USUALLY EXPLAIN A YEAR
// THAT DIFFERS FROM THE OLD SYSTEM, and how much they come to. Read by
// "Does this match your old system?" (server/onboard/totals.js) and opened by
// its figure sources (server/onboard/totalsSources.js): one filter for both, so
// the rows foot to the figure. A year's own total is byYear.orgByYear's, never here.
"use strict";
const { MONEY } = require("./money");
const { IS_CREDIT } = require("../../creditTypes");
const { PLEDGE_MADE } = require("./lapse");
const { PAID_OF } = require("./pledges");

const UNDATED = g => `(${g}.date IS NULL OR ${g}.date::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')`;
const MADE = PLEDGE_MADE.replace(/\bpp\./g, "p.");

// The rows behind each explanation, as figure sources (registered into
// figureSources.js by totalsSources.js). Each is the same filter as its figure.
const SQL = {
  refunds: (orgId, p) => ({
    sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount, 'Refund' AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND ${MONEY("g")} AND g.amount < 0 AND g.date >= ? AND g.date <= ?`,
    args: [orgId, p.from, p.to], order: "date DESC NULLS LAST, id" }),
  soft: (orgId, p) => ({
    sql: `SELECT sc.id, 'soft_credit' AS type, sc.donor_id, d.name, g.date, ROUND(sc.amount::numeric, 2) AS amount, 'Soft credit from another person''s gift' AS detail
            FROM gift_soft_credits sc JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
            JOIN donors d ON d.id = sc.donor_id AND d.org_id = sc.org_id AND d.deleted_at IS NULL
           WHERE sc.org_id = ? AND g.date >= ? AND g.date <= ?
          UNION ALL
          SELECT g.id, 'gift', g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2), 'Soft or matching credit'
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND ${IS_CREDIT("g")} AND g.date >= ? AND g.date <= ?`,
    args: [orgId, p.from, p.to, orgId, p.from, p.to], order: "date DESC NULLS LAST, id" }),
  pledges: (orgId, p) => ({
    sql: `SELECT p.id, 'pledge' AS type, p.donor_id, d.name, ${MADE} AS date,
                 ROUND(GREATEST(p.amount - ${PAID_OF("p")}, 0)::numeric, 2) AS amount, 'Pledged, not yet paid' AS detail
            FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id AND d.deleted_at IS NULL
           WHERE p.org_id = ? AND p.status = 'open' AND p.amount - ${PAID_OF("p")} > 0 AND ${MADE} >= ? AND ${MADE} <= ?`,
    args: [orgId, p.from, p.to], order: "date DESC NULLS LAST, id" }),
  undated: (orgId) => ({
    sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, NULL::text AS date, ROUND(g.amount::numeric, 2) AS amount, 'No date on the gift' AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND ${MONEY("g")} AND ${UNDATED("g")}`,
    args: [orgId], order: "amount DESC NULLS LAST, id" }),
};

async function sumOf(query, built) {
  const [r] = await query(`SELECT COALESCE(SUM(ROUND(x.amount * 100)), 0)::bigint AS cents, COUNT(*)::int AS n FROM (${built.sql}) x`, built.args);
  return { cents: Math.abs(Number(r && r.cents) || 0), n: Number(r && r.n) || 0 };
}

// ── ONBOARD-3 Part B · THE DAY-ONE LIST AND WHO GAVE AGAIN ────────────────
// The day-one list: every live person lapsed or lapsing today by lapse.js's one
// rule, with their money in the 12 months up to today, in cents.
function dayOneRowsSql(orgId, today) {
  const LAPSE = require("./lapse");
  const { EVERYONE } = require("./everyone");
  const st = LAPSE.stateSql(LAPSE.LAST_ON_RECORD("d"), today, "d.id");
  const from = require("../../orgTime").addDays(today, -365);
  return [`SELECT x.id, x.state, x.cents FROM (
      SELECT d.id, ${st.sql} AS state,
             (SELECT COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint FROM gifts g WHERE g.org_id = d.org_id AND g.donor_id = d.id
                AND ${MONEY("g")} AND g.date > ? AND g.date <= ?) AS cents
        FROM donors d WHERE d.org_id = ? AND ${EVERYONE("d")}) x
     WHERE x.state IN ('lapsed', 'lapsing')`, [...st.args, from, today, orgId]];
}
// Gave again since you started: a gift (money.GIFT: above $0, not refunded in
// full, not a credit) dated from the data-in day, from someone on the day-one
// list. `anyone` and `fromOverride` exist only for the planted defects.
function gaveAgainSql(orgId, p, { anyone = false, fromOverride = null } = {}) {
  const { GIFT } = require("./money");
  return {
    sql: `SELECT g.id, 'gift' AS type, g.donor_id, d.name, g.date, ROUND(g.amount::numeric, 2) AS amount, 'Gave again since you started' AS detail
            FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
           WHERE g.org_id = ? AND ${GIFT("g")} AND g.date >= ? AND g.date <= ?
             ${anyone ? "" : "AND EXISTS (SELECT 1 FROM onboard_snapshots s WHERE s.org_id = g.org_id AND s.donor_id = g.donor_id)"}`,
    args: [orgId, fromOverride || p.from, p.to], order: "date DESC, id" };
}
// Those rows by person: cents, gifts, the latest day.
async function byPerson(query, built) {
  return query(`SELECT x.donor_id, x.name, SUM(ROUND(x.amount * 100))::bigint AS cents, COUNT(*)::int AS gifts, MAX(x.date)::text AS last
      FROM (${built.sql}) x GROUP BY x.donor_id, x.name ORDER BY 3 DESC, 2`, built.args);
}

module.exports = { SQL, sumOf, UNDATED, dayOneRowsSql, gaveAgainSql, byPerson };
