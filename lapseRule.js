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
// COUNTS-1: Lapsed has two windows that every screen names. Lapsed 12 to 24
// months (Re-engage's first list) and Lost, over 24 months (Lost & Found and the
// "Lost: over 24 months" report): a last gift before today less 24 months.
const LOST_MONTHS = 24;

const WORDS = Object.freeze({
  lapsed: "Lapsed: they have given before, but not in the last 12 months.",
  lapsing: "Lapsing: their last gift was 9 to 12 months ago, and their usual time to give has passed.",
  lapsedRecent: "Lapsed: no gift in 12 to 24 months, after giving before.",
  lost: "Lost: no gift in over 24 months, after giving before.",
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
    lostBefore: shiftMonths(t, LOST_MONTHS),   // COUNTS-1: a last gift before this day is Lost
  };
}

// INSIGHTS-1 (Jonathan, 27 Oct): lapsing respects rhythm, the way Drift
// does. A person whose expected next gift has not come yet is not lapsing:
// their usual time is still ahead. Lapsed (a whole year with no gift) is
// unchanged. STATUS-1: the expected date is the one rhythm's
// (shared/numbers/rhythm.js), stored by afterChange.js as
// donor_rhythm.expected_next or passed as its answer ({ expectedNext }), so
// "not lapsing" here and "on time" in the profile's sentence are one test. It
// was yearly and year-end rhythms only, so a person whose usual time was still
// ahead could read Lapsing beside a sentence that said they were on time.
const usualTimeAhead = (rhythm, today) => {
  const exp = rhythm && (rhythm.expectedNext || rhythm.expected_next);
  return !!exp && String(exp).slice(0, 10) >= String(today).slice(0, 10);
};

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
// NUMBERS-4: the same rule in SQL (the pledge hold and overdue, the rhythm
// exception, lapsed, lapsing and pledge-held) is shared/numbers/lapse.js, once.
// This file stays pure (no SQL a browser does not need): Lost & Found and the
// Directory bundle it.

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
const isLapsed = (last, today) => lapseState(last, today) === "lapsed";
const isLapsing = (last, today) => lapseState(last, today) === "lapsing";


module.exports = { LAPSED_DAYS, LAPSING_MONTHS, LOST_MONTHS, WORDS, shiftMonths, bounds, lapseState, usualTimeAhead,
  pledgeHold, isLapsed, isLapsing };
