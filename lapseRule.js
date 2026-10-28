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

// "lapsed", "lapsing", "giving" (gave in the last 9 months), or null when
// they have never given. `lastGiftDate` is their latest gift above zero;
// `rhythm` ({ rhythm, expected_next }) is optional.
function lapseState(lastGiftDate, today, rhythm = null) {
  const last = lastGiftDate ? String(lastGiftDate).slice(0, 10) : "";
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
function sql(state, lastExpr, today, idExpr = null) {
  const b = bounds(today);
  const d = `(${lastExpr})::date`;
  if (state === "lapsed") return { sql: `${d} <= ?::date`, args: [b.lapsedOnOrBefore] };
  if (state === "lapsing") {
    if (!idExpr) return { sql: `${d} BETWEEN ?::date AND ?::date`, args: [b.lapsingFrom, b.lapsingOnOrBefore] };
    const r = rhythmAheadSql(idExpr, today);
    return { sql: `(${d} BETWEEN ?::date AND ?::date AND NOT ${r.sql})`, args: [b.lapsingFrom, b.lapsingOnOrBefore, ...r.args] };
  }
  throw new Error(`lapseRule.sql: unknown state ${state}`);
}

module.exports = { LAPSED_DAYS, LAPSING_MONTHS, WORDS, shiftMonths, bounds, lapseState, usualTimeAhead, rhythmAheadSql, isLapsed, isLapsing, lapsedOn, lapsingOn, sql };
