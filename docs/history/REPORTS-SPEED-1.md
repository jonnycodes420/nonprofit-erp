## REPORTS-SPEED-1 · Retention, Annual and SYBUNT from stored per-org answers (2026-11-10)

Why: the nightly load bar failed on /reports/retention (1.15 to 2.5 s p95 on the runner); Annual and SYBUNT
are the same shape. SCALE-3 left it open: each is one grouped pass over every gift the org has, every request,
and a first try with the per-org store made the run worse because every write in the org threw the answer away.

- **What changed.** The three reports' common asks (Retention with a year mode; Annual and SYBUNT for a year
  near today with a year mode) are stored in SCALE-2's `org_summary`, served while nothing they READ has changed,
  recomputed on read otherwise, and refreshed after a change by the after-change step's `orgSummaryRefresh`.
  A fund or campaign filter, a date range, an older year or a CSV computes live, as before
  (`server/reports/storedReports.js`).
- **Only what they read.** A stored answer now names its tables (`org_summary.deps`, `cached(..., { reads })`);
  NULL is every watched table, as before, so every other stored answer behaves exactly as it did. The reports
  read gifts, orgs, funds, fund lines, campaigns, households, relationships, the import note, and
  `donors.people`: a change row written by a trigger on donors only when a row changes outside the columns
  background work rewrites and none of the three reads (the score, the stage suggestion, geocoding, photo
  fetching, `updated_at`). A logged call rescores the person and no longer throws the reports away; a rename does.
  The table list came from capturing the SQL each report sends, not from reading the code.
- **Nightly.** `storedReportsNightly` recomputes every org's common asks through the route, compares each with the
  answer stored for the same day when nothing has changed since, logs any difference, and stores the fresh one.
- **Measured (laptop, production-shaped web and worker, the ten load orgs).** The nightly's shape (20 users across
  ten orgs, 180 s): retention p95 343 → 177 ms, Annual 122 → 120, SYBUNT 208 → 187 (main and this branch, same
  data). Twenty users on the 25,000-person org (120 s): retention p95 1,626 → 901 ms, p50 456 → 284. That case
  is still over 800 ms: a gift lands in that one org every three seconds, so a read often arrives between a gift
  and the refresh and computes live. The next step stays SCALE-3's: a per-person, per-year rollup kept by the
  gift writes, so a miss reads 25,000 rows rather than 150,000 gifts.
- Found on the way: an option named `deps` in `cached()` shadowed the module's own `deps` (orgTz, orgToday) and
  silently turned every stored route off; caught by the smoke before any suite, renamed `reads`.
