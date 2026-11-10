## SCALE-3 · Retention under a second (open), and a gauge that says when to add a replica (2026-11-09)

**Why.** The nightly load check failed: on 9 Nov (a114ee7) retention p95 2,478 ms, but also the donors list 2,799, counts 1,780, the profile bundle 1,577, Fundraising 1,414 and the gift POST 1,351. The runner is saturated across routes, as SCALE-2 found: one web process at a full core. A second replica and a bigger worker are Railway settings Jonathan changes, and nothing said when.

**Measured.** On the ten-orgs cluster, every report now runs in the same load (`ten-orgs.js` "reports" turn) and `ONLY_ORG=org_ten10` puts all 20 users on the 25,000-person org. There, year over year was 2.9 s p95 (6.4 s spread across orgs), annual 1.4 s, SYBUNT 1.2 s, retention 0.53 s (the laptop is about four times the runner).

**Year over year.** `donorKindsSql` (`shared/numbers/byYear.js`) ran a first-gift MIN and a gave-the-year-before EXISTS per person per year; both are now read once and joined. 1.6 s → 1.0 s alone. All 23 reports on five orgs, calendar and fiscal (230 answers), and 84 year-over-year drawers are byte-identical to main on the same data.

**Retention: still open.** Its statement is already set-wise (SPEED-3); the cost is one grouped pass over the org's gifts, about 0.7 CPU-seconds under eight at once. Four exact rewrites (span id per gift, group by span first, only the four years read plus a gave-before join, no forced sort) and no parallel workers were all byte-identical and none faster beyond noise. The per-org store (`OS.cached`) made the whole run worse: every write in the org invalidates it and the worker recomputes it after each one. The next step is a per-person, per-year rollup kept by the gift writes, so the report reads 25,000 rows, not 150,000 gifts. Retention now has its own 800 ms bar in the load report.

**Capacity gauge.** `server/perf/capacity.js`: each process writes one `capacity_samples` row every five minutes (event-loop lag p95 and busy time from `perf_hooks`, request p95 from a middleware, connection wait p95 from `requestLimits.checkout`, peak connections, the queue's oldest wait and failures). /ops's Machine tab shows the Capacity card (`CapacityCard.jsx`): 24 hours and 7 days, a colour and the threshold beside each line, the nightly result, and one sentence. Red is a word on an ink pill, not a red colour.

**Two web replicas.** `scale1-queue` on today's code: no job twice, OAuth state and sign-in limits shared. Atlas's status line lived in one process's memory, so a poll answered by the other replica showed nothing; it is now also in `atlas_progress` (unlogged, no `org_id`, so not an org change). `scale1-queue` §9: red on main, green now.

Suites: `scale3-capacity` (new; planted: the retention bar removed, three-in-a-row made two), `scale1-queue` §9.
