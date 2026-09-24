// shared/thresholds.js — BUILD-97 Part 2. THE NUMBERS THE PRODUCT IS ALLOWED
// TO SAY OUT LOUD, AND WHERE EACH ONE COMES FROM.
//
// The donor profile's Suggested panel printed sentences like "Day 66 is
// critical — momentum fades after 75 days." Nothing computed 75. Nothing
// defined it. It came out of a model, mid-paragraph, in the product's own
// voice, and a fundraiser reading it has no way to tell it from the drift
// engine's thresholds, which are real, tuned, and written down.
//
// That is the defect this module exists to make impossible. A number attached
// to a TIME UNIT or a PERCENT inside model output is a THRESHOLD CLAIM — a rule
// about how giving works — and a threshold claim may only name a number that is
// in this table or in the rows the model was handed.
//
// ── WHY A TIME UNIT OR A PERCENT, AND NOT "ANY NUMBER" ────────────────────
// Model output legitimately carries numbers all day: a donor's own gift
// amounts, their own dates, a year, an ask figure. Those are DATA, and
// forbidding them would forbid the model doing the job it is there for. What
// cannot appear is an invented RULE — "after N days", "N% of donors", "within
// N months" — because a rule is a claim about how the world works, and this
// product's whole position is that it says nothing it cannot trace to a row.
//
// ── THE TABLE IS DESCRIPTIVE, NOT AUTHORITATIVE ───────────────────────────
// Each entry names the constant it MIRRORS. The live value lives in the module
// named in `source`; this table exists so a text check has something to compare
// against without importing the server. `tests/build97-numbers.test.js` asserts
// every entry still matches its source, so the mirror cannot go stale silently.
//
// Pure: no DB, no network, no clock, no JSX.

export const THRESHOLDS = [
  // ── DRIFT (drift.js, the DRIFT table — every one env-overridable) ────────
  { value: 30,  unit: "days",   name: "MIN_OVERDUE_DAYS",     source: "drift.js DRIFT",
    means: "how far past their own expected date a donor must be before Steward calls it drift" },
  { value: 30,  unit: "days",   name: "SEASONAL_GRACE_DAYS",  source: "drift.js DRIFT",
    means: "the grace after a seasonal giver's window closes" },
  { value: 30,  unit: "days",   name: "HANDLED_SNOOZE_DAYS",  source: "drift.js DRIFT",
    means: "how long a logged contact quiets the drift list" },
  { value: 730, unit: "days",   name: "LAPSE_MAX_DAYS",       source: "drift.js DRIFT",
    means: "the outer boundary past which a donor is lapsed, not drifting" },
  { value: 450, unit: "days",   name: "MAX_CADENCE_FOR_HIGH", source: "drift.js DRIFT",
    means: "the longest median interval that can still be called a clear cadence" },

  // ── LAPSE (server.js) — the ONE lapse boundary, shared by inferStage, the
  // auto-lapse sweep and the pipeline's Lapsed column.
  { value: 365, unit: "days",   name: "LAPSE_DAYS",           source: "server.js",
    means: "no gift in this long and the donor is lapsed" },

  // ── THE FAILED-CARD CADENCE (server.js DUNNING_SCHEDULE_DAYS) ───────────
  { value: 0,   unit: "days",   name: "DUNNING_SCHEDULE_DAYS[0]", source: "server.js",
    means: "the first recovery email, the day the card fails" },
  { value: 3,   unit: "days",   name: "DUNNING_SCHEDULE_DAYS[1]", source: "server.js", means: "the second recovery email" },
  { value: 7,   unit: "days",   name: "DUNNING_SCHEDULE_DAYS[2]", source: "server.js", means: "the third recovery email" },
  { value: 14,  unit: "days",   name: "DUNNING_SCHEDULE_DAYS[3]", source: "server.js", means: "the last recovery email" },

  // ── THE THREAD QUEUE (shared/threadRank.js) ─────────────────────────────
  { value: 21,  unit: "days",   name: "OVERDUE_CAP_DAYS",     source: "shared/threadRank.js",
    means: "the point past which more lateness stops adding to a row's rank" },
  { value: 14,  unit: "days",   name: "THANK_DECAY_CAP_DAYS", source: "shared/threadRank.js",
    means: "the point past which a late thank-you stops decaying further" },

  // ── BILLING (closeLink.js / trialEnd.js) — the one date a contract names ─
  { value: 30,  unit: "days",   name: "TRIAL_DAYS",           source: "trialEnd.js",
    means: "thirty days from signing to the first charge" },
  { value: 7,   unit: "days",   name: "TRIAL_REMINDER_DAYS",  source: "server.js",
    means: "the single warning before that first charge" },

  // ── RETENTION, THE ONE SECTOR FIGURE STEWARD IS ALLOWED TO QUOTE ────────
  // Everything else in this file is the product's own arithmetic. These two are
  // published research, cited on screen with their source every time they are
  // shown, which is the only basis on which a number from outside the
  // organisation's file may appear at all.
  { value: 71,  unit: "percent", name: "SUSTAINER_BENCHMARK", source: "M+R Benchmarks 2026",
    means: "monthly sustainer retention at twelve months, sector-wide" },
  { value: 43,  unit: "percent", name: "FEP_RETENTION",       source: "Fundraising Effectiveness Project, full-year 2025",
    means: "donor retention, sector-wide" },
];

const ALLOWED_BY_UNIT = THRESHOLDS.reduce((m, t) => {
  (m[t.unit] ||= new Set()).add(t.value);
  return m;
}, {});

// ── FINDING A THRESHOLD CLAIM IN A PIECE OF TEXT ──────────────────────────
// A number immediately bound to a time unit or a percent sign. Deliberately
// NOT: a bare number, a dollar amount, a year, a date, an ordinal.
//
// "$2,000 every March since 2019" contains three numbers and NO claim.
// "momentum fades after 75 days" contains one number and IS one.
const TIME_UNITS = "days?|weeks?|months?|years?";
const CLAIM_RE = new RegExp(
  // "75 days", "3 months", "within 90 days"
  String.raw`(?<![\$\d.,])\b(\d{1,4})\s*(?:-|\s)?\s*(` + TIME_UNITS + String.raw`)\b` +
  // ...or "24%", "24 per cent", "24 percent"
  String.raw`|(?<![\$\d.,])\b(\d{1,3}(?:\.\d+)?)\s*(%|per ?cent(?:age)?)`,
  "gi");

export function thresholdClaims(text) {
  const out = [];
  const s = String(text || "");
  CLAIM_RE.lastIndex = 0;
  let m;
  while ((m = CLAIM_RE.exec(s))) {
    if (m[1] !== undefined) {
      out.push({ raw: m[0].trim(), value: Number(m[1]), unit: normaliseTimeUnit(m[2]), index: m.index });
    } else {
      out.push({ raw: m[0].trim(), value: Number(m[3]), unit: "percent", index: m.index });
    }
    if (m.index === CLAIM_RE.lastIndex) CLAIM_RE.lastIndex++;
  }
  return out;
}

function normaliseTimeUnit(u) {
  const t = String(u).toLowerCase();
  if (t.startsWith("day")) return "days";
  if (t.startsWith("week")) return "weeks";
  if (t.startsWith("month")) return "months";
  return "years";
}

// Weeks/months/years are converted to days before comparison, so "two weeks"
// and "14 days" are the same claim and both resolve against the same constant.
const IN_DAYS = { days: 1, weeks: 7, months: 30, years: 365 };
function asDays(claim) {
  return claim.unit === "percent" ? null : claim.value * IN_DAYS[claim.unit];
}

// ── THE CHECK ──────────────────────────────────────────────────────────────
// `groundedValues` is every number that appeared in the ROWS handed to the
// model: a donor whose last gift was 66 days ago makes "66 days" a fact about
// them, not an invented rule, and the model must be able to say it.
//
// Returns the claims that are neither in the constants table nor in the rows —
// each one a sentence the product would be asserting on its own authority.
export function ungroundedClaims(text, { groundedValues = [] } = {}) {
  const grounded = new Set((groundedValues || []).map(Number).filter(Number.isFinite));
  const allowedDays = new Set([...(ALLOWED_BY_UNIT.days || [])]);
  const allowedPct = ALLOWED_BY_UNIT.percent || new Set();
  return thresholdClaims(text).filter(c => {
    if (grounded.has(c.value)) return false;
    if (c.unit === "percent") return !allowedPct.has(c.value);
    const d = asDays(c);
    // The claim is allowed if the DAY COUNT matches a constant — so a
    // constant of 14 days permits "two weeks" as well as "14 days".
    return !allowedDays.has(d);
  });
}

// The sentence the refusal is reported with, in the product's own voice.
export function ungroundedSentence(claims) {
  if (!claims || !claims.length) return "";
  const list = [...new Set(claims.map(c => `"${c.raw}"`))];
  const n = list.length;
  return `Steward withheld this draft: it states ${n === 1 ? "a rule" : "rules"} ` +
    `(${list.join(", ")}) that ${n === 1 ? "is" : "are"} not in your file and not ` +
    `anything Steward measures. A number in a sentence about a donor has to come ` +
    `from that donor's own rows.`;
}
