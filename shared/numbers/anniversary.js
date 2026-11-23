// shared/numbers/anniversary.js · DEFINE-1 item 5. A GIVING ANNIVERSARY IS A CIVIL DATE.
//
// Jarvis (22 Nov): "anniversaries ... systematically off". The milestone sweep
// (server/boot/helpers-5.js) compared only the day of the month: "within three
// days, or 27 or more apart" (meant for a month's wrap), in the same month. A
// first gift on Mar 1 read as its anniversary on Mar 28 to 31 too (28 days
// apart counted as "near"), and every anniversary could fire up to three days
// BEFORE its date, so the draft said "marks their 3-year anniversary" early.
//
// THE RULE. The anniversary is the first gift's month and day in a later year
// (Feb 29 falls on Mar 1 in a common year); the 6-month mark is the same day
// six months on (a day the month lacks falls on its last day). It is due ON
// that civil day in the org's zone, or up to GRACE_DAYS after it (the sweep
// runs daily and may miss a day), never before. Pure: dates in, dates out.
"use strict";

const GRACE_DAYS = 3;
const pad = n => String(n).padStart(2, "0");
const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const toDays = c => Math.floor(Date.UTC(c.y, c.m - 1, c.d) / 86400000);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// The first gift's anniversary in year `y`, as { y, m, d }.
function yearly(first, y) {
  if (first.m === 2 && first.d === 29 && !isLeap(y)) return { y, m: 3, d: 1 };
  return { y, m: first.m, d: first.d };
}
// The day six months after the first gift.
function sixMonths(first) {
  const mm = first.m + 6, y = first.y + (mm > 12 ? 1 : 0), m = mm > 12 ? mm - 12 : mm;
  return { y, m, d: Math.min(first.d, lastDay(y, m)) };
}
const civil = c => `${c.y}-${pad(c.m)}-${pad(c.d)}`;

// The anniversary that is due today, or null:
//   { key: "anniversary_6mo" | "anniversary_year_N", label: "6-month" | "N-year", on: "YYYY-MM-DD", years }
function anniversaryDue(firstGift, today, grace = GRACE_DAYS) {
  const f = parse(firstGift), t = parse(today);
  if (!f || !t) return null;
  const T = toDays(t);
  const within = c => { const n = T - toDays(c); return n >= 0 && n <= grace; };
  const six = sixMonths(f);
  if (within(six)) return { key: "anniversary_6mo", label: "6-month", on: civil(six), years: 0 };
  // This year's date, or last year's when today is just past New Year.
  for (const y of [t.y, t.y - 1]) {
    const years = y - f.y;
    if (years < 1) continue;
    const a = yearly(f, y);
    if (within(a)) return { key: `anniversary_year_${years}`, label: `${years}-year`, on: civil(a), years };
  }
  return null;
}

module.exports = { anniversaryDue, GRACE_DAYS };
