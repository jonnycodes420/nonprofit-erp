// shared/numbers/rhythm.js · STATUS-1. ONE ANSWER TO "ARE THEY ON TIME?"
//
// Seen on prod (3 Nov): a once-a-year donor whose expected gift was six weeks
// past read "On track: gives about once a year, latest gift on time" beside a
// Lapsing tag. Three files each worked out when a person's next gift was due
// (lapse's usualTimeAhead from a stored rhythm, drift's cadence, the stored
// donor_scores.pattern written days earlier) and the profile showed two of
// them side by side. Now this file is the one place that answers, for a
// person, from their dated gifts and the org's today:
//
//   cadenceDays   their usual gap (the median between giving days), or the
//                 year for a seasonal giver; null with fewer than two giving days
//   expectedNext  the day their next gift is due: the last giving day plus the
//                 usual gap, or, for a seasonal giver, the last day of their
//                 month (or quarter) in the year after their last gift (the
//                 year-end rule: a December giver is not late in October).
//                 FIX-33: a person whose usual year is two or more gifts and
//                 who has given that many in a year is due when that year runs
//                 out, if that is later.
//   late          today is after expectedNext; daysPast says by how much
//   onTime        not late and not lapsed (lapseRule.js: a whole year with no gift)
//
// Every door reads this: drift.js (its expected date and overdue test),
// lapseRule.usualTimeAhead (lapsing respects rhythm), the closeness word
// (engagement.patternOf, and donorStatus.closenessSql through donor_rhythm,
// which afterChange.js writes from this file on every change to a person),
// the profile's sentence (routes/profileStatus.js) and the rail's "Next gift
// expected". scripts/arch-check ratchets any second calculation.
//
// PURE: no clock, no database. drift.js bundles it into the browser (Lost &
// Found's worker), so it requires only orgTime.js and lapseRule.js.
"use strict";

const orgTime = require("../../orgTime");
const lapseRule = require("../../lapseRule");

// The knobs that decide a season. DRIFT_<NAME> overrides each, as drift.js's
// own thresholds are overridden (drift.js re-exports these in DRIFT).
const SEASON = {
  SEASONAL_MIN_YEARS: 3,      // distinct years giving in the same calendar month/quarter
  SEASONAL_SHARE: 0.8,        // …and that window must hold ≥80% of their giving events
};
const env = (typeof process !== "undefined" && process && process.env) || {};
for (const k of Object.keys(SEASON)) {
  const v = env["DRIFT_" + k];
  if (v !== undefined && v !== "" && Number.isFinite(Number(v))) SEASON[k] = Number(v);
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Robust interval variability: median absolute deviation over the median
// interval (drift.js BUILD-76: a steady giver whose last gap blew out keeps a
// clear cadence). Null with fewer than two intervals.
function intervalCv(intervals) {
  if (intervals.length < 2) return null;
  const med = median(intervals);
  if (!med || med <= 0) return null;
  const mad = median(intervals.map(x => Math.abs(x - med)));
  return mad / med;
}

function lastDayOfMonth(y, m) { // m 1-based
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return orgTime.addDays(`${ny}-${String(nm).padStart(2, "0")}-01`, -1);
}

// Same-day gifts are one giving event (two receipts on one occasion are one act
// of giving; zero-length gaps poison the median). Undated gifts are ignored.
function eventsOf(gifts) {
  const byDay = new Map();
  for (const g of gifts || []) {
    if (!orgTime.parseCivil(g && g.date)) continue;
    const key = String(g.date).slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + (Number(g.amount) || 0));
  }
  return [...byDay.keys()].sort().map(date => ({ date, amount: byDay.get(date) }));
}

// A month (or calendar quarter) is the donor's giving season when their events
// land there across SEASONAL_MIN_YEARS distinct years AND it holds
// SEASONAL_SHARE of all their events (so a quarterly giver's recurring January
// is not misread as a season).
function detectSeasonalCluster(events) {
  if (events.length < SEASON.SEASONAL_MIN_YEARS) return null;
  const months = events.map(e => orgTime.parseCivil(e.date)).filter(Boolean);
  const total = months.length;
  const tally = keyOf => {
    const by = new Map();
    for (const c of months) {
      const k = keyOf(c);
      if (!by.has(k)) by.set(k, { count: 0, years: new Set() });
      const b = by.get(k); b.count++; b.years.add(c.y);
    }
    return by;
  };
  let best = null;
  for (const [m, b] of tally(c => c.m)) {
    if (b.years.size >= SEASON.SEASONAL_MIN_YEARS && b.count / total >= SEASON.SEASONAL_SHARE) {
      if (!best || b.count > best.countIn) best = { kind: "month", month: m, years: b.years.size, countIn: b.count };
    }
  }
  if (best) return best;
  for (const [q, b] of tally(c => Math.floor((c.m - 1) / 3) + 1)) {
    if (b.years.size >= SEASON.SEASONAL_MIN_YEARS && b.count / total >= SEASON.SEASONAL_SHARE) {
      if (!best || b.count > best.countIn) best = { kind: "quarter", quarter: q, quarterEndMonth: q * 3, years: b.years.size, countIn: b.count };
    }
  }
  return best;
}

// How many giving days make their usual year (365 days over their own gap, at
// least one).
const usualPerYear = cadenceDays => Math.max(1, Math.round(365.25 / cadenceDays));

// THE ONE RHYTHM. gifts: [{ date, amount }] (positive gifts; any order).
function rhythmFor(gifts, today) {
  const t = String(today || "").slice(0, 10);
  const events = eventsOf(gifts).filter(e => !orgTime.parseCivil(t) || e.date <= t);
  const n = events.length;
  const last = n ? events[n - 1].date : null;
  const lapsed = !!last && lapseRule.isLapsed(last, t);
  const base = { events, n, lastGiftDate: last, firstGiftDate: n ? events[0].date : null, lapsed };
  if (n < 2) {
    return { ...base, hasPattern: false, cadenceDays: null, cv: null, seasonal: null, basis: null,
      gapExpected: null, onTimeThrough: null, expectedNext: null, extended: false, late: false, daysPast: 0, onTime: false };
  }
  const intervals = [];
  for (let i = 1; i < n; i++) intervals.push(orgTime.daysBetween(events[i - 1].date, events[i].date));
  const cadence = median(intervals);
  const cv = intervalCv(intervals);
  const seasonal = detectSeasonalCluster(events);
  let gapExpected;
  if (seasonal) {
    const lastC = orgTime.parseCivil(last);
    gapExpected = lastDayOfMonth(lastC.y + 1, seasonal.kind === "month" ? seasonal.month : seasonal.quarterEndMonth);
  } else {
    gapExpected = orgTime.addDays(last, Math.round(cadence));
  }
  const cadenceDays = seasonal ? 365 : Math.round(cadence);
  // FIX-33 · GIVING THEIR USUAL YEAR IS NOT COOLING: someone whose usual year
  // is two or more gifts and who has given at least that many in a year is due
  // when that year runs out, if that is later than their gap says. (For a
  // once-a-year giver one gift in a year is exactly their gap, which already
  // says when the next is due: counting it here would keep every yearly giver
  // "on time" until they lapsed, which is how case 1 read On track.)
  // The year holds them on time only while it lasts: once it has run out,
  // how late they are is counted from their own usual time (gapExpected).
  // onTimeThrough is the last day they are on time, the date the lists store
  // (it does not depend on today); expectedNext is the date a sentence says.
  let onTimeThrough = gapExpected;
  const usual = cadenceDays > 0 ? usualPerYear(cadenceDays) : 1;
  if (usual >= 2 && n >= usual) {
    const through = orgTime.addDays(events[n - usual].date, 365);
    if (through > onTimeThrough) onTimeThrough = through;
  }
  const extended = onTimeThrough > gapExpected && (!t || t <= onTimeThrough);
  const expectedNext = extended ? onTimeThrough : gapExpected;
  const late = !!t && onTimeThrough < t;
  const daysPast = late ? orgTime.daysBetween(expectedNext, t) : 0;
  return { ...base, hasPattern: true, cadenceDays, cv, seasonal, basis: seasonal ? "seasonal" : "interval",
    gapExpected, onTimeThrough, expectedNext, extended, late, daysPast, onTime: !late && !lapsed };
}

// MONEY-3 · THE ONE STORED DATE. The last day a person is on time, as the
// lists store it: their own usual time (onTimeThrough), or the last day before
// a year with no gift (lapseRule: lapsed at LAPSED_DAYS), whichever comes
// first. So "stored date >= today" is exactly rhythmFor's onTime, which the
// profile's On track reads live. Null with no pattern. afterChange.js writes it
// to donor_rhythm.expected_next, and the scores pass to donor_scores
// .on_time_through; shared/numbers/lapse.js ON_TIME_THROUGH reads the rhythm
// row (the scores row only for someone with none). They used to be two
// calculations a day apart, read by whichever was written last: Pia January,
// a Jan 1 yearly giver, read Lapsing and On track at once (surfaces-agree).
function storedThrough(r) {
  if (!r || !r.hasPattern || !r.onTimeThrough) return null;
  const yearEnds = orgTime.addDays(r.lastGiftDate, lapseRule.LAPSED_DAYS - 1);
  return r.onTimeThrough < yearEnds ? r.onTimeThrough : yearEnds;
}

// ── SPANS IN SENTENCES (STATUS-1, Jonathan 3 Nov) ────────────────────────────
// A span said in a sentence never rounds up across a rule boundary: it counts
// whole calendar months, so a sentence can never say "9 months" when the rule
// (lapseRule.js: 9 calendar months is lapsing) says under 9. Under 45 days it
// is whole weeks, under two weeks days.
function wholeMonths(from, to) {
  const a = orgTime.parseCivil(String(from).slice(0, 10)), b = orgTime.parseCivil(String(to).slice(0, 10));
  if (!a || !b) return null;
  let m = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d && lapseRule.shiftMonths(String(to).slice(0, 10), m) < String(from).slice(0, 10)) m -= 1;
  return Math.max(0, m);
}
function spanBetween(from, to) {
  const days = orgTime.daysBetween(String(from).slice(0, 10), String(to).slice(0, 10));
  if (days == null) return "";
  if (days < 1) return "less than a day";
  if (days < 14) return days === 1 ? "1 day" : `${days} days`;
  if (days < 45) return `${Math.floor(days / 7)} weeks`;
  const m = wholeMonths(from, to);
  if (m <= 1) return "a month";
  if (m < 12) return `${m} months`;
  if (m < 14) return "a year";
  if (m < 18) return `${m} months`;
  if (m < 24) return "over a year";
  if (m < 36) return "over two years";
  return `${Math.floor(m / 12)} years`;
}
// "Now 6 weeks past their usual time." for a late rhythm; "" otherwise.
const pastPhrase = (r, today) => (r && r.late ? `Now ${spanBetween(r.expectedNext, today)} past their usual time.` : "");

module.exports = { SEASON, median, intervalCv, lastDayOfMonth, eventsOf, detectSeasonalCluster, usualPerYear,
  rhythmFor, storedThrough, wholeMonths, spanBetween, pastPhrase };
