## SPEED-4 · Reports stay under a second at thirty orgs, and the nightly load test can tell (2026-11-27)

Why: the nightly load run was red one night and green the next on the same code (24 to 26 Nov: SYBUNT 2,075 then
395 ms p95, Annual 1,811 ms, three-year 1,637 ms). Each report got 2 to 10 calls a night, so its "p95" was its single
slowest call, and nobody could tell a slow report from a slow runner.

- **The load test asks each report enough to judge it** (`scripts/load/ten-orgs.js`). Each user walks the 21 reports in
  order from its own place (a fixed share), the reports turn weighs 9 instead of 1, and the run is 420 s instead of 300
  (300 x 1/20 = 420 x 1/28), so every other turn keeps its count. Measured: every report 36 to 52 calls a run; the gift
  POST 119 (was 101), calls 98 (76), profile opens 487 (454). The table prints n beside p95 and, for a stored report,
  how many answers came from the store; a route under 20 calls is "too few to judge" (a 5xx or a call over 10 s still
  fails at any count). Before the clock starts each org asks each stored report once, untimed: on prod the nightly
  pass leaves them ready for the morning.
- **Why Annual and SYBUNT recomputed after a gift (measured, main's code).** 84% and 88% of asks came from the store.
  After one gift on a quiet server the tables they read change inside the gift's own request (20 ms); the worker's
  after-change step writes nothing they read; but the refresh waited for that step, then its 2 s fold, then every other
  stale answer of the org: current again only 2.6 to 4.3 s later, 5 to 6 s under the load. A first fix (refresh at once)
  barely moved it, because the worker was the bottleneck: its report lane was one place (a third of a pool of 5,
  floored), shared by every org's refresh (10,631 waits in one run), and the 2 s refresh recomputed the same answers
  beside it. Giving summary, stored with no table list, was thrown away by every logged call (25% from the store) and
  recomputed after each on that one place.
- **What changed.** `server/reports/storedRefresh.js`: the relay of an org's `gift.recorded` and `donor.changed` events
  queues one folded job per org (`outbox.onRelayed`, new), which recomputes the answers that name their tables, two
  at a time, quickest first, skipping one a read already stored fresh. (The first version was an outbox handler: a job
  per event, and every suite's drain waits on handler jobs. In CI import8, import9 and integrity1 passed their 300 s
  deadline; locally import9 took 42 s, not 7, with 2,005 handler jobs for one org's import. Moved before merge.) `orgSummaryRefresh` (2 s later) now does only the answers that name
  no tables, and `scheduleRefresh` asks for both. The report lane is a third rounded (worker 2, web still 3). Giving
  summary names its tables (captured over a year, a range, a fund and a campaign, plus the old-report baseline branch CI caught). Nothing stale is ever served: a read
  before the refresh lands computes the answer, as before.
- **Three-year and year-over-year are stored** (`storedReports.KEYS`, each with its own `DEPS_OF` list, captured from
  the SQL each sends). EXPLAIN (ANALYZE, BUFFERS) on the 25,000-person org: year-over-year's one pass is an index-only
  scan of all 150,000 money rows, a sort that spills 9.5 MB, then 48 FILTER aggregates a row (570 ms cold); three-year
  reads the 72,819 gifts of its three spans (130 to 390 ms) and adds seven figures. The pass is the cost, not a missing
  index, so they are stored rather than indexed.
- **Measured (laptop, production-shaped web and worker, the ten load orgs, 20 users, 420 s).** Final run: Annual 95%
  from the store, p95 79 ms (n 40); SYBUNT 98%, 441 ms (41); three-year 98%, 131 ms (42); year-over-year 98%, 94 ms
  (40); giving summary 98%, 39 ms (42); profile open 458 ms; PASS. The run before it (same design, refresh one at a
  time) also passed with three-year 286 ms and year-over-year 78 ms p95. Stored against fresh, byte for byte, after the
  run: 70 answers the run left and the nightly pass's 160 common asks over all ten orgs, 0 different.
- **Still open.** SYBUNT's stored answer on the 25,000-person org is 9.2 MB and three-year's 3 MB: every refresh writes
  that and every hit sends it. Trimming them changes the answer's shape, so it is the next brief's.
- Tests: `tests/reports-speed2.test.js` §3 (planted red: "gifts" out of three-year's list, served from the store after a
  gift written straight into the table; the handler a no-op, 0 of 10 from the store; main's code, 0 of 10, nothing
  current within 2 s). `tests/reports-speed1-stored.test.js` §1 covers the two new keys; §2 now accepts a stored answer
  computed after the gift (the refresh can win the race), never one from before it.
- **After merge (2a7045e, 27 Nov).** Four nightly-shaped runs on the runner the same afternoon all FAILED, including the
  code from before SPEED-4. With SPEED-4: Annual from the store 83 to 86%, SYBUNT 76 to 87%. The 95% bar was never
  reached on the runner: 89 to 92% on the branch's one run that morning. SYBUNT p95 983 to 2,403 ms; profile 1,021 to
  1,348 ms. A follow-up that kept the refresh job going while gifts arrived did no better on one run and was not merged.
  The laptop runs met the bar; the runner is the open question for the next brief.
