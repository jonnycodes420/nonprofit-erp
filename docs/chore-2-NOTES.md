# CHORE-2 — the fast battery

No product change. Two things happened, and only one of them is speed.

**The battery was cut from 272 suites to 35** (Jonathan's call, mid-build):
the ones that guard money, donor data, email and security stayed; everything
else was retired to git, with `docs/tests-retired.md` naming each one and the
commit to restore it from. One new suite, `smoke-walk`, opens every tab and
every donor-profile tab and fails on a blank screen, an error boundary, a 5xx
or a console error. That is the whole of the screen coverage now.

**What is left then runs in parallel**, three shards, each with its own
database and its own server, with three new refusals that exist because
parallelism can hide work rather than do it: a dead shard, a planned suite
that never ran, and a suite whose pass count dropped.

Be clear about the trade, because the week it was made is the week it cost
something: `fix2-c-cream` caught an emerald-count violation on the donor
profile hours before it was retired, and `presentation-wiring` caught a
lifetime figure that under-reported every donor with imported history. Both
are gone. That class of defect is now caught by review and by the walk.

## The numbers

| | before | after |
|---|---|---|
| suites | **272** | **35** (34 kept + `smoke-walk`) |
| assertions | ~13,000 | **1,994** |
| local battery | **20m 29s** serial | **59s** — three shards, and 60s / 59s on the two repeat runs |
| CI `test` | **~590s**, one job (runs 36358402958 and 36359797455: 593s, 582s) | three shards + a combine job |
| PR-open → deployed | the battery twice, on the PR and again on main | once; main skips a tree that already passed |

Three consecutive full runs: **35 passed / 0 failed** each, and the per-suite
pass counts are **identical across all three** (checked, not assumed — the
first run is 110s because three fresh databases build their schema from
nothing; the two after it are 60s and 59s).

**What the retirement changed about sharding.** With 272 suites the browser
legs were 62% of the battery and all had to share one shard, which capped a
sharded run at about thirteen minutes. With 35 suites there are three browser
legs and the whole thing takes a minute, so the width dropped from six shards
to three: a shard's fixed cost is a fresh database plus a server boot, and six
of those over 35 suites spends more on starting than it saves on running.

## 1 · Local sharding

`tests/run-all.sh` is still the one entry point. For the FULL battery it now
splits the list across six workers; for a selection it stays serial, because
a shard costs a fresh database and a server boot and six of those to run three
suites is slower than the server that is already up. An explicit `SHARDS=`
always wins, and `SHARDS=1` is exactly the old runner.

- `scripts/shard-plan.js` — longest-first into the emptiest shard, from
  `audit/suite-timings.json`. An unrecorded suite is weighed at the MEDIAN, so
  a new suite never unbalances a run. Ties break by name, so the same list
  always gives the same plan and a failure can be reproduced with the shard it
  happened in. The plan is written to disk.
- `tests/shard.sh` — one shard: its own database (`steward_shard_<n>`, dropped
  and recreated so it never inherits yesterday's rows), its own server on its
  own ten-port block from 5700, its own preview for the browser legs with
  `CORS_ORIGIN` pointed at it. Serial inside the shard, on purpose: the
  parallelism IS the shard.
- `scripts/shard-report.js` — one summary. Pass/fail per suite in name order,
  suites containing a SKIP, the slowest ten, the wall time, and each shard's
  load. It refreshes the timings from the run, so the next plan is balanced by
  what actually happened.

**No retries anywhere.** A suite that only passes the second time is a flake,
and a runner that hides it is how a flake becomes a habit.

## 2 · CI

`tree-check → guards → test (6-way matrix) → combine → deploys`.

- **guards** runs lint, the TDZ scan and the npm-audit gate once, and the
  battery waits on it: a tree that fails the TDZ scan would fail the battery
  in a dozen confusing ways.
- **test** runs `bash tests/run-all.sh`, which shards three ways inside the
  one runner, then runs `scripts/shard-combine.js` over what it wrote: a
  failed suite, a shard that produced no result, or any suite whose PASS
  COUNT dropped against `audit/suite-counts.json` all fail the build.

**It was briefly a GitHub matrix of three jobs, and the first run showed the
flaw plainly.** Each job ran the whole of `run-all.sh`, so each ran the
reporter, and each reporter looked for all three shards' results: every job
failed with *"shards that produced no result: 2, 3"* while its own ten suites
had passed. A matrix needs each job to upload its result and a fourth job to
combine them; one runner doing all three shards needs none of that, and the
battery is about a minute now. The matrix is a follow-up, not a loss.

The middle one matters most. A shard whose server never started writes nothing
and would otherwise simply vanish, leaving a green tick over a sixth of the
battery that never ran. That is the failure mode sharding ADDS, and it is
refused by name.

The third is the ratchet the FIX leads were doing by eye at the end of every
build. A suite can go green by asserting less; the floor is now written down
and rises on its own. Lowering a number is a deliberate edit in the commit
that removes the assertion.

## 3 · Skipping a tree that already passed

A push to main is nearly always the merge of a PR whose head already ran the
full battery on the same files. `scripts/tree-already-passed.js` compares
`git rev-parse HEAD^{tree}` — the TREE, not the commit, so the message, the
author and the parents are irrelevant — against the head of every recent
SUCCESSFUL run of this workflow. On a match it skips the battery and names the
run it trusted, in the log and in the job summary.

Trust is narrow on purpose: only on a push to main, only against a successful
run of this workflow, and any doubt at all (no credentials, an API error, a
tree nobody has tested) runs the battery. A merge that resolved a conflict
produces a tree that has never existed anywhere and is tested in full, which
is exactly the case where re-testing earns its keep.

## 4 · Flakes

Three suites took the calendar YEAR from `new Date().getFullYear()` —
`theme-depth`, `donor-dashboard`, `donor-accounts` — and stamped fixture rows
with it while asserting against a server that reads the ORG's zone. On a UTC
runner between 19:00 and midnight Eastern on 31 December those disagree. They
read `civilToday()` now, which is the mechanism `tests/test-clock-seam.js`
exists to enforce.

## 5 · The rules in CLAUDE.md

Two lines changed and one was added: affected suites while you build and the
full battery once at the end; and a build is one theme with at most six items,
with mid-build finds going to the next brief, a prod walk only when a screen
changed, and a demo re-seed only when the seed changed. The line says plainly
what it does NOT loosen — the actor stamp, one gift path, the mail rules, the
prod-write guard and the deploy gate are not what a build goes faster through.

## Guarded

`tests/chore2-sharding.test.js` (29) checks the properties that make a sharded
run mean the same as a serial one: every suite in the plan exactly once, the
plan deterministic, balance by recorded time with unknowns at the median, the
reporter red on a vanished shard and on a planned suite that never ran, the
combine job red on a dropped count and green on a raised one, a database and a
port block per shard with no collision against :5611 or the worktree ports,
no retries, and a small selection still serial.


## What is left

1. **A dist per shard**, so the 51 browser legs can spread and the local run
   can approach the seven-minute target. `scripts/local-preview.js` needs a
   `DIST` override (one line); the browser suites need to read their dist
   path from an env var rather than `path.join(ROOT, "client", "dist")` —
   uniform across all 51, but a blanket edit across 51 test files deserves
   its own change with the full battery either side of it, not the tail of
   this one.
2. **Measure PR-open to deployed on a real PR.** The tree-skip is written and
   its logic is guarded, but the number in the table above is what it should
   buy, not something observed yet — the first merge after this one is the
   measurement.
3. **The CI matrix.** Three parallel runners instead of three shards in one,
   which needs per-job artifacts and a combine job. Worth doing when the
   battery grows again; worth nothing at 59 seconds.
4. **`audit/suite-counts.json` is seeded from a local run.** CI's first green
   run will ratchet it to CI's own numbers, which differ where a browser leg
   skips there and runs here. Expect one commit of churn.
