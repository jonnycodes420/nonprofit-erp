// Small-fix #1 — the guardsOk decision, as a pure function so both the
// boot-grace and dead-tick cases are unit-testable (the stripeKeys.js /
// billingPlans.js convention). server.js gathers the live counters and calls
// computeGuardsOk; /health surfaces the boolean.
//
// The rule (BUILD-65 Part 6, refined here): guardsOk is true only when every
// guard is clean AND fresh — but a check that hasn't RUN yet must not read
// false the instant after a deploy (that opened a UptimeRobot incident on every
// single deploy, training the operator to ignore the signal). So a not-yet-run
// tick-driven check (reconciliation, webhook subscriptions) reads OK within a
// short boot grace, and false after it (a tick that genuinely never ran is
// blind). A check that ran and then went STALE, or any real fault (a positive
// counter / missingCount), trips it regardless of boot age.

const GUARD_FRESH_MS = 40 * 60 * 1000;      // reconciliation must have run within ~40 min (2 sweep intervals)
const GUARD_BOOT_GRACE_MS = 5 * 60 * 1000;  // the recon + webhook ticks fire ~90s post-boot; give them room

// state = {
//   bootAt, reconciliation:{checkedAt,unrecordedCharges,orphanGifts,accountsErrored},
//   webhook:{checked,missingCount}, chartSelfHeals, dbFallbackRows, failedPending,
//   freshMs?, graceMs?
// }
function computeGuardsOk(state, now = Date.now()) {
  const r = state.reconciliation || {};
  const w = state.webhook || {};
  const freshMs = state.freshMs != null ? state.freshMs : GUARD_FRESH_MS;
  const graceMs = state.graceMs != null ? state.graceMs : GUARD_BOOT_GRACE_MS;
  const withinBootGrace = (now - state.bootAt) < graceMs;

  // Reconciliation: unchecked → OK only inside the boot grace; once checked it
  // must stay fresh AND clean.
  if (r.checkedAt == null) {
    if (!withinBootGrace) return false;
  } else {
    if ((now - Date.parse(r.checkedAt)) > freshMs) return false;               // ran once, then died
    if (!(r.unrecordedCharges === 0 && r.orphanGifts === 0 && r.accountsErrored === 0)) return false;
  }

  // Webhook-subscription check: same boot-grace treatment; a positive
  // missingCount is a real fault even during the grace.
  if (!w.checked) {
    if (!withinBootGrace) return false;
  } else if (w.missingCount !== 0) {
    return false;
  }

  // Event counters — a `0` here is a genuine clean state at all times (these
  // are not "a check that must run"), so no boot grace applies. dbFallbackRows
  // is null when S3 isn't configured (DB storage is then by design, not a
  // fault).
  if (state.chartSelfHeals !== 0) return false;
  if (state.dbFallbackRows != null && state.dbFallbackRows !== 0) return false;
  if (state.failedPending !== 0) return false;
  return true;
}

module.exports = { computeGuardsOk, GUARD_FRESH_MS, GUARD_BOOT_GRACE_MS };
