# Suites that are not in the battery

`tests/every-test-runs.test.js` fails when a `tests/*.test.js` or `tests/*.spec.js`
is neither in `run-all.sh`'s CORE list nor listed here with a reason. Add a line
here only when the battery genuinely cannot run the suite; anything else goes in
CORE. One line each: `- \`<file>\` — <reason>`.

- `brand-allowlist.test.js` — runs as the first step of every client build (`client/package.json` build and brand-guard) and in CI's guard step, so the battery would only run it twice.
- `scale1-load.test.js` — the 200-org load run (`npm run test:load`); needs the load cluster from `scripts/load/up.sh` and takes minutes.

A `<name>.spec.js` counts as run when `<name>` is in CORE and `tests/<name>.test.js`
requires it (the breaker and the two perf legs work this way).
