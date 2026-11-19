# ONBOARD-3 · Onboarding that ends in a win (19 Nov 2026)

Jonathan, 17 Nov: onboarding should end in a win, not in setup: the director sees her own quiet donors and
makes the first call. Trust comes first, from totals that match the old system.

- **Part A, item 1: "Does this match your old system?"** (`/onboard/totals`, `server/onboard/totals.js`). The
  last three years in the org's own years, each year's total and gift count straight from
  `byYear.orgByYear` (the Giving summary's year: the planted `own-year` sums it in the route and §2 goes
  red). A typed figure within $1 reads Matches; otherwise the difference, beside refunds, soft credits and
  unpaid pledges in that year, undated gifts and rows the import set aside, each a figure that opens rows
  footing to it (`totalsSources.js`). Looks right stamps `orgs.data_in_at` (moved off Accept on a staged
  import), stored with the figures typed. Ask Jonathan appends to the /ops board's Waiting on.
- **Due only for a new org's first donor file, and only in onboarding** (`markDue`: paper, a start link or a
  verbal yes). The first CI run sent every fresh test org that imported and opened Home to the check
  (flows1, flows2, polish5-sentences); a self-serve trial's Home is now untouched, and so is every org
  that already had a donor file. The walk found the spreadsheet importer (the one reader since HARDEN-1) never called
  `afterImport`, so a real file never made the check due though the hook was tested; the job now calls
  `markDue` itself and §1 imports through `/sheet-import/commit` (red before, green after). The same gap
  means MAIL-1's onboarded stamp is skipped on that path: left for the next brief, since it gates mail.
- **Part A, item 2: Your first 30 minutes** (`firstSession.js`, `FirstWin.jsx`). Up to ten people from
  `movesInHomeOrder`, now the one picker the ONBOARD-2 kickoff list uses too, each with Home's own reason;
  Stripe and QuickBooks in their real state from ONBOARD-2's signals; Log a touch with `fromMove`, the
  kickoff gate's own signal. Done says so once and Home returns to normal; Not now leaves a one-line strip
  with Open until it is done (the "Home's menu" of the brief).
- **Part B, item 3: the day-one list and day 30** (`dayOne.js`). Written once at Looks right, from
  `lapse.stateSql`. From day 30 Home (and /ops → Onboarding → Day 30) reads calls, notes and thank-yous since
  data in (each counted by `figureValue`, so it opens and foots), and day-one people with a gift dated on or
  after the data-in day. The walk caught "278 notes and touches" on a fresh import: the gifts' own timeline
  rows; only conversation types count now (§5).
- **Part B, item 4: Print this week's notes** (`/print/notes`, `weekNotes.js`). Thank-you or note steps due
  Monday to Sunday, on the Thread or Tasks; never do-not-contact or deceased; do-not-mail listed without an
  address. The first line is the template path (shared/greeting.js greetingLine plus the facts); the AI
  path is not built.
- Planted defects, each red: `no-data-in`, `own-year`, `ranking`, `before-data-in`, `not-on-list`,
  `recovered`, `print-all`, `print-dnc` (ONBOARD3_PLANT on the server), and the spreadsheet path unfixed.
