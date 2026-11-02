// shared/numbers/lapse.js · NUMBERS-4. LAPSED, LAPSING AND PLEDGE-HELD, IN SQL, ONCE.
//
// The rule is lapseRule.js's (FIX-49 decision 6, FIX-60, INSIGHTS-1):
//   Lapsed          no gift in the last 12 months, after giving before, and no
//                   pledge holding them (an open pledge, or a fulfilled one made
//                   in the last 12 months: a pledge is giving activity).
//   Lapsing         their last gift was 9 to 12 months ago, their usual time to
//                   give has passed (a yearly or year-end rhythm whose next gift
//                   is still ahead is not lapsing), and no pledge holds them.
//   Pledge-held     no gift in the last 12 months, but a pledge holds them.
//   Pledge overdue  an open pledge with an installment past due and unpaid
//                   (or, unscheduled, past its own due date): its own state.
// lapseRule.js keeps the pure rule (the bounds, lapseState) because the
// browser bundles it (Lost & Found, the Directory); every SQL door reads this
// file: the tags (donorStatus.statusSql, and so the Donors filters, groups and
// counts), the stage sweep, imports' suggested stage, at-risk, journeys, the
// sequences, Home and the re-engage lists. TRUTH-1's key (tests/lib/
// surfacesAgree.js) and scripts/ci/check-numbers.js check it from the gifts.
//
// Every builder takes the person's last gift as a civil-date expression
// (YYYY-MM-DD text or a DATE), their id expression, and the org's today, and
// returns { sql, args } with `?` placeholders in the order the text reads them.
"use strict";
const { bounds } = require("../../lapseRule");

// A pledge is "made" on the earliest of the day it was recorded, its due date
// and its first installment's due date, so an old system's pledge imported
// today is not a fresh one. `pp` is the pledge row.
const PLEDGE_MADE = `LEAST(to_char(pp.created_at, 'YYYY-MM-DD'), NULLIF(LEFT(pp.due_date, 10), ''),
  (SELECT MIN(NULLIF(LEFT(pi.due_date, 10), '')) FROM pledge_installments pi WHERE pi.pledge_id = pp.id AND pi.org_id = pp.org_id))`;
const PLEDGE_OVERDUE = `(EXISTS (SELECT 1 FROM pledge_installments pi WHERE pi.pledge_id = pp.id AND pi.org_id = pp.org_id
    AND pi.paid_gift_id IS NULL AND NULLIF(LEFT(pi.due_date, 10), '') < ?)
  OR (NOT EXISTS (SELECT 1 FROM pledge_installments pi WHERE pi.pledge_id = pp.id AND pi.org_id = pp.org_id)
    AND NULLIF(LEFT(pp.due_date, 10), '') < ?))`;
const day = today => String(today).slice(0, 10);

// The person has an open pledge past due.
function overdueSql(idExpr, today) {
  return { sql: `EXISTS (SELECT 1 FROM pledges pp WHERE pp.donor_id = ${idExpr} AND pp.status = 'open' AND ${PLEDGE_OVERDUE})`, args: [day(today), day(today)] };
}
// A pledge holds the person off lapsing and lapsed: any open pledge (on
// schedule or overdue; overdue is its own state), or one fulfilled pledge made
// in the last 12 months.
function holdSql(idExpr, today) {
  return { sql: `EXISTS (SELECT 1 FROM pledges pp WHERE pp.donor_id = ${idExpr}
      AND (pp.status = 'open' OR (pp.status = 'fulfilled' AND ${PLEDGE_MADE} >= ?)))`, args: [bounds(today).lapsingFrom] };
}
// Their usual time to give is still ahead (a yearly or year-end rhythm).
function rhythmAheadSql(idExpr, today) {
  return { sql: `EXISTS (SELECT 1 FROM donor_rhythm rr WHERE rr.donor_id = ${idExpr} AND rr.rhythm IN ('yearly','year_end')
                  AND rr.expected_next IS NOT NULL AND LEFT(rr.expected_next::text, 10) >= ?)`, args: [day(today)] };
}

// The three states as conditions. Without `idExpr` there is no person to hold
// (a gap between two gifts, a stored date with no pledge to read): the bounds alone.
function lapsedSql(lastExpr, today, idExpr = null) {
  const d = `(${lastExpr})::date`, b = bounds(today);
  if (!idExpr) return { sql: `${d} <= ?::date`, args: [b.lapsedOnOrBefore] };
  const p = holdSql(idExpr, today);
  return { sql: `(${d} <= ?::date AND NOT ${p.sql})`, args: [b.lapsedOnOrBefore, ...p.args] };
}
function lapsingSql(lastExpr, today, idExpr = null) {
  const d = `(${lastExpr})::date`, b = bounds(today);
  if (!idExpr) return { sql: `${d} BETWEEN ?::date AND ?::date`, args: [b.lapsingFrom, b.lapsingOnOrBefore] };
  const r = rhythmAheadSql(idExpr, today), p = holdSql(idExpr, today);
  return { sql: `(${d} BETWEEN ?::date AND ?::date AND NOT ${r.sql} AND NOT ${p.sql})`, args: [b.lapsingFrom, b.lapsingOnOrBefore, ...r.args, ...p.args] };
}
// No gift in the last 12 months, and a pledge holds them (they read Current,
// and are told why).
function pledgeHeldSql(lastExpr, today, idExpr) {
  const d = `(${lastExpr})::date`, p = holdSql(idExpr, today);
  return { sql: `(${d} <= ?::date AND ${p.sql})`, args: [bounds(today).lapsedOnOrBefore, ...p.args] };
}

// The one fragment: 'pledge_overdue', 'lapsed', 'lapsing', 'giving', or NULL
// for someone who has never given; lapseRule.lapseState in SQL, case for case.
function stateSql(lastExpr, today, idExpr) {
  const o = overdueSql(idExpr, today), h = holdSql(idExpr, today), b = bounds(today), r = rhythmAheadSql(idExpr, today);
  const d = `(${lastExpr})::date`;
  return {
    sql: `(CASE WHEN ${o.sql} THEN 'pledge_overdue' WHEN ${h.sql} THEN 'giving' WHEN (${lastExpr}) IS NULL THEN NULL
                WHEN ${d} <= ?::date THEN 'lapsed' WHEN ${d} <= ?::date AND NOT ${r.sql} THEN 'lapsing' ELSE 'giving' END)`,
    args: [...o.args, ...h.args, b.lapsedOnOrBefore, b.lapsingOnOrBefore, ...r.args],
  };
}

// The old lapseRule.sql shape: one state as a condition.
function sql(state, lastExpr, today, idExpr = null) {
  if (state === "pledge_overdue") {
    if (!idExpr) throw new Error("lapse.sql: pledge_overdue needs the person's id");
    return overdueSql(idExpr, today);
  }
  if (state === "lapsed") return lapsedSql(lastExpr, today, idExpr);
  if (state === "lapsing") return lapsingSql(lastExpr, today, idExpr);
  throw new Error(`lapse.sql: unknown state ${state}`);
}

// One person's pledges as lapseRule.pledgeHold reads them, from the database;
// or, with no donorId, a Map of every person's in the org.
async function pledgesFor(query, orgId, donorId, today) {
  const t = day(today);
  const rows = await query(`SELECT pp.donor_id, pp.status, ${PLEDGE_MADE} AS "madeOn", ${PLEDGE_OVERDUE} AS overdue
                  FROM pledges pp WHERE pp.org_id = ?${donorId ? " AND pp.donor_id = ?" : ""} AND pp.status IN ('open','fulfilled')`,
    [t, t, orgId, ...(donorId ? [donorId] : [])]);
  if (donorId) return rows;
  const by = new Map();
  for (const r of rows) (by.get(r.donor_id) || by.set(r.donor_id, []).get(r.donor_id)).push(r);
  return by;
}

module.exports = { PLEDGE_MADE, overdueSql, holdSql, rhythmAheadSql, lapsedSql, lapsingSql, pledgeHeldSql, stateSql, sql, pledgesFor };
