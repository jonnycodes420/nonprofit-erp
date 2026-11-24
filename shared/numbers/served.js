// shared/numbers/served.js · VOL-3 item 4. HOURS COUNT ONLY ONCE THEY HAVE BEEN SERVED.
//
// Jarvis, Nov 22: "future-dated hours count in YTD totals and Last served". A shift logged for
// tomorrow is a plan, not hours given, and it was adding to "hours given so far this year", the
// list's lifetime hours and "Last served". One rule now, for every volunteer hours read: a
// volunteer_shifts row counts when its date is on or before the org's today.
//
//   SERVED(alias, today)   SQL: `<alias>.date <= '<today>'`. `today` is the org's civil day
//                          (orgToday); anything else throws rather than being spliced.
//   servedTo(to, today)    the end of a date range, held at today: a range that runs into the
//                          future counts up to today.
//   SERVED_LIVE(alias, orgIdSql)
//                          the same rule where no JS today is to hand (a report column, a
//                          figure source's row SQL): the org's today worked out in SQL from
//                          the org id column, orgTime's own fragment (RULES-1).
//
// RULES-1: scripts/ci/served-scan.js fails CI on a SUM over volunteer_shifts.hours that
// goes through neither (or is not allowlisted there with its reason).
"use strict";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function civil(today) {
  const t = String(today || "").slice(0, 10);
  if (!DAY.test(t)) throw new Error("served: today must be the org's civil day (YYYY-MM-DD)");
  return t;
}

const SERVED = (alias, today) => `${alias ? alias + "." : ""}date <= '${civil(today)}'`;

function servedTo(to, today) {
  const t = civil(today);
  const e = String(to || "").slice(0, 10);
  return DAY.test(e) && e < t ? e : t;
}

function SERVED_LIVE(alias, orgIdSql) {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(String(orgIdSql || ""))) throw new Error("served: orgIdSql must be a column");
  const orgTime = require("../../orgTime");
  return `${alias ? alias + "." : ""}date <= (${orgTime.orgTodaySql(orgTime.orgTzSql(orgIdSql))})::text`;
}

const SERVED_SENTENCE = "Hours count once their day has come: a shift dated after today is not counted yet.";

module.exports = { SERVED, SERVED_LIVE, servedTo, SERVED_SENTENCE };
