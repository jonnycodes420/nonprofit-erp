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

// All thresholds in ONE place. Each is overridable via a DRIFT_<NAME> env var
// — that seam exists for tuning without a code change AND for the
// one-computation proof in tests/drift.test.js (boot a child server with a
// different DRIFT_THRESHOLD; the list and the badge must both move together).
const DRIFT = {
  DRIFT_THRESHOLD: 1.25,      // × own cadence — above this, drifting
  LAPSE_RATIO: 2.5,           // × own cadence — beyond this, lapsed (different state)
  LAPSE_MAX_DAYS: 730,        // …or 24 months, whichever comes first
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

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ROBUST interval variability: median absolute deviation over the median
// interval, not a mean-based CV. Deliberate: the variance that decides
// confidence is the variability of the donor's NORMAL rhythm — a steady
// quarterly giver whose final interval blew out (the declining donor, the
// exact shape this feature exists to catch) still has a crystal-clear
// cadence, and a mean-based CV would let the drift itself destroy the
// confidence in flagging it. The genuinely erratic donor (no repeated
// rhythm) is additionally caught by MAX_CADENCE_FOR_HIGH. Null when fewer
// than 2 intervals.
function intervalCv(intervals) {
  if (intervals.length < 2) return null;
  const med = median(intervals);
  if (!med || med <= 0) return null;
  const mad = median(intervals.map(x => Math.abs(x - med)));
  return mad / med;
}

function lastDayOfMonth(y, m) { // m 1-based; the day before the 1st of the next month
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return orgTime.addDays(`${ny}-${String(nm).padStart(2, "0")}-01`, -1);
}

// Human phrasing for a day count — a fundraiser says "seven months", never "213 days".
function humanSpan(days) {
  if (days == null) return "";
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

const fmtAmt = n => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

// ── the core assessment ─────────────────────────────────────────────────────
//
// gifts: [{ date: "YYYY-MM-DD", amount: Number }] in any order (bad/missing
// dates are ignored). today: the ORG's civil date through the seam.
// Returns { state, confidence, reason, ... } where state is one of:
//   'not_eligible' — 0–1 gifts: no cadence exists, so drift is undefined
//   'ok'           — inside their own threshold
//   'drifting'     — past threshold, before the lapse boundary
//   'lapsed'       — past the boundary: different state, different list
function assessDrift(gifts, today) {
  // Collapse same-day gifts into one giving EVENT (two receipts on one
  // occasion are one act of giving; zero-length intervals poison the median).
  const byDay = new Map();
  for (const g of gifts || []) {
    const c = orgTime.parseCivil(g.date);
    if (!c) continue;
    const key = g.date.slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + (Number(g.amount) || 0));
  }
  const events = [...byDay.keys()].sort().map(date => ({ date, amount: byDay.get(date) }));
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

  // ── seasonal cluster: month first, then calendar quarter ────────────────
  const seasonal = detectSeasonalCluster(events);

  let state, overdueRatio, expectedNext, basis, driftStartDate = null;
  const lapseBoundaryDays = Math.min(DRIFT.LAPSE_RATIO * (seasonal ? 365 : cadence), DRIFT.LAPSE_MAX_DAYS);

  if (seasonal) {
    basis = "seasonal";
    // The expected window is the cluster month/quarter in the year after the
    // last giving event; drift is measured from that window CLOSING (its last
    // day + grace), not from an elapsed interval. March-every-year Margaret is
    // not drifting on March 20; she is by June 20.
    const lastC = orgTime.parseCivil(last.date);
    const windowClose = seasonal.kind === "month"
      ? lastDayOfMonth(lastC.y + 1, seasonal.month)
      : lastDayOfMonth(lastC.y + 1, seasonal.quarterEndMonth);
    expectedNext = windowClose;
    const daysPastWindow = orgTime.daysBetween(windowClose, today);
    overdueRatio = Math.round((daysSinceLast / 365) * 100) / 100;
    if (daysSinceLast > lapseBoundaryDays) state = "lapsed";
    else if (daysPastWindow != null && daysPastWindow > DRIFT.SEASONAL_GRACE_DAYS) state = "drifting";
    else state = "ok";
    // The first civil day the state became (or becomes) drifting — the
    // quiet_past_pattern sweep's live-transition guard reads this.
    driftStartDate = orgTime.addDays(windowClose, DRIFT.SEASONAL_GRACE_DAYS + 1);
  } else {
    basis = "interval";
    expectedNext = orgTime.addDays(last.date, Math.round(cadence));
    overdueRatio = Math.round((daysSinceLast / cadence) * 100) / 100;
    const pastExpected = daysSinceLast - cadence;
    if (daysSinceLast > lapseBoundaryDays) state = "lapsed";
    else if (overdueRatio > DRIFT.DRIFT_THRESHOLD && pastExpected >= DRIFT.MIN_OVERDUE_DAYS) state = "drifting";
    else state = "ok";
    driftStartDate = orgTime.addDays(last.date,
      Math.max(Math.floor(cadence * DRIFT.DRIFT_THRESHOLD) + 1, Math.ceil(cadence) + DRIFT.MIN_OVERDUE_DAYS));
  }

  // ── confidence — a bad flag costs more than a missed one ────────────────
  let confidence;
  if (n === 2) confidence = "medium";
  else if (seasonal) confidence = "high";
  else if (cv != null && cv <= DRIFT.HIGH_CONFIDENCE_MAX_CV && cadence <= DRIFT.MAX_CADENCE_FOR_HIGH) confidence = "high";
  else confidence = "medium";

  const out = {
    state, confidence, basis, events: n,
    cadenceDays: seasonal ? 365 : (cadence != null ? Math.round(cadence) : null),
    intervalCv: cv != null ? Math.round(cv * 100) / 100 : null,
    daysSinceLast, overdueRatio, expectedNext, driftStartDate,
    lastGiftDate: last.date, firstGiftDate: first.date,
    valueAtRisk: Math.round(valueAtRisk * 100) / 100,
    seasonal: seasonal ? { kind: seasonal.kind, month: seasonal.month || null, quarter: seasonal.quarter || null, years: seasonal.years } : null,
  };
  out.reason = composeReason(out, events, today);
  return out;
}

// A month (or calendar quarter) qualifies as the donor's giving season when
// their events land there across SEASONAL_MIN_YEARS distinct years AND the
// window holds SEASONAL_SHARE of all their events — the share test is what
// keeps a quarterly giver (whose January recurs three years too) from being
// misread as seasonal.
function detectSeasonalCluster(events) {
  if (events.length < DRIFT.SEASONAL_MIN_YEARS) return null;
  const months = events.map(e => orgTime.parseCivil(e.date)).filter(Boolean);
  const total = months.length;

  const byMonth = new Map();
  for (const c of months) {
    if (!byMonth.has(c.m)) byMonth.set(c.m, { count: 0, years: new Set() });
    const b = byMonth.get(c.m);
    b.count++; b.years.add(c.y);
  }
  let best = null;
  for (const [m, b] of byMonth) {
    if (b.years.size >= DRIFT.SEASONAL_MIN_YEARS && b.count / total >= DRIFT.SEASONAL_SHARE) {
      if (!best || b.count > best.countIn) best = { kind: "month", month: m, years: b.years.size, countIn: b.count };
    }
  }
  if (best) return best;

  const byQuarter = new Map();
  for (const c of months) {
    const q = Math.floor((c.m - 1) / 3) + 1;
    if (!byQuarter.has(q)) byQuarter.set(q, { count: 0, years: new Set() });
    const b = byQuarter.get(q);
    b.count++; b.years.add(c.y);
  }
  for (const [q, b] of byQuarter) {
    if (b.years.size >= DRIFT.SEASONAL_MIN_YEARS && b.count / total >= DRIFT.SEASONAL_SHARE) {
      if (!best || b.count > best.countIn) best = { kind: "quarter", quarter: q, quarterEndMonth: q * 3, years: b.years.size, countIn: b.count };
    }
  }
  return best;
}

// The reason is written in the donor's own pattern, not in system language:
// "$2,000 every March since 2019. Nothing for 14 months." — a sentence a
// fundraiser would say out loud. Never a ratio, never a day count.
function composeReason(a, events, today) {
  const gapPhrase = `Nothing for ${humanSpan(a.daysSinceLast)}.`;
  const firstYear = orgTime.parseCivil(a.firstGiftDate).y;

  if (a.seasonal && a.seasonal.kind === "month") {
    const amts = events.map(e => e.amount);
    const typical = median(amts);
    const steady = amts.every(x => typical > 0 && Math.abs(x - typical) / typical < 0.25);
    const monthName = MONTHS_LONG[a.seasonal.month - 1];
    return steady
      ? `${fmtAmt(typical)} every ${monthName} since ${firstYear}. ${gapPhrase}`
      : `Gave every ${monthName} since ${firstYear} — usually around ${fmtAmt(typical)}. ${gapPhrase}`;
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
    return `Two gifts on record, ${humanSpan(orgTime.daysBetween(a.firstGiftDate, a.lastGiftDate))} apart. ${gapPhrase}`;
  }

  const typical = median(events.map(e => e.amount));
  const spanYears = Math.max(1, Math.round(orgTime.daysBetween(a.firstGiftDate, a.lastGiftDate) / 365.25));
  const spanPhrase = spanYears >= 2 ? ` for ${spanYears} years` : "";
  return `Gave ${humanCadence(a.cadenceDays)}${spanPhrase} — usually around ${fmtAmt(typical)}. ${gapPhrase}`;
}

module.exports = { DRIFT, assessDrift, detectSeasonalCluster, humanSpan, humanCadence, median, intervalCv };
