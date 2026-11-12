## REPORTS-SPEED-2 · Year-over-year and Annual stop filling the pool (2026-11-12)

Why: the nightly load test (20 users, 10 orgs) was red: GET /reports/year-over-year p95 11,709 ms, /reports/annual
5,917 ms, and the web's ten connections peaked at 100%. Prod is quiet most of the day, but a few board members
opening reports at once would have queued every Home, Donors list and profile behind them.

- **Measured first.** On the 25,000-person load org, year-over-year was six statements, 2.2 s, one connection held
  throughout. 1.4 s of it was the donor-kinds statement: 84,305 person-year rows carrying name, date and amount
  through four sorts that spilled to disk, and the gifts read twice. The totals pass read the same gifts again
  (410 ms), and `MIN(date)` aggregated every row (205 ms) for an answer an ordered index walk finds in 0.3 ms.
  Annual was six serial reads, then nine figures fired at once: one Annual held nine of the ten connections.
- **Year-over-year in one pass** (`shared/numbers/byYear.js` `orgYearsSql`). Every span (each fiscal year, the year
  before the oldest, the same point last year) is one set of FILTER columns over the org's money rows, read once
  in person order off the covering index `gifts_person_money`. Nothing sorts, nothing spills. The rules are the
  same shared/numbers expressions. 25k org 2,151 → 375 ms; 10k 626 → about 200 ms. The figure drawers still open
  `donorKindsSql`'s rows.
- **Annual.** One read was dead: the new/returning split, whose two values were always replaced by the `givers`
  figures in the answer. Gone, with the answer's key order kept. The other reads go out together.
- **The report lane** (`server/shared/reportLane.js`). Every statement a report request sends takes one of
  `DB_POOL_MAX / 3` places first (3 of 10), shared by every report in the process, so reports together never hold
  more than that. A place is held for one statement, never across JS. A wait is bounded by the request's own
  limit, and past it the answer is a 503 with "This report took too long to run. Try a smaller date range, or try
  again in a minute." DB_POOL_MAX is unchanged. `/health pool.reportLane` shows the places and the connections
  report requests hold by any path (`heldPeak`), so a `withClient` around a report shows up.
- **What did not work, and why.** A first version of the one-pass statement grouped by (span, person) and
  self-joined for "the year before": the same answer, but it sorted 159,000 rows by a text key and spilled, 1.0 s.
  Grouping by person alone off the covering index removed every sort. The first lane went after `requireAuth`;
  with no session cache the ten sign-in checks took connections outside it. It now sits ahead of `requireAuth`.
- **Measured (laptop; production-shaped web and worker; nightly shape, 20 users, 10 orgs, 300 s; main and branch
  back to back).** Year-over-year p95 3,730 → 1,088 ms; Annual 1,468 → 34; profile open 2,050 → 987; Donors list
  990 → 629; samples with all ten connections in use 254 → 136; the most requests waiting 68 → 41.
- **Still open.** The whole pool still reaches ten of ten under that shape: two Donors list reads alone fill it
  (each read fans out several statements at once), and a profile open fires about thirteen requests. Reports are
  no longer the cause; bounding the list and profile fan-out is the next brief's.
- Tests: `tests/reports-speed2.test.js` with main's code frozen in `tests/lib/reportsSpeed2Main.js` (parity on
  four orgs, by-hand year figures, the load shape on 10,000 people). Planted: refunds counted, the per-year loop,
  a connection held across JS work; each red before green.
