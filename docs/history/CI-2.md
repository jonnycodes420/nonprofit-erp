## CI-2 · The battery runs as parallel jobs, and CI gets fast again (2026-11-01)

**Why.** The battery was 192 suites run as three shards inside one CI job. PR #292 took 39m45s;
EVENTS-3 hit the 40-minute ceiling and it went to 60. Reading PR #294's log showed why it was so
slow: shard 1 carried 2,095 s of the 2,770 s, because (a) every browser suite was pinned to shard 1,
which had the one client build, and (b) the plan said "no timings yet": a PR's Actions cache is
visible only to that PR and main never ran the battery (the tree check skips it), so every PR
planned blind and weighed every suite the same.

**What changed.**
- CI is `plan` (once) → `shard (1..6)` (a matrix, one runner, Postgres and client build each) →
  `test` (the combine job, named for the check main's ruleset requires) → the deploys. A job runs
  `bash tests/run-all.sh` with `SHARD_PLAN` and `SHARD_ONLY`, the same entry point as a laptop.
  CHORE-2's matrix failed because each job reported every shard; a job now reports only its own.
- `test` fails on a failed suite, a shard with no result, a suite discovered in the tree that did
  not run exactly once (`tests/lib/shardResults.js`, also in `every-test-runs` with `SHARD_RESULTS`),
  a lower pass count, or a red guards/plan job (which used to leave the old `test` skipped, and a
  skipped required check reads as passed).
- Timings: combine saves them to the cache and as an artifact; main's `timings` job copies the
  trusted run's into main's cache when the battery is skipped there.
- Browser suites are balanced like the rest. Locally, each browser shard after the first gets a
  copy of client/dist with its API origin rewritten (`scripts/ci/dist-for-shard.js`); suites read
  the path from `tests/lib/dist.js` (`STEWARD_DIST`).
- A suite with no timing goes to the lightest shard. `SHARD_SHUFFLE=<seed>` plans at random.
- Independence: numbers1-foot §1 checks only the orgs it made (it ran over whatever demo-flagged
  orgs other suites had left in the shard); tenant-matrix's fixture takes its stored totals from
  `DONOR_SUMMARY_UPDATE` instead of writing them.

Shard count, wall times and the plants are in the PR and `.claude/reports/CI-2.md`.

**Found on the way.**
- The demo seed scored engagement before it ANALYZEd, so five shards seeding at once ran one
  query for 25+ minutes from no statistics; it ANALYZEs first now.
- Eight browser helpers built `client/dist` themselves and silently skipped their legs in any shard
  but the first; they read `tests/lib/dist.js`, and every-test-runs fails on a new one.
- The scratch Postgres (100 connections) holds about three local shards, not six.
- The shuffled runs found one order-dependent red that is not a test's fault: `/sequences/process`
  writes an active at_risk sequence into every org (docs/defects.md, CI-2).
