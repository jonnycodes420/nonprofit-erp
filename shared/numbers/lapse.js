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
// POLISH-4 · A PERSON AND THEIR BUSINESS ARE ONE GIVING UNIT. Two people
// linked as Owner (owns, gives through) or Works at (donor_relationships) are
// held the way one person is: either one's gift or pledge keeps both off
// Lapsed, Lapsing and Re-engage. Each gift stays credited to whoever gave it;
// only the dates are read across the link.
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

// A person row's last gift as the lists read it: the summary's last gift, or
// the old system's when later. `d` is the donors row's alias.
const LAST_ON_RECORD = (d = "d") => `GREATEST(NULLIF(LEFT(${d}.last_gift_date, 10), ''), NULLIF(LEFT(${d}.imported_last_gift_date, 10), ''))`;
// POLISH-4 · RE-ENGAGE. Who the Re-engage list, its badge and its tiles name:
// lapsed by this file's rule and askable (not deceased, do-not-contact,
// do-not-solicit, or an imported sustainer, whose card stopped; BUILD-77).
// The stored stage is not read: an officer's Lapsed is their note, and a
// pledge or a gift in the giving unit still keeps the person off the list.
function reengageSql(d, today, unit = null) {
  const l = lapsedSql(LAST_ON_RECORD(d), today, `${d}.id`, unit);
  return { sql: `(${d}.deceased IS NOT TRUE AND ${d}.do_not_contact IS NOT TRUE AND ${d}.do_not_solicit IS NOT TRUE
      AND ${d}.imported_sustainer IS NOT TRUE AND COALESCE(${l.sql}, false))`, args: l.args };
}
// The relationship types that make one giving unit, and SQL for the people
// linked to `idExpr` by one of them (either side of the link).
// PEOPLE-1: and two people linked as spouse or partner: a gift from either keeps both off Lapsed.
const UNIT_LINK_TYPES = Object.freeze(["owner", "works_at", "spouse", "partner"]);
const LINKED = idExpr => `(SELECT CASE WHEN lr.donor_id_a = ${idExpr} THEN lr.donor_id_b ELSE lr.donor_id_a END
    FROM donor_relationships lr WHERE (lr.donor_id_a = ${idExpr} OR lr.donor_id_b = ${idExpr})
     AND lr.relationship_type IN ('owner','works_at','spouse','partner'))`;
// The latest last gift among the people linked to `idExpr` (NULL when none).
const linkedLastSql = idExpr => `(SELECT MAX(GREATEST(NULLIF(LEFT(lk.last_gift_date, 10), ''), NULLIF(LEFT(lk.imported_last_gift_date, 10), '')))
    FROM donors lk WHERE lk.id IN ${LINKED(idExpr)} AND lk.deleted_at IS NULL)`;
// The unit's last gift: the person's own, or a linked person's when later.
// Only for someone with a last gift of their own: a person who never gave (or
// whose gifts carry no date) has not "given before", whoever they are linked to.
// COUNTS-1: `unit` (from unitSetsSql below) hands in the linked people's last
// gift as a column already read for the whole org, instead of a read per person.
const unitLast = (lastExpr, idExpr, unit = null) => idExpr
  ? `(CASE WHEN (${lastExpr}) IS NULL THEN NULL ELSE GREATEST((${lastExpr})::date, (${unit ? unit.linkedLast : linkedLastSql(idExpr)})::date) END)` : `(${lastExpr})::date`;

// COUNTS-1 · LOST, AND LAPSED 12 TO 24 MONTHS. Re-engage's people split in
// two by the unit's last gift (lapseRule.LOST_MONTHS): Lost is a last gift
// before today less 24 months; the rest of Re-engage is Lapsed 12 to 24
// months. Re-engage's Lost & Found list, the "Lost: over 24 months" report and
// TRUTH-1's counts pass read lostSql; nothing else draws the line.
function lostSql(d, today) {
  const re = reengageSql(d, today);
  return { sql: `(${re.sql} AND ${unitLast(LAST_ON_RECORD(d), `${d}.id`)} < ?::date)`, args: [...re.args, bounds(today).lostBefore] };
}

// The person has an open pledge past due.
function overdueSql(idExpr, today) {
  return { sql: `EXISTS (SELECT 1 FROM pledges pp WHERE pp.donor_id = ${idExpr} AND pp.status = 'open' AND ${PLEDGE_OVERDUE})`, args: [day(today), day(today)] };
}
// A pledge holds the person off lapsing and lapsed: any open pledge (on
// schedule or overdue; overdue is its own state), or one fulfilled pledge made
// in the last 12 months.
// POLISH-4: a linked person's pledge holds them too (one giving unit).
function holdSql(idExpr, today) {
  return { sql: `EXISTS (SELECT 1 FROM pledges pp WHERE (pp.donor_id = ${idExpr} OR pp.donor_id IN ${LINKED(idExpr)})
      AND (pp.status = 'open' OR (pp.status = 'fulfilled' AND ${PLEDGE_MADE} >= ?)))`, args: [bounds(today).lapsingFrom] };
}
// STATUS-1 · THE STORED ANSWER TO "UNTIL WHEN ARE THEY ON TIME?". The one
// rhythm (shared/numbers/rhythm.js storedThrough) is stored twice, each time
// from the gifts: donor_rhythm.expected_next by the after-change step (every
// change to a person) and donor_scores.on_time_through by the scores (nightly,
// and after every gift or touch). NULL: no pattern stored.
// LOAD-1: both tables are keyed (org_id, donor_id), so the lookup names the
// org too, or no index serves it and every row of each is read per person.
// The org is the id's own row's: `d.id` and `a.donor_id` read `d.org_id` and `a.org_id`.
const orgOf = (idExpr) => {
  const m = /^(.*?)(?:donor_)?id$/.exec(String(idExpr));
  if (!m) throw new Error(`lapse.ON_TIME_THROUGH: no org column beside ${idExpr}`);
  return `${m[1]}org_id`;
};
// MONEY-3 · ONE ROW. The rhythm row is the answer; the scores row only for
// someone who has none yet. "The newer of the two" read whichever was
// written last, and a scores pass that read the gifts before one arrived
// could be the newer: Pia January read Lapsing and On track at once
// (surfaces-agree, about 1 run in 5). Both store rhythm.js storedThrough; the
// rhythm row is rewritten by the after-change step after every change to the
// person, so it is the answer for their gifts as they stand.
const ON_TIME_THROUGH = (idExpr, orgExpr = orgOf(idExpr)) => `(SELECT x.d FROM (
      SELECT LEFT(rr.expected_next::text, 10) AS d, 0 AS k FROM donor_rhythm rr WHERE rr.org_id = ${orgExpr} AND rr.donor_id = ${idExpr}
      UNION ALL SELECT ds.on_time_through, 1 FROM donor_scores ds WHERE ds.org_id = ${orgExpr} AND ds.donor_id = ${idExpr}) x
    ORDER BY x.k LIMIT 1)`;
// Their usual time to give is still ahead: that day is today or later.
// STATUS-1: any rhythm, not only yearly and year-end (lapseRule.usualTimeAhead).
function rhythmAheadSql(idExpr, today) {
  return { sql: `COALESCE(${ON_TIME_THROUGH(idExpr)} >= ?, false)`, args: [day(today)] };
}

// The three states as conditions. Without `idExpr` there is no person to hold
// (a gap between two gifts, a stored date with no pledge to read): the bounds alone.
// COUNTS-1: `unit` = { linkedLast, held }, two columns of unitSetsSql's rows
// joined beside the person, so a whole-org count reads each once (set-wise)
// with the same rule; without it, each person's are read where they stand.
const holdOf = (idExpr, today, unit) => (unit ? { sql: `COALESCE(${unit.held}, false)`, args: [] } : holdSql(idExpr, today));
function lapsedSql(lastExpr, today, idExpr = null, unit = null) {
  const d = unitLast(lastExpr, idExpr, unit), b = bounds(today);
  if (!idExpr) return { sql: `${d} <= ?::date`, args: [b.lapsedOnOrBefore] };
  const p = holdOf(idExpr, today, unit);
  return { sql: `(${d} <= ?::date AND NOT ${p.sql})`, args: [b.lapsedOnOrBefore, ...p.args] };
}
function lapsingSql(lastExpr, today, idExpr = null, unit = null) {
  const d = unitLast(lastExpr, idExpr, unit), b = bounds(today);
  if (!idExpr) return { sql: `${d} BETWEEN ?::date AND ?::date`, args: [b.lapsingFrom, b.lapsingOnOrBefore] };
  const r = rhythmAheadSql(idExpr, today), p = holdOf(idExpr, today, unit);
  return { sql: `(${d} BETWEEN ?::date AND ?::date AND NOT ${r.sql} AND NOT ${p.sql})`, args: [b.lapsingFrom, b.lapsingOnOrBefore, ...r.args, ...p.args] };
}
// No gift in the last 12 months, and a pledge holds them (they read Current,
// and are told why).
function pledgeHeldSql(lastExpr, today, idExpr) {
  const d = unitLast(lastExpr, idExpr), p = holdSql(idExpr, today);
  return { sql: `(${d} <= ?::date AND ${p.sql})`, args: [bounds(today).lapsedOnOrBefore, ...p.args] };
}

// The one fragment: 'pledge_overdue', 'lapsed', 'lapsing', 'giving', or NULL
// for someone who has never given; lapseRule.lapseState in SQL, case for case.
function stateSql(lastExpr, today, idExpr) {
  const o = overdueSql(idExpr, today), h = holdSql(idExpr, today), b = bounds(today), r = rhythmAheadSql(idExpr, today);
  const d = unitLast(lastExpr, idExpr);
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

// COUNTS-1 · THE GIVING UNIT, FOR A WHOLE ORG AT ONCE. linkedLastSql and
// holdSql above, read set-wise: one row per person of the org who has a
// linked person (POLISH-4's LINKED: the same link types, either side) or a
// pledge that holds (holdSql's: open, or fulfilled and made in the last 12
// months), with
//   linked_last  the latest last gift among their live linked people (NULL: none)
//   held         a pledge holds them: their own, or a linked person's (deleted
//                or not, as holdSql's LINKED reads it)
// A person with no row has neither, which is what the per-person reads say
// for them. Pass { linkedLast: "<alias>.linked_last", held: "<alias>.held" }
// as `unit` to lapsedSql, lapsingSql or reengageSql, with this LEFT JOINed on
// the person's id. tests/lib/counts1Perf.js holds it to the per-person form.
function unitSetsSql(orgId, today) {
  const sql = `
    SELECT u.me AS donor_id, MAX(u.linked_last) AS linked_last, BOOL_OR(u.held) AS held FROM (
      SELECT lr.me, GREATEST(NULLIF(LEFT(lk.last_gift_date, 10), ''), NULLIF(LEFT(lk.imported_last_gift_date, 10), ''))::date AS linked_last,
             (lr.other IN (SELECT hp.donor_id FROM hp)) AS held
        FROM (SELECT r.donor_id_a AS me, r.donor_id_b AS other FROM donor_relationships r
               WHERE r.org_id = ? AND r.relationship_type IN ('owner','works_at','spouse','partner')
              UNION ALL
              SELECT r.donor_id_b, r.donor_id_a FROM donor_relationships r
               WHERE r.org_id = ? AND r.relationship_type IN ('owner','works_at','spouse','partner')) lr
        -- linkedLastSql reads live linked people only; holdSql's LINKED reads every link.
        LEFT JOIN donors lk ON lk.id = lr.other AND lk.deleted_at IS NULL
      UNION ALL
      SELECT hp.donor_id, NULL::date, true FROM hp) u
    GROUP BY u.me`;
  // hp: the people a pledge of their own holds (holdSql's pledge condition).
  const hp = `SELECT DISTINCT pp.donor_id FROM pledges pp WHERE pp.org_id = ?
      AND (pp.status = 'open' OR (pp.status = 'fulfilled' AND ${PLEDGE_MADE} >= ?))`;
  return { with: `hp AS MATERIALIZED (${hp}), unit AS MATERIALIZED (${sql})`, args: [orgId, bounds(today).lapsingFrom, orgId, orgId] };
}

// One person's pledges as lapseRule.pledgeHold reads them, from the database;
// or, with no donorId, a Map of every person's in the org.
// POLISH-4: one person's are their giving unit's (their own and their linked
// people's, holdSql's rule); a linked person's overdue pledge is not theirs.
async function pledgesFor(query, orgId, donorId, today) {
  const t = day(today);
  const ids = donorId ? [donorId, ...(await query(`SELECT x.id FROM (SELECT ?::text AS me) m, LATERAL ${LINKED("m.me")} AS x(id)`, [donorId])).map(r => r.id)] : null;
  const rows = await query(`SELECT pp.donor_id, pp.status, ${PLEDGE_MADE} AS "madeOn", ${PLEDGE_OVERDUE} AS overdue
                  FROM pledges pp WHERE pp.org_id = ?${donorId ? " AND pp.donor_id = ANY(?::text[])" : ""} AND pp.status IN ('open','fulfilled')`,
    [t, t, orgId, ...(donorId ? [ids] : [])]);
  if (donorId) for (const r of rows) if (r.donor_id !== donorId) r.overdue = false;
  if (donorId) return rows;
  const by = new Map();
  for (const r of rows) (by.get(r.donor_id) || by.set(r.donor_id, []).get(r.donor_id)).push(r);
  return by;
}

module.exports = { ON_TIME_THROUGH, LAST_ON_RECORD, reengageSql, lostSql, UNIT_LINK_TYPES, LINKED, linkedLastSql, PLEDGE_MADE, overdueSql, holdSql, rhythmAheadSql, lapsedSql, lapsingSql, pledgeHeldSql, stateSql, sql, pledgesFor, unitSetsSql };
