## CI-SPEED-1 · Builds push sooner and CI does the heavy lifting (2026-11-10)

- **Why.** A build took 1.5 to 2.5 hours and much of it was not building. MONEY-4 waited behind
  another tab's battery lock, then spent 100 minutes on "affected suites" (tenant-matrix alone,
  83 minutes on the laptop). The local step had grown into a mini-battery that CI then ran again.
- **`npm run affected`** (`scripts/ci/affected.js`): the diff against origin/main → the suites that
  cover it (own file, require graph stopping at route files, source pins, the routes in the diff's
  hunks, names) → what fits in 600 s by CI's timings → run on its own database. Heavy suites
  (tenant-matrix, tenant-isolation, smoke-walk, Playwright walks, load, >240 s) are CI's unless
  their own file changed. Its first real run, on this branch: 196 suites in 8 m 58 s.
- **Slots, not the lock** (`scripts/ci/affected-slots.js`): one run per worktree, two per machine,
  at most two minutes' wait, then "push". The FIX-58 pid and takeover rules carry over.
- **CI.** A PR's new push cancels its stale run; main runs are each their own group, never
  cancelled or queued. Shards no longer wait on `guards` (the `test` gate still requires it).
  node_modules cached on the lockfiles. Timings blend each run with the last: replayed over the
  seven PR runs of 10 Nov, the slowest shard stayed within 6% of the mean on the last four,
  against up to 13.9% planning from the last run alone.
- **Not cached: the client build.** FIX-60's freshness rule wants a dist built from HEAD; a cached
  dist from another commit would weaken it for 29 s a shard.
- `tests/ci-speed1-affected.test.js` pins the selection, the slots and the CI rules.
