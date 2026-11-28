# REPORTS-6 · A report reaches the board on its own, and every report leads to an action (2026-11-28)

Why: Jarvis's competitor report (27 Nov, quick wins 1, 3, 9 and 24). Bloomerang sends scheduled reports to any inbox
with no login and turns a report's results into a group, a task or a mailing; HubSpot opens a new account on a
prebuilt dashboard with a gallery. Steward's schedules went to the report's owner with a link that needed a login.

- **Scheduled reports to named people** (`server/reports/reportSchedules.js`, `scheduleRules.js`, `reportPdf.js`).
  A saved or standard report, the board pack or the board deck; weekly, monthly or quarterly (the board pack monthly
  or quarterly only: it reports on the last whole period), on the org's day (1 to 28) and hour; to the addresses an
  admin types. The email's one link is Unsubscribe (a page that names the report and writes nothing until its button
  is pressed); the report is the PDF, the same renderer as Download PDF and the schedule's preview. Staff mail
  (`report_schedule` in `KIND_CATEGORY`), so the org's Staff mail switch holds it; the mail block and each address's
  Unsubscribe (`report_schedule_unsubs`) hold it too. The ledger (`report_schedule_sends`) is reserved before the
  first email and released when nothing was accepted; it names who it went to and who it did not, with the reason.
  The board pack's donor rule holds, refined: an address on file is refused unless that person is marked staff or
  board (board members are people on file).
- **Do something with these N people** (`server/reports/reportPeople.js`, `client/.../reports/ReportActions.jsx`).
  One function says who the people are, for the count, every action and a kept-in-step group: rows that are people
  act on themselves; giving summary and the annual report act on their own givers figure's rows; by fund and a builder
  report over gifts, pledges or plans act on the people behind the rows and say so; retention (cohorts, counted not
  listed) says it has nobody to act on. Calls go through POST /threads/plan (the Plan calls path) with an Undo that
  takes back the steps still open; a group is kept in step (a group by rule whose rule is the report, `groups.js`
  `report`) or a fixed list; a journey is the journeys' bulk add; a mailing is a fixed list and a campaign draft,
  never sent.
- **The board deck** (`server/reports/boardDeck.js`): 16:9, one figure a page, its first two figure pages read off
  `computeDashboard("board")`, so the deck is the Board view's numbers.
- **Your dashboard** (`server/reports/yourDashboard.js`): nine tiles, each read through its report's own route in
  process as the person looking, so a stored report answers from the store when nothing it reads has changed and fresh
  when anything has (SPEED-4's rule decides, not the tile). The gallery lists every report with one line and a preview.
- **Item 5**: `tests/lib/reports6Checks.js` in `assertSurfacesAgree`: Board view = deck = deck PDF (beside its own
  label) = the rows; the same point last year = giving summary = tile; LYBUNT and the thank-you backlog = report =
  tile = deck = rows. Planted a deck that prints money a cent high and a LYBUNT tile reading the wrong figure: both red.
- **Test**: `tests/reports6-schedule.test.js` (22 checks). Planted and red: the send mailing every schedule's people in
  the org (6 red), a link to the report in the email (3 red), the switch check removed with the kind not counted as
  staff mail (3 red).
- **Found on the way**: the retention tile shows the report's last whole year while the Board view's Retention is this
  fiscal year so far; both are labelled with their period, and the check compares each with its own report.
