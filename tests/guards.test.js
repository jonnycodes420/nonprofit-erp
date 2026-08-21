// Small-fix #1 — guardsOk must not false-alarm on every deploy.
//
// Right after boot the reconciliation + webhook-subscription checks haven't run
// yet (they fire ~90s post-boot on a tick), so guardsOk read `false` for that
// window and UptimeRobot opened an incident on EVERY deploy — training the
// operator to ignore the one signal that means "everything is being watched."
//
// The fix: a boot grace. A not-yet-run check reads OK within a few minutes of
// boot, and `false` after (a tick that genuinely never ran = blind). A tick
// that ran and then DIED (stale/`missingCount`) still trips it. Real faults
// (a dirty counter, a positive missingCount) trip it even during the grace.
//
// computeGuardsOk is a pure function so both the boot-grace and dead-tick cases
// are pinned without booting a server or waiting minutes.
const { computeGuardsOk } = require("../guards");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  PASS  " + name); } else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra) : "")); } };

const NOW = Date.parse("2026-08-21T12:00:00Z");
const MIN = 60 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const CHECKED_CLEAN = { checkedAt: iso(2 * MIN), unrecordedCharges: 0, orphanGifts: 0, accountsErrored: 0 };
const WEBHOOK_OK = { checked: true, missingCount: 0 };
const base = (over = {}) => ({
  bootAt: NOW - 10 * MIN, reconciliation: CHECKED_CLEAN, webhook: WEBHOOK_OK,
  chartSelfHeals: 0, dbFallbackRows: 0, failedPending: 0, ...over,
});

console.log("guards (guardsOk boot grace)");

// Steady state.
ok("checked + fresh + clean → ok", computeGuardsOk(base(), NOW) === true);

// The deploy case: nothing has run yet, but we just booted.
const freshBoot = base({ bootAt: NOW - 1 * MIN, reconciliation: { checkedAt: null, unrecordedCharges: null, orphanGifts: null, accountsErrored: null }, webhook: { checked: false, missingCount: null } });
ok("boot grace: unchecked recon + webhook within grace → ok (no deploy false-alarm)", computeGuardsOk(freshBoot, NOW) === true);

// After the grace, an unchecked reconciliation is a genuinely dead tick.
const staleBoot = base({ bootAt: NOW - 10 * MIN, reconciliation: { checkedAt: null }, webhook: { checked: false, missingCount: null } });
ok("past grace: still-unchecked recon → false (tick genuinely never ran)", computeGuardsOk(staleBoot, NOW) === false);
ok("past grace: still-unchecked webhook → false", computeGuardsOk(base({ bootAt: NOW - 10 * MIN, webhook: { checked: false, missingCount: null } }), NOW) === false);

// A tick that ran once and then died (stale) trips it regardless of boot age.
ok("checked but STALE (older than fresh window) → false (dead tick)", computeGuardsOk(base({ reconciliation: { checkedAt: iso(50 * MIN), unrecordedCharges: 0, orphanGifts: 0, accountsErrored: 0 } }), NOW) === false);

// Real faults trip it — including during the boot grace (grace excuses only
// not-yet-run checks, never an actual problem).
ok("unrecordedCharges > 0 → false", computeGuardsOk(base({ reconciliation: { ...CHECKED_CLEAN, unrecordedCharges: 1 } }), NOW) === false);
ok("orphanGifts > 0 → false", computeGuardsOk(base({ reconciliation: { ...CHECKED_CLEAN, orphanGifts: 2 } }), NOW) === false);
ok("accountsErrored > 0 → false (guard is blind for an account)", computeGuardsOk(base({ reconciliation: { ...CHECKED_CLEAN, accountsErrored: 1 } }), NOW) === false);
ok("webhook missingCount > 0 → false", computeGuardsOk(base({ webhook: { checked: true, missingCount: 1 } }), NOW) === false);
ok("chartSelfHeals > 0 → false", computeGuardsOk(base({ chartSelfHeals: 1 }), NOW) === false);
ok("dbFallbackRows > 0 → false", computeGuardsOk(base({ dbFallbackRows: 3 }), NOW) === false);
ok("dbFallbackRows null (S3 unconfigured) → ok (DB storage by design)", computeGuardsOk(base({ dbFallbackRows: null }), NOW) === true);
ok("failedPending > 0 → false", computeGuardsOk(base({ failedPending: 1 }), NOW) === false);
ok("within boot grace, a REAL fault still trips it (dirty counter)", computeGuardsOk(base({ bootAt: NOW - 1 * MIN, reconciliation: { checkedAt: null }, webhook: { checked: false }, chartSelfHeals: 1 }), NOW) === false);
ok("within boot grace, an ALREADY-checked webhook with missing>0 still trips it", computeGuardsOk(base({ bootAt: NOW - 1 * MIN, reconciliation: { checkedAt: null }, webhook: { checked: true, missingCount: 2 } }), NOW) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
