# FIX-2 B — Reports, one way in (notes for the lead)

## What changed
- **One navigation.** The horizontal tab row (`SectionTabs`, `.reports-tabbar`) and the "Your reports"
  left list (`SavedReportsView`, "Everyday questions") are gone. One rail (`client/src/lib/reportsRail.js`),
  grouped by question, with **Build a report** at its top. Below 760px the rail's list is hidden and the
  same groups become one native `<select>` (`data-testid="reports-picker"`). Active item: white ground,
  ink, weight 700, 3px emerald rule on the left. While the builder is open, the Build button steps down
  to an outline so the builder's Save is the one emerald action.
- **Results read like a report.** One table (`ReportTable`, exported from ReportBuilder.jsx) draws every
  result: tab reports, standard reports, saved reports, the builder. Dates through
  `shared/displayDate.js`, money through `fmtFull` (whole dollars unless cents), a `<tfoot>` totals row
  summed from the rows in integer cents (`client/src/lib/reportFormat.js`), sortable headers (a
  `<button data-sort-key>` in each `<th>`, `aria-sort`), and every person row opens the person through
  `onNavigate("donors", { selectDonorId })` (the name is also a real `<a href="/donors/:id">`).
- **Server (read-only, no new routes):** builder rows carry `_pid` (the person, from a new `person`
  field per entity in `shared/reportBuilder.js`); standard handler reports carry `_pid` and a per-column
  `display` hint (`STD_DISPLAY`/`STD_PERSON` in routes/crm.js). `members-expiring` / `members-lapsed`
  select `d.id AS donor_id`. `type` is unchanged, so the PDF (formats by `type`) and CSV (walks
  `columns`) do not change by a byte.
- **Start here** stays and opens LYBUNT (`pick("lybunt")`).

## Placement (the rail)
- **Who stopped giving?** LYBUNT · SYBUNT · Lapsed over 24 months · Retention · Monthly givers and status
- **Who gives the most?** Top donors · 3-year comparison · Board giving · Solicitations (Team)
- **How did the year go?** Giving summary · Gifts by month vs last year · Gifts by fund · Annual report ·
  Week in review · First-time donors this year · Pledges outstanding · Acknowledgment backlog ·
  Gifts by link source · Gifts for the bookkeeper · Grants pipeline · Grants by funder ·
  Awarded vs requested by year · Grant deadlines, next 90 days · Restricted balances by grant
- **Volunteers and members** Volunteers who give · Members by level · Memberships expiring in 60 days ·
  Lapsed members · New and renewed members by month · Membership and donation revenue
- **Your saved reports** the org's own (shared, or mine), from `/saved-reports`

Duplicates folded (the same handler, one item): `std:lybunt`→LYBUNT, `std:sybunt`→SYBUNT,
`std:retention`→Retention, `std:top-50`→Top donors (lifetime), `std:by-fund`→Gifts by fund (funds).
The folded ones keep a **PDF** button on the tab report when the controls match the standard's
(`PDF_TWIN`: fiscal, current year; top donors lifetime) — the same `/saved-reports/std:*/pdf` as before.
`std:by-fund` gets no PDF twin: it is a builder query that excludes sample rows, the tab handler includes
them, so the two could differ on a sample org.

## Every way a report arrives (all go through `resolveReportId`)
- URL: `/dashboard?report=<id>` (App.jsx → `navigateTo("reports",{savedReport})`, the weekly email's
  link) — now accepts ANY id: an old tab id, `std:<key>`, a saved id, `saved`.
- `navigateTo("reports", { report: "<id>", preset?, from?, to?, yearMode? })` (Home chips:
  `giving-summary` with `thisFY` or a from/to week — unchanged).
- `navigateTo("reports")` with nothing: Giving summary (TopBar search, Fundraising tiles, Finance links).
- `saved` (the old "Your reports" tab) lands on LYBUNT, which is what that tab opened on.
- **For workstream D (the Agent):** "donors who gave last year but not this year" →
  `onNavigate("reports", { report: "lybunt" })`. Same result from `/dashboard?report=lybunt`.
- No App.jsx change was needed. tabRegistry has one `reports` entry (unchanged).

## Tests
- `tests/fix2-b-reports.test.js` (CORE, appended): red at 69b71de (11 passed, 34 failed on the old
  code), green now (64 passed). Browser legs SKIP without Playwright.
- Planted defects (each went red, then restored): a date cell returned raw (5 fails incl. the
  33-report ISO walk); the foot skipping its first row (3 fails, both screens); rows with no person
  (Cy's row does not open Cy).
- Export content: `node scripts/fix2-b-capture-exports.js <dir>` seeds the fixture and writes 74 exports
  (24 `/reports/:key?format=csv`, 25 standard + 1 saved CSV and PDF, PDFs inflated and date-normalised).
  Captured on the old code and on this branch, each on a fresh database: `diff -r` identical;
  hashes in `docs/fix-2/B/exports-sha256.txt`. (On a database that has run suites, the Acknowledgment
  backlog's TIED rows (same gift date) come back in heap order, which differs between databases on
  old and new code alike; the query has no tie-breaker. Pre-existing, not changed here.)
- E's `fix2-e-no-iso` guard, run from e71f70b against this branch: no Reports hit (its Reports walk
  clicks named items; the §7b walk here covers all 33 rail reports, including saved/standard tables,
  the bookkeeper list and Week in review).

## Assertion / census changes
- `tests/build97-numbers.test.js` EXPECTED: Reports.jsx 41→42, total 408→409, claims 123→121
  (the brief's Part B changes what Reports draws; census exact by design). `audit/BUILD-97-NUMBER-CENSUS.md` row updated to match.
- No other existing assertion text changed. build98-reports §8 passes unchanged (`rb-view`,
  `rb-result`, `rb-new`, `rb-run` testids kept).

## For the lead
- `tests/run-all.sh` CORE: `fix2-b-reports` appended after `fix2-codeql`.
- `docs/decisions/home-and-reports.md`: two rules (the one rail; the one results table).
- Finance's "Gifts by fund →" still calls `onNavigate("reports")` with no id (lands on Giving summary);
  `onNavigate("reports", { report: "by-group" })` would land on Gifts by fund. Finance.jsx is not mine.
- `tests/reports.test.js` (not in CORE) needs the loadtest `admin@willow.test` fixture and cannot log in
  on a fresh stack; unrelated to this change.
