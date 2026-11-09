// drift.js — the drift engine (BUILD-76 Part 1).
//
// A donor is DRIFTING when they are meaningfully past their own expected next
// gift, and not so far past it that they have lapsed. Not "no gift in N days"
// — that is lapse, and it ignores the donor's own pattern, which is the
// entire idea. Full definition + threshold reasoning: audit/BUILD-76-FINDINGS.md.
//
// PURE MODULE: every input, including TODAY, is a parameter. No clock reads,
// no queries — call sites resolve `today` through the org-timezone seam
// (orgToday/orgTz) and hand gift history in. That keeps the BUILD-74 date
// audit at zero here by construction, and makes every rule below testable
// with plain data.
//
// One computation, one truth: the home-screen list, the headline dollars, the
// funnel row and every badge read the assessment produced here. A badge that
// disagrees with the list is worse than no badge.

const orgTime = require("./orgTime");
// FIX-49 decision 6: Drift's "lapsed" is the one lapse rule (no gift in the
// last 12 months after giving before). Drift still judges "drifting" by the
// person's own rhythm; it no longer has a lapse line of its own.
const lapseRule = require("./lapseRule");
// STATUS-1: the cadence, the season, the expected next gift and whether it has
// passed are shared/numbers/rhythm.js's, once. Drift judges how FAR past it a
// person is; it no longer works out when they were due.
const RHY = require("./shared/numbers/rhythm");

// All thresholds in ONE place. Each is overridable via a DRIFT_<NAME> env var
// — that seam exists for tuning without a code change AND for the
// one-computation proof in tests/drift.test.js (boot a child server with a
// different DRIFT_THRESHOLD; the list and the badge must both move together).
const DRIFT = {
  DRIFT_THRESHOLD: 1.25,      // × own cadence — above this, drifting
  MIN_OVERDUE_DAYS: 30,       // absolute floor past the expected date (a monthly giver 8 days over is noise)
  SEASONAL_MIN_YEARS: 3,      // distinct years giving in the same calendar month/quarter
  SEASONAL_SHARE: 0.8,        // …and that window must hold ≥80% of their giving events
  SEASONAL_GRACE_DAYS: 30,    // the window closes at month/quarter end; a month of grace before drift
  HIGH_CONFIDENCE_MAX_CV: 0.25, // interval coefficient-of-variation cap for high confidence
  MAX_CADENCE_FOR_HIGH: 450,  // a >15-month median interval with no seasonal cluster is not a clear cadence
  HOME_LIST_CAP: 11,          // the day view is a short list, not a report
  HANDLED_SNOOZE_DAYS: 30,    // a logged meaningful contact quiets the LIST (never the badge) this long
};
for (const k of Object.keys(DRIFT)) {
  const env = process.env["DRIFT_" + k];
  if (env !== undefined && env !== "" && Number.isFinite(Number(env))) DRIFT[k] = Number(env);
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// ── small pure helpers ──────────────────────────────────────────────────────

// STATUS-1: median, the interval variability and the month's last day are
// shared/numbers/rhythm.js's (one rhythm), re-exported here for old callers.
const { median, intervalCv, lastDayOfMonth } = RHY;

// Human phrasing for a day count — a fundraiser says "seven months", never "213 days".
// FIX-57: under two weeks the span is said in days ("4 days", "1 day"), so two
// gifts close together never read "0 weeks" or "1 weeks". A zero span has no
// length to say; the callers word it ("on the same day", "today").
function humanSpan(days) {
  if (days == null) return "";
  const d = Math.max(0, Math.round(Number(days) || 0));
  if (d < 1) return "less than a day";
  if (d < 14) return d === 1 ? "1 day" : `${d} days`;
  if (days < 45) return `${Math.round(days / 7)} weeks`;
  if (days < 350) {
    const months = Math.round(days / 30.44);
    return months === 1 ? "a month" : `${months} months`;
  }
  const years = days / 365.25;
  if (years < 1.5) {
    const months = Math.round(days / 30.44);
    return months <= 13 ? "a year" : `${months} months`;
  }
  if (years < 2.5) return `over ${Math.floor(years) === 2 ? "two" : "a"} year${Math.floor(years) >= 2 ? "s" : ""}`;
  return `${Math.round(years)} years`;
}

// "every 3 months" / "about once a year" — the donor's own cadence, said out loud.
function humanCadence(days) {
  if (days == null) return "";
  if (days < 45) return "about every month";
  if (days < 80) return "about every two months";
  if (days < 115) return "about every three months";
  if (days < 200) return "about twice a year";
  if (days < 500) return "about once a year";
  return `about every ${Math.round(days / 365.25)} years`;
}

// SCALE-1: one formatter, built once. Number#toLocaleString(locale, opts) is
// specified as new Intl.NumberFormat(locale, opts).format(n), so the output is
// the same string; building the formatter per call was 400 ms of a 25k-donor
// Drift run.
const AMT_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmtAmt = n => "$" + AMT_FMT.format(Number(n || 0));

// STATUS-1: the shape of an answer. server.js keeps a day's answers in
// donor_drift; one written before the one rhythm is recomputed, not read.
const ANSWER_V = 3;

// ── the core assessment ─────────────────────────────────────────────────────
//
// gifts: [{ date: "YYYY-MM-DD", amount: Number }] in any order (bad/missing
// dates are ignored). today: the ORG's civil date through the seam.
// Returns { state, confidence, reason, ... } where state is one of:
//   'not_eligible' — 0–1 gifts: no cadence exists, so drift is undefined
//   'ok'           — inside their own threshold
//   'drifting'     — past threshold, before the lapse boundary
//   'lapsed'       — past the boundary: different state, different list
// opts.refusedRows (BUILD-80 Part 2.4) — the count of this donor's import
// rows that could not be read. A refusal that changes a donor's story must
// change the confidence of that story: Paul Ó Briain gave in January 2026,
// the row was refused as unparseable, and the engine wrote "Nothing for over
// a year" with full confidence. Any donor with a refused row is capped at
// MEDIUM until the refusal is resolved, and the sentence says why.
function assessDrift(gifts, today, opts = {}) {
  // STATUS-1 · THE ONE RHYTHM: same-day gifts are one giving event, and the
  // cadence, the season and the expected next gift are rhythm.js's.
  const R = RHY.rhythmFor(gifts, today);
  const events = R.events;
  const n = events.length;
  if (n < 2) return { state: "not_eligible", confidence: null, events: n };

  const last = events[n - 1];
  const first = events[0];
  const daysSinceLast = orgTime.daysBetween(last.date, today);
  if (daysSinceLast == null || daysSinceLast < 0) return { state: "ok", confidence: null, events: n };

  const intervals = [];
  for (let i = 1; i < n; i++) intervals.push(orgTime.daysBetween(events[i - 1].date, events[i].date));
  const cadence = median(intervals);
  const cv = intervalCv(intervals);

  // Trailing 24-month giving — the value-at-risk basis (see FINDINGS: for a
  // drifting donor it is always > 0, because their last gift is inside the
  // ≤24-month lapse boundary).
  const cutoff24 = orgTime.addDays(today, -730);
  const valueAtRisk = events.filter(e => orgTime.compareCivil(e.date, cutoff24) >= 0)
    .reduce((a, e) => a + e.amount, 0);

  const seasonal = R.seasonal;
  const expectedNext = R.expectedNext;
  let state, overdueRatio, basis, driftStartDate = null;
  const lapsed = R.lapsed;

  if (seasonal) {
    basis = "seasonal";
    // The expected window closes at the end of their month/quarter in the year
    // after the last gift (rhythm.js); drift is measured from that close plus
    // grace. March-every-year Margaret is not drifting on March 20; she is by June 20.
    overdueRatio = Math.round((daysSinceLast / 365) * 100) / 100;
    if (lapsed) state = "lapsed";
    else if (R.late && R.daysPast > DRIFT.SEASONAL_GRACE_DAYS) state = "drifting";
    else state = "ok";
    driftStartDate = orgTime.addDays(expectedNext, DRIFT.SEASONAL_GRACE_DAYS + 1);
  } else {
    basis = "interval";
    overdueRatio = Math.round((daysSinceLast / cadence) * 100) / 100;
    if (lapsed) state = "lapsed";
    else if (R.late && overdueRatio > DRIFT.DRIFT_THRESHOLD && R.daysPast >= DRIFT.MIN_OVERDUE_DAYS) state = "drifting";
    else state = "ok";
    driftStartDate = orgTime.addDays(last.date,
      Math.max(Math.floor(cadence * DRIFT.DRIFT_THRESHOLD) + 1, Math.ceil(cadence) + DRIFT.MIN_OVERDUE_DAYS));
    if (R.extended) driftStartDate = [driftStartDate, orgTime.addDays(expectedNext, DRIFT.MIN_OVERDUE_DAYS)].sort().pop();
  }

  // ── confidence — a bad flag costs more than a missed one ────────────────
  let confidence;
  if (n === 2) confidence = "medium";
  else if (seasonal) confidence = "high";
  else if (cv != null && cv <= DRIFT.HIGH_CONFIDENCE_MAX_CV && cadence <= DRIFT.MAX_CADENCE_FOR_HIGH) confidence = "high";
  else confidence = "medium";
  const refusedRows = Number(opts.refusedRows) || 0;
  if (refusedRows > 0 && confidence === "high") confidence = "medium";

  // FIX-34 · ONE STATUS. FIX-33 taught the closeness word that giving more
  // than their own year is never cooling (aboveOwnPattern), but this state,
  // which the badge and the reason line read, still said drifting, so Emily
  // Jackson read "On track" in green beside "DRIFTING · UNSURE". The rule
  // lives here now, in the one computation every drift surface reads.
  // STATUS-1: rhythm.js moves their expected date to the end of the year
  // they have already given in full, so the flip above is no longer a second
  // rule here; aboveOwnPattern says when that is why they read on time.
  const aboveOwn = !!(R.extended && !R.late && R.gapExpected < String(today).slice(0, 10));

  const out = {
    state, confidence, basis, events: n, aboveOwnPattern: aboveOwn,
    cadenceDays: seasonal ? 365 : (cadence != null ? Math.round(cadence) : null),
    intervalCv: cv != null ? Math.round(cv * 100) / 100 : null,
    daysSinceLast, overdueRatio, expectedNext, driftStartDate,
    late: R.late, daysPast: R.daysPast, onTime: R.onTime, onTimeThrough: R.onTimeThrough, v: ANSWER_V,
    nextGift: R.nextGift, dueNow: R.dueNow,   // FLOWS-3: last gift + usual gap, the rail's next gift
    lastGiftDate: last.date, firstGiftDate: first.date,
    valueAtRisk: Math.round(valueAtRisk * 100) / 100,
    // BUILD-83 Part 3.3/4 — AT RISK IS THE NEXT GIFT, NOT THE LIFETIME. The
    // figure a fundraiser acts on is the gift this donor usually gives — the
    // amount named in the row's own sentence — not the trailing-24-month total
    // and never the lifetime. Baker Community Foundation shows $2,500, not the
    // one $25,000 it gave once. `valueAtRisk` stays for the ranking history
    // that already reads it; `usualGift` is what Home and the list display.
    usualGift: Math.round(median(events.map(e => e.amount)) * 100) / 100,
    seasonal: seasonal ? { kind: seasonal.kind, month: seasonal.month || null, quarter: seasonal.quarter || null, years: seasonal.years } : null,
    refusedRows: refusedRows || 0,
  };
  out.reason = composeReason(out, events, today);
  if (refusedRows > 0) {
    // The gap claim is hedged ("Nothing we can see for 6 months") because
    // some of their rows could not be read. FIX-33: the reason for the hedge
    // is its own line (`refusedNote`), never folded into this sentence: one
    // line was saying two things. The profile shows the note to admins with
    // a link to the rows (routes/profileStatus.js).
    out.reason = String(out.reason || "").replace(/Nothing for ([^.]+)\./, "Nothing we can see for $1.");
    out.refusedNote = refusedRows === 1
      ? "One row from your import couldn't be read."
      : `${refusedRows} rows from your import couldn't be read.`;
  }
  return out;
}

// STATUS-1: the giving season is shared/numbers/rhythm.js's.
const detectSeasonalCluster = RHY.detectSeasonalCluster;

// The reason is written in the donor's own pattern, not in system language:
// "$2,000 every March since 2019. Nothing for 14 months." — a sentence a
// fundraiser would say out loud. Never a ratio, never a day count.
function composeReason(a, events, today) {
  // STATUS-1: the gap counts whole calendar months (rhythm.spanBetween), so it
  // never says "9 months" while the lapse rule says under 9; a person past
  // their own usual time is told by how much.
  // A lapsed person's gap already says it ("Nothing for over a year").
  const late = a.late && a.state !== "lapsed" ? ` ${RHY.pastPhrase({ late: true, expectedNext: a.expectedNext }, today)}` : "";
  const gapPhrase = (a.daysSinceLast != null && a.daysSinceLast < 1 ? "The last gift was today." : `Nothing for ${RHY.spanBetween(a.lastGiftDate, today)}.`) + late;
  const firstYear = orgTime.parseCivil(a.firstGiftDate).y;

  if (a.seasonal && a.seasonal.kind === "month") {
    const amts = events.map(e => e.amount);
    const typical = median(amts);
    const steady = amts.every(x => typical > 0 && Math.abs(x - typical) / typical < 0.25);
    const monthName = MONTHS_LONG[a.seasonal.month - 1];
    return steady
      ? `${fmtAmt(typical)} every ${monthName} since ${firstYear}. ${gapPhrase}`
      : `Gave every ${monthName} since ${firstYear}, usually around ${fmtAmt(typical)}. ${gapPhrase}`;
  }
  if (a.seasonal && a.seasonal.kind === "quarter") {
    const typical = median(events.map(e => e.amount));
    const qName = ["first", "second", "third", "fourth"][a.seasonal.quarter - 1];
    return `Gave around ${fmtAmt(typical)} in the ${qName} quarter each year since ${firstYear}. ${gapPhrase}`;
  }

  // Declining shape — "gave four times a year, then once, then not at all" —
  // read from per-year event counts when the history actually has that shape.
  const byYear = new Map();
  for (const e of events) {
    const y = orgTime.parseCivil(e.date).y;
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  const years = [...byYear.keys()].sort();
  // "…then not at all" is only claimed once the silence is real (≥ half a
  // year) — never about a routine gap inside the current giving year.
  if (years.length >= 2 && a.daysSinceLast >= 180) {
    const lastYear = years[years.length - 1];
    const priorCounts = years.slice(0, -1).map(y => byYear.get(y));
    const priorTypical = Math.round(median(priorCounts));
    if (priorTypical >= 3 && byYear.get(lastYear) === 1) {
      const word = ({ 3: "three", 4: "four", 5: "five", 6: "six" })[priorTypical] || String(priorTypical);
      return `Gave ${word} times a year, then once, then not at all. ${gapPhrase}`;
    }
  }

  if (a.events === 2) {
    const between = orgTime.daysBetween(a.firstGiftDate, a.lastGiftDate);
    return between < 1 ? `Two gifts on record, both on the same day. ${gapPhrase}`
      : `Two gifts on record, ${humanSpan(between)} apart. ${gapPhrase}`;
  }

  const typical = median(events.map(e => e.amount));
  const spanYears = Math.max(1, Math.round(orgTime.daysBetween(a.firstGiftDate, a.lastGiftDate) / 365.25));
  const spanPhrase = spanYears >= 2 ? ` for ${spanYears} years` : "";
  return `Gave ${humanCadence(a.cadenceDays)}${spanPhrase}, usually around ${fmtAmt(typical)}. ${gapPhrase}`;
}

// FIX-33 · GIVING MORE THAN THEIR PATTERN IS NOT COOLING. A person who
// usually gives twice a year and has given four times in the last twelve
// months can still be past their own median gap (four gifts in February, then
// a quiet summer). The gap is not the story: they have already given their
// usual year, and more. True when the giving events (same-day gifts are one)
// in the 365 days up to today number at least their usual count for a year
// (365 days over their own cadence, at least one; a seasonal giver's year is
// one gift). `a` is assessDrift's answer for the same gifts.
function aboveOwnPattern(gifts, today, a) {
  if (!a || !a.cadenceDays || a.cadenceDays <= 0) return false;
  const from = orgTime.addDays(today, -365);
  const days = new Set();
  for (const g of gifts || []) {
    if (!(Number(g.amount) > 0) || !orgTime.parseCivil(g.date)) continue;
    const d = String(g.date).slice(0, 10);
    if (orgTime.compareCivil(d, from) >= 0 && orgTime.compareCivil(d, today) <= 0) days.add(d);
  }
  const usual = Math.max(1, Math.round(365.25 / a.cadenceDays));
  return days.size >= usual;
}


// LIVE-1 · THE NAME OF A DONOR'S RHYTHM. Read off the same assessment Drift
// makes, so "late for them" and "their rhythm" can never disagree. One of
// monthly, quarterly, yearly, year_end or none ("no pattern yet"): fewer than
// two giving events, or intervals too uneven to call, is no pattern.
const RHYTHM_WORDS = {
  monthly: "Gives about every month",
  quarterly: "Gives about every three months",
  yearly: "Gives about once a year",
  year_end: "Gives at the end of the year",
  none: "No pattern yet",
};
function rhythmOf(a) {
  if (!a || !a.cadenceDays && !a.seasonal) return "none";
  if (a.seasonal) {
    const m = a.seasonal.kind === "month" ? a.seasonal.month : a.seasonal.quarterEndMonth;
    return m >= 11 ? "year_end" : "yearly";
  }
  if (a.intervalCv != null && a.intervalCv > 0.5) return "none";
  const d = a.cadenceDays;
  if (d < 45) return "monthly";
  if (d >= 70 && d < 135) return "quarterly";
  if (d >= 300 && d < 450) return "yearly";
  return "none";
}

module.exports = { ANSWER_V, DRIFT, RHYTHM_WORDS, rhythmOf, assessDrift, aboveOwnPattern, detectSeasonalCluster, humanSpan, humanCadence, median, intervalCv };
