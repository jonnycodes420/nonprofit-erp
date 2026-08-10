// BUILD-50 item 1 — the "Free through December 31, 2026" promise, honored in code.
//
// /pricing and /signup publicly promise every org is free through 2026-12-31,
// then $149/month. The founding-partner agreement and the leave-behind print the
// same date. This module is the ONE definition of when a newly-created org's
// trial ends, so the backend can't contradict that public commitment.
//
// RULE (from the BUILD-50 brief):
//   • An org created ON OR BEFORE 2026-12-31 (end of day) gets a trial ending at
//     end of day 2026-12-31.
//   • An org created 2027-01-01 or later gets the standard 30-day trial.
//   • "End of day 2026-12-31" is computed in the org's timezone, falling back to
//     UTC when the org has no timezone set. Steward has NO per-org timezone
//     column today, so every org uses the UTC fallback for now — documented here
//     so it can be tightened when org timezones land (BUILD-50 items 2/3).
//
// Pure + Node-testable (the money.js / greeting.js / taskDue.js pattern) so the
// pinning test can freeze the clock by passing `now` — no injectable clock yet
// (that's item 3), so callers pass Date.now() explicitly.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// End of day 2026-12-31, UTC fallback: 23:59:59.999 so the whole calendar day is
// free; the first paid instant is 2027-01-01T00:00:00.000Z.
const FREE_THROUGH_MS = Date.UTC(2026, 11, 31, 23, 59, 59, 999);

function toMs(now) {
  if (now == null) return Date.now();
  if (typeof now === "number") return now;
  const t = new Date(now).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

// The trial-end Date for an org created at `now` (ms, Date, or ISO string).
function computeTrialEnd(now) {
  const t = toMs(now);
  return t <= FREE_THROUGH_MS ? new Date(FREE_THROUGH_MS) : new Date(t + THIRTY_DAYS_MS);
}

module.exports = {
  computeTrialEnd,
  FREE_THROUGH_MS,
  FREE_THROUGH_ISO: new Date(FREE_THROUGH_MS).toISOString(),
  THIRTY_DAYS_MS,
};
