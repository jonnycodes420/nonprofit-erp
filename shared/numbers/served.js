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

const SERVED_SENTENCE = "Hours count once their day has come: a shift dated after today is not counted yet.";

module.exports = { SERVED, servedTo, SERVED_SENTENCE };
