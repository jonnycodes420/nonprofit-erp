// BUILD-90 — THE ONE DEFINITION OF WHEN THE FIRST CHARGE HAPPENS.
//
// THE RULE, and it has no clauses:
//   The first charge is THIRTY DAYS AFTER SIGNING.
//
// Signing is the moment the executive director completes Checkout in the room —
// `orgs.signed_at`, stamped once, by the close link, and never written again.
// Not the import. Not a second import. Not a rescheduled onboarding meeting.
// An earlier draft of this build started the clock at import with a 44-day cap;
// Jonathan's decision on 19 September 2026 replaced it: thirty days from
// signing, full stop. A date a customer can move by doing ordinary work is not
// a date the contract can name.
//
// WHAT THIS REPLACED. Until this build the module implemented a "Free through
// December 31, 2026" promise: every org created in 2026 got a trial ending EOD
// 2026-12-31 regardless of when it signed. That promise is gone from the
// product — no customer had signed under it, so nothing is grandfathered, and
// `tests/one-date.test.js` keeps the string from coming back.
//
// Matches claude/steward-customer-agreement.md §2.
//
// Pure + Node-testable (the money.js / greeting.js / taskDue.js pattern) so the
// pinning test can freeze the clock by passing `now` — no injectable clock yet,
// so callers pass Date.now() explicitly.

const TRIAL_DAYS = 30;
const THIRTY_DAYS_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

// The reminder lands SEVEN days before the charge — day 23 of a 30-day trial.
// One email, once, so there is no possibility of a customer being charged by a
// date they were never shown.
const REMINDER_LEAD_DAYS = 7;
const REMINDER_LEAD_MS = REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000;

function toMs(now) {
  if (now == null) return Date.now();
  if (typeof now === "number") return now;
  const t = new Date(now).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

// The trial-end Date for an org that signed at `signedAt` (ms, Date, or ISO).
// Thirty days later, to the millisecond. No calendar special cases, no cap, no
// floor: the same arithmetic in January and in December.
function computeTrialEnd(signedAt) {
  return new Date(toMs(signedAt) + THIRTY_DAYS_MS);
}

// When the seven-day reminder is due for a trial ending at `trialEnd`.
function computeReminderAt(trialEnd) {
  return new Date(toMs(trialEnd) - REMINDER_LEAD_MS);
}

// Is the reminder due now? True from day 23 right up to the charge — so a tick
// that was down on day 23 still sends on day 24 rather than silently skipping
// the only warning a customer gets. Sending ONCE is enforced by the caller
// (orgs.trial_reminder_sent_at), not by this window.
function isReminderDue(trialEnd, now) {
  const end = toMs(trialEnd), t = toMs(now);
  return t >= end - REMINDER_LEAD_MS && t < end;
}

module.exports = {
  computeTrialEnd,
  computeReminderAt,
  isReminderDue,
  TRIAL_DAYS,
  THIRTY_DAYS_MS,
  REMINDER_LEAD_DAYS,
  REMINDER_LEAD_MS,
};
