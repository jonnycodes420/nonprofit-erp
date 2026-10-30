// lapseRule.js · FIX-49 decision 6 (Jonathan, 25 Oct). ONE LAPSE RULE.
//
//   Lapsed   no gift in the last 12 months, after giving before.
//   Lapsing  their last gift was 9 to 12 months ago.
//
// "The last 12 months" is the same window as the giving-level and lifecycle
// tags (donorStatus.js): today and the 364 days before it. So a person whose
// last gift was 365 or more days ago is lapsed, and one whose last gift falls
// between that window's first day and the day nine calendar months ago is
// lapsing. Every door reads this file: the profile tag, the stage sweep,
// Drift, at-risk, the Directory and its counts, groups, journey triggers and
// Lost & Found (which bundles it into the browser, so it is pure: no clock,
// no database; the caller passes the ORG's today).
"use strict";

const orgTime = require("./orgTime");

const LAPSED_DAYS = 365;       // last gift on or before today - 365: lapsed
const LAPSING_MONTHS = 9;      // last gift on or before today - 9 months: lapsing

const WORDS = Object.freeze({
  lapsed: "Lapsed: they have given before, but not in the last 12 months.",
  lapsing: "Lapsing: their last gift was 9 to 12 months ago, and their usual time to give has passed.",
  pledge_overdue: "Pledge payment overdue: they have an open pledge with an installment past its due date and not yet paid.",
});

// The same day N calendar months earlier (or later, for a negative n), the
// last day of the month when that month is shorter (May 31 less 3 is Feb 28).
function shiftMonths(dateStr, n) {
  const c = orgTime.parseCivil(String(dateStr || "").slice(0, 10));
  if (!c) return null;
  const idx = c.y * 12 + (c.m - 1) - n;
  const y = Math.floor(idx / 12), m = idx - y * 12 + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(c.d, last)).padStart(2, "0")}`;
}

// The civil dates the rule turns on, for SQL:
//   last gift <= lapsedOnOrBefore                     lapsed
//   lapsingFrom <= last gift <= lapsingOnOrBefore     lapsing
function bounds(today) {
  const t = String(today).slice(0, 10);
  return {
    today: t,
    lapsedOnOrBefore: orgTime.addDays(t, -LAPSED_DAYS),
    lapsingFrom: orgTime.addDays(t, -(LAPSED_DAYS - 1)),
    lapsingOnOrBefore: shiftMonths(t, LAPSING_MONTHS),
  };
}

// INSIGHTS-1 (Jonathan, 27 Oct): lapsing respects rhythm, the way Drift
// does. A person whose rhythm (donor_rhythm, afterChange.js) is yearly or
// year-end and whose expected next gift has not come yet is not lapsing:
// their usual time is still ahead. Lapsed (a whole year with no gift) is
// unchanged.
const YEARLY = ["yearly", "year_end"];
const usualTimeAhead = (rhythm, today) => !!(rhythm && YEARLY.includes(rhythm.rhythm) && rhythm.expected_next
  && String(rhythm.expected_next).slice(0, 10) >= String(today).slice(0, 10));

// FIX-60 · A FRESH PLEDGE IS ACTIVITY. Somebody who pledged $15,000 at the
// dinner twelve days ago read Lapsed: the rule read gifts only. Now:
//   a pledge made in the last 12 months (open or fulfilled) is giving activity,
//   an open pledge on schedule (no installment past due and unpaid) is never
//     lapsing or lapsed, however long ago it was made,
//   an open pledge with an installment past due and unpaid is its own state,
//     "pledge_overdue" (Pledge payment overdue), never lapsing or lapsed.
// A pledge is "made" on the earliest of the day it was recorded, its due date
// and its first installment's due date, so an old system's pledge imported
// today is not a fresh one. `pledges` is [{ status, madeOn, overdue }] for one
// person; pledgeHold folds it to "overdue", "hold" or null.
function pledgeHold(pledges, today) {
  if (!Array.isArray(pledges) || !pledges.length) return null;
  const from = bounds(today).lapsingFrom;
  const open = pledges.filter(p => p && p.status === "open");
  if (open.some(p => p.overdue)) return "overdue";
  if (open.length) return "hold";
  if (pledges.some(p => p && p.status === "fulfilled" && p.madeOn && String(p.madeOn).slice(0, 10) >= from)) return "hold";
  return null;
}
// The same, in SQL, for a person whose id is `idExpr`. `made` is the pledge's
// made-on day as YYYY-MM-DD text (LEAST skips NULLs).
const PLEDGE_MADE = `LEAST(to_char(pp.created_at, 'YYYY-MM-DD'), NULLIF(LEFT(pp.due_date, 10), ''),
  (SELECT MIN(NULLIF(LEFT(pi.due_date, 10), '')) FROM pledge_installments pi WHERE pi.pledge_id = pp.id AND pi.org_id = pp.org_id))`;
const PLEDGE_OVERDUE = `(EXISTS (SELECT 1 FROM pledge_installments pi WHERE pi.pledge_id = pp.id AND pi.org_id = pp.org_id
    AND pi.paid_gift_id IS NULL AND NULLIF(LEFT(pi.due_date, 10), '') < ?)
  OR (NOT EXISTS (SELECT 1 FROM pledge_installments pi WHERE pi.pledge_id = pp.id AND pi.org_id = pp.org_id)
    AND NULLIF(LEFT(pp.due_date, 10), '') < ?))`;
function pledgeOverdueSql(idExpr, today) {
  const t = String(today).slice(0, 10);
  return { sql: `EXISTS (SELECT 1 FROM pledges pp WHERE pp.donor_id = ${idExpr} AND pp.status = 'open' AND ${PLEDGE_OVERDUE})`, args: [t, t] };
}
// Held off lapsing and lapsed by a pledge: any open pledge (on schedule or
// overdue: overdue is its own state, not lapsing), or one fulfilled pledge
// made in the last 12 months.
function pledgeHoldSql(idExpr, today) {
  return { sql: `EXISTS (SELECT 1 FROM pledges pp WHERE pp.donor_id = ${idExpr}
      AND (pp.status = 'open' OR (pp.status = 'fulfilled' AND ${PLEDGE_MADE} >= ?)))`, args: [bounds(today).lapsingFrom] };
}
// One person's pledges as pledgeHold reads them, from the database; or, with
// no donorId, a Map of every person's in the org.
async function pledgesFor(query, orgId, donorId, today) {
  const t = String(today).slice(0, 10);
  const rows = await query(`SELECT pp.donor_id, pp.status, ${PLEDGE_MADE} AS "madeOn", ${PLEDGE_OVERDUE} AS overdue
                  FROM pledges pp WHERE pp.org_id = ?${donorId ? " AND pp.donor_id = ?" : ""} AND pp.status IN ('open','fulfilled')`,
    [t, t, orgId, ...(donorId ? [donorId] : [])]);
  if (donorId) return rows;
  const by = new Map();
  for (const r of rows) (by.get(r.donor_id) || by.set(r.donor_id, []).get(r.donor_id)).push(r);
  return by;
}

// "lapsed", "lapsing", "giving" (gave in the last 9 months), "pledge_overdue",
// or null when they have never given. `lastGiftDate` is their latest gift
// above zero; `rhythm` ({ rhythm, expected_next }) and `pledges` (see
// pledgeHold) are optional.
function lapseState(lastGiftDate, today, rhythm = null, pledges = null) {
  const last = lastGiftDate ? String(lastGiftDate).slice(0, 10) : "";
  const hold = pledgeHold(pledges, today);
  if (hold === "overdue") return "pledge_overdue";
  if (hold === "hold") return "giving";
  if (!orgTime.parseCivil(last)) return null;
  const b = bounds(today);
  if (last <= b.lapsedOnOrBefore) return "lapsed";
  if (last <= b.lapsingOnOrBefore) return usualTimeAhead(rhythm, today) ? "giving" : "lapsing";
  return "giving";
}
// The same exception in SQL, for a person whose id is `idExpr`.
function rhythmAheadSql(idExpr, today) {
  return { sql: `EXISTS (SELECT 1 FROM donor_rhythm rr WHERE rr.donor_id = ${idExpr} AND rr.rhythm IN ('yearly','year_end')
                  AND rr.expected_next IS NOT NULL AND LEFT(rr.expected_next::text, 10) >= ?)`, args: [String(today).slice(0, 10)] };
}
const isLapsed = (last, today) => lapseState(last, today) === "lapsed";
const isLapsing = (last, today) => lapseState(last, today) === "lapsing";

// The day a person with this last gift became lapsed, and lapsing. A journey
// fires once per lapse (the episode is the last gift date), and only when that
// day fell while the person was live in Steward.
const lapsedOn = last => orgTime.addDays(String(last).slice(0, 10), LAPSED_DAYS);
const lapsingOn = last => shiftMonths(String(last).slice(0, 10), -LAPSING_MONTHS);

// SQL over a civil-date expression (a column holding YYYY-MM-DD or a DATE).
// Placeholders are `?`; the args to pass are returned beside the text.
// `idExpr` (the person's id) brings in the rhythm exception for lapsing.
// FIX-60: with `idExpr`, a pledge holds the person off both (pledgeHoldSql),
// and "pledge_overdue" is the person with an open pledge past due.
function sql(state, lastExpr, today, idExpr = null) {
  const b = bounds(today);
  const d = `(${lastExpr})::date`;
  if (state === "pledge_overdue") {
    if (!idExpr) throw new Error("lapseRule.sql: pledge_overdue needs the person's id");
    return pledgeOverdueSql(idExpr, today);
  }
  const p = idExpr ? pledgeHoldSql(idExpr, today) : null;
  if (state === "lapsed") {
    if (!p) return { sql: `${d} <= ?::date`, args: [b.lapsedOnOrBefore] };
    return { sql: `(${d} <= ?::date AND NOT ${p.sql})`, args: [b.lapsedOnOrBefore, ...p.args] };
  }
  if (state === "lapsing") {
    if (!idExpr) return { sql: `${d} BETWEEN ?::date AND ?::date`, args: [b.lapsingFrom, b.lapsingOnOrBefore] };
    const r = rhythmAheadSql(idExpr, today);
    return { sql: `(${d} BETWEEN ?::date AND ?::date AND NOT ${r.sql} AND NOT ${p.sql})`, args: [b.lapsingFrom, b.lapsingOnOrBefore, ...r.args, ...p.args] };
  }
  throw new Error(`lapseRule.sql: unknown state ${state}`);
}

module.exports = { LAPSED_DAYS, LAPSING_MONTHS, WORDS, shiftMonths, bounds, lapseState, usualTimeAhead, rhythmAheadSql,
  pledgeHold, pledgeHoldSql, pledgeOverdueSql, pledgesFor, isLapsed, isLapsing, lapsedOn, lapsingOn, sql };
