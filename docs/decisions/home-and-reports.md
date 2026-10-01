# Home, the Thread and reports

Read this when you touch Home, the Dashboard, the Thread, Drift, tasks and follow-ups, goals, report definitions, custom reports or board reports.

## Rules
- **Home is hers at 7:40 and the board view is the board meeting: one `<Dashboard surface>` over one
  `HOME_SECTIONS` registry.** Add a section there with its `surface`. The `dashboard` tab id keeps its
  route and "Home" label, and the board is `board`. (BUILD-86 A)
- **Layout edits move or hide whole sections only.** `mergeLayout` appends unknown ids as visible, Reset
  saves NULL, each surface has one unhideable section (Thread, hero) and `moveToTop` is surface-scoped. (BUILD-34, BUILD-86 A)
- **Every row on Home names a person.** Home shows no goal percentage and no measure over a period. Those
  belong on the board. (BUILD-86 A)
- **The Home note never has holes, lets a name beat a count and treats "Nothing is waiting on you this
  morning." as a whole answer.** Use surnames for people and whole names for organisations. (BUILD-86 A)
- **Write time in words, not as a day count.** Spell numbers under ten, use no colons or em dashes, and let
  each step shape write its own sentence. Reread `docs/build86/notes.txt` after changing it. (BUILD-86 C.2)
- **Any count Home states is a `homeNote` sentence (e.g. `grantDeadlineSentence`), never a numeral line.**
  It counts through the same window function its owning screen uses. (BUILD-100)
- **Compute lateness once, on the server, in the org's calendar (`overdueDays` on the row).** The note only
  reads that value. A browser-clock derivation once put two numbers on one fact. (BUILD-86 A)
- **Home is a header (greeting and day) above one `.home-shell` panel: the work, then a 340px Today rail.**
  The note sits in the Thread header (`.thread-note`). Below 1100px the rail stacks first. Cards inside the panel
  draw no edge (`.home-block`). The board keeps real cards. (BUILD-89)
- **The Today rail has two states and is never empty.** At rest it shows three numbers. A number opens its
  list and a row opens the donor, so every tile goes somewhere. No tab strip. (BUILD-89, BUILD-88d)
- **A Thread row has Drift's shape.** It shows a face, then a wrapping sentence ending "Next: <step>"
  (`lowerFirst`), then one fact on the right: how late it is. Use `min-height:64px`, never a fixed height.
  The main region is a real `<a href="/donors/:id">`. (FIX 2026-09-18, BUILD-89)
- **Nothing asks her to create a task.** Logging a conversation (`POST /donors/:id/conversations`, next-step
  decision required in the same request) is the follow-up. (BUILD-81)
- **The `threads_one_open` partial unique index decides one open thread per donor, never check-then-insert.**
  A single plan answers 409 naming the existing step, and a bulk plan skips and reports. (BUILD-81, BUILD-85)
- **The note outranks the touch type (`stepFromNote`).** Each suggestion carries a `source` the screen shows,
  and labels go through `sanitizeStepLabel`. Defaults live only in `threadShape.js`. A thank-you is a gift default only. (FIX 2026-09-09)
- **No thread closes silently.** The `threads_close_honest` CHECK refuses a close without an outcome or a
  dismissal reason. Revisit means snooze. (BUILD-81)
- **Never open a thread from imported data.** Only a live gift opens one (`openGiftThread`). (BUILD-81)
- **The Thread is one person's list: `scope=mine` by default.** The server downgrades a non-admin's
  `scope=all` and does not refuse it. Unowned threads go only to the admin's list. (BUILD-85)
- **In `threadRank.js`, every point is named and money is scored against the org's own p90, never an absolute
  figure.** The score never reaches the screen. Bands are facts, caps state the remainder, and signals use `>`. (BUILD-85)
- **Send one morning email through `runMorningBriefForOrg`, which reserves both `digest_sends` ledgers.** The
  weekend rule applies to the thread section only. Compose first, then apply the preference. (BUILD-85)
- **Steward holds things and does not nag.** "keeps asking", "until you've done it" and "recovered" as an
  outcome are banned from rendered text. Nudge subjects are facts. (BUILD-81)
- **`drift.js` is the one definition and `computeDriftForDonors` the one integration point.** Drift is computed
  on read and never cached without write-path invalidation. Its reasons are spoken sentences about money at risk. (BUILD-76)
- **`shared/driftWords.js` is the one place drift is COUNTED and NAMED.** Home, the donor directory and the
  see-all list read it, which is what keeps their counts and their words together. Two rules ride on it: the
  headline dollars sum HIGH confidence only, because a number that includes guesses is not a number a director
  repeats; and no surface says "no donors drifting" while anyone is drifting at any confidence. Medium rows are
  grouped under "Early signs", labelled in the directory badge's own words, and their figures are never called
  "at risk", because that money is not in the headline. (FIX-10)
- **`shared/fiscalPeriod.js` is the one fiscal-year LABEL**, read by the server's `finPeriodBounds` and by
  Reports' period chips. Every chip carries its year ("This FY · 2026–27"), because Reports quietly defaults to
  LAST year when the current one is thin, and "Last FY" on its own put a total on screen for a year the reader
  had neither chosen nor been told. (FIX-10)
- **An empty period beside a non-empty file explains itself.** When the current fiscal year holds no gifts but
  history exists, the surface says so in one sentence and offers the last twelve months beside it, both opening
  their own rows. Finance did this first; Fundraising copies it rather than inventing a second answer. (B1, FIX-10)
- **A task is overdue only when its due date is strictly before today on the org calendar (`lib/taskDue.js`).**
  Run a task's `donorId` and `assignedTo` through `orgOwns`. (BUILD-46, BUILD-13)
- **Goal roll-ups are derived live and never stored, and children are not double-counted.** Every surface reads
  `fundraisingGoalsPortfolio` via `/fundraising/overview`, never flat `/fundraising/campaigns`. (BUILD-16, FIX 2026-07-19)
- **A beaten goal reads as a win.** The headline shows `rawPercent` and `goalHeadSub` reads "Goal met · $X over".
  Only the bar uses the capped `percent`. (FIX 2026-07-19)
- **Impact and ROI count attributable money only.** Never present total giving as "Steward raised", and an
  estimate always carries its assumption inline. (FIX 2026-07-28)
- **Every dashboard metric has a one-sentence definition in `shared/dashboards.js`, and the hover and PDF
  footnote use that one string.** Each dashboard is one parallel batch of reads. Its PDF equals the screen in cents. (BUILD-86 C.3)
- **Every number opens (FIX-2).** A figure is a `<Figure>` carrying the `source` it was computed from, and it
  opens the one drill-through panel (`MetricBreakdownPanel`) on the rows behind it, which foot to it to the cent.
  The value is an aggregate over the source's own rows query, never a second computation. (FIX-2 A)
- **Every other on-screen number is registered with its sentence in `shared/numberCensus.js`.**
  `build97-numbers` asserts the counts exactly. A new component or page goes in its scan list or is excluded
  with a reason. (BUILD-97, BUILD-98 P3)
- **Count "Gifts not yet thanked" only from the org's first import.** An imported file is history. (BUILD-86 C.3)
- **Reports aggregate in SQL, exclude soft-deleted donors, include `is_sample` rows and use the same period
  predicate as Fundraising.** Prove them against hand-computed literals (`report-truth`). (BUILD-02, BUILD-33 P1)
- **LYBUNT and SYBUNT live only in `reportBuntList`.** Retention on an empty prior year is null. A win rate
  is won/(won+lost), and open asks are never losses. (BUILD-33 P1, BUILD-46)
- **Read the fiscal year from the org (`orgPeriodBounds`/`orgReportYear`), never a hardcoded July.**
  The year label and the bounds must move together. (BUILD-86 B)
- **A custom-report field is a catalogue key and never SQL (`shared/reportBuilder.js`).** The standard reports
  call `REPORT_HANDLERS`, so saved and tab results are one computation. Totals are summed in the DB, and CSV
  goes only through `sendReportCsv`/`reportToCsv`. (BUILD-98 P3, BUILD-87 P4)
- **Reports has one way in: the rail in `client/src/lib/reportsRail.js`, grouped by question, with Build a report at
  its top and a `<select>` below 760px.** Never add a tab row or a second list. Every id a report ever arrived by (an old
  tab id, `std:<key>`, a saved id, `saved`) goes through `resolveReportId`, and a new report goes into `RAIL_GROUPS`. (FIX-2 B)
- **The rail's seven groups are Your saved reports, Who stopped giving, Who gives the most, The year, Money in, Grants,
  and Volunteers and members, in that order.** A group folds, the fold is kept per viewer in try/catch'd localStorage,
  and opening a report opens its group (`groupOfReport`). The search box (`filterRail`) matches names across groups and
  drives the phone picker too. (FIX-3 E)
- **"The same point last year" is one window, `orgTime.samePointLastYear`, read through one source,
  `samePointLastYearSource` (routes/crm.js).** The Board and the giving summary both call it, so they agree in cents.
  A running period is cut at today and compared day for day, and a finished one with the same dates a year earlier.
  Reports read the org's fiscal start month too (`reportYearBounds(year, mode, startMonth)`). (FIX-3 E)
- **Results draw through `ReportTable` (ReportBuilder.jsx) and `reportFormat.js`.** Dates go through `shared/displayDate.js`,
  money is whole dollars unless it has cents, the totals row is the sum of the rows in integer cents, and a person row
  opens the person (`_pid` on builder rows, never a column). The CSV and PDF keep ISO dates and full values. (FIX-2 B)
- **Scheduled sends reserve a ledger row first (`digest_sends`, `saved_report_sends`) and release it on failure.**
  They ride the existing 5-minute tick, never a second scheduler. (BUILD-17, BUILD-98 P3)
## Gotchas
- **A figure's params are the rows' params.** The client sends back exactly the `source` the server gave it; a new
  figure is a new source (or new params) in `figureSources.js`, never a number computed beside it. (FIX-2 A)
- **A deep link straight onto a report tab can crash on a first render that clicking in never hits.** Stale data
  after a switch has the wrong shape, which is why it is tagged `{key, d}`. Test the first render. (BUILD-98 P3, BUILD-02)
- **Wrapping `{fmtFull(` in a helper hides the figure from the number census.** Keep it inline at the render site. (BUILD-100)
- **Keep `/reports/:key` declared after `/reports/board*` in server.js.** Otherwise "board" matches as a key. (BUILD-02)
- **Logging a gift already opens a thread, so a walk that seeds gifts and then plans silently gets 409.**
  Check every write in a walk. (BUILD-85)
- **A test that steps the clock forward must land on a weekday.** Derive the expected count from the chosen
  date, or the weekend rule fails it on Fridays. (FIX 2026-09-18)
- **An adapted donor carries `total`, not `total_giving` (`adaptDonor`, api.js).** Seed conversations with
  `TOUCH_TYPES` from `threadShape.js`, because invented touch keys are dropped silently. (BUILD-89)
## Every number opens (FIX-2 A)

Jonathan's rule from the 27 September walk: every number Steward shows is clickable, and clicking it opens the
rows that make it, the sentence that defines it, and a total that foots to the number on screen to the cent. A
number that cannot open does not ship.

- **The component.** `client/src/components/Figure.jsx`: `<Figure value kind label definition source blank
  blankShort variant>`, with `kind` one of money, count or percent and `variant` one of `tile` (a headline
  figure), `inline` (a number inside a sentence), `cell` (a row's figure) and `point` (a point on a chart, an SVG
  circle). Click, Enter or Space opens the panel. A figure without a source renders `data-no-source` and cannot
  open. A screen says how a person row opens that person once, through `FigureContext` (`openPerson`); the
  dashboards use the app's own `onNavigate("donors", {selectDonorId})`.
- **The one panel.** `MetricBreakdownPanel.jsx`. Given a `source`, it fetches the rows and shows the figure,
  its definition, the source's sentence ("Every gift dated Jul 1, 2026 to Sep 27, 2026."), the rows (50 a page,
  Previous/Next; a row naming a person opens that person) and the foot: the total of every row, which is the
  number on screen. A percentage shows its numerator's rows and its denominator's rows, each with its own total
  and paging, and the foot shows the arithmetic ("14 of 24" → 58%). A difference shows both halves. A blank shows
  the sentence saying what is missing and when it will appear, computed from the org's data (retention: the
  history floor and the prior-year cohort in `RETENTION_FLOOR`; the change on last year: a year after the first
  gift). Given `rows` instead, it is the older caller-supplied list Home's drill-downs use. There is no second panel.
- **The endpoint.** `GET /figures/:source/rows?<params>&page&pageSize` (routes/crm.js, by the dashboards).
  Tenant-scoped (the caller's org is the first argument of every source's query), read-only (a GET that writes
  nothing, proven by row counts), paginated (pageSize up to 200; the total is over every row, never the page), an
  unknown source is 404 and a malformed parameter is 400. Its shape: `{ key, params, measure, amountKind, label,
  sentence, value, cents, blank, blankShort, rows: [{ id, type, donorId, name, date, dateLabel, amount, detail }],
  page, pageSize, totalRows, parts? }`. `date` stays ISO for a machine; `dateLabel` is what a person reads.
- **One definition.** `figureSources.js` is a registry of named sources. A `sql` source is one SELECT; its value
  is SUM, COUNT or AVG over that SELECT and its rows page through the same SELECT, so the two cannot disagree. A
  `js` source (Drift among the top givers, the retention cohorts) aggregates the same array it pages. A `ratio`
  (a percentage) and a `difference` (the Board sentence) are computed from their two parts' values. The
  dashboards compute every metric through `figureValue`, and `composeActivityReport` (the Week in Review email,
  `/reports/activity`) reads the same activity sources as the People dashboard's This week.
- **The in-scope list.** `FIGURE_SOURCE_SCOPE` in `scripts/build97-number-census.js`: the screens where every
  figure must carry a source. It starts with `components/Dashboards.jsx`; other screens join it in the commit
  that converts them to `<Figure>`.
- **Guard one, the census.** On an in-scope screen, a `<Figure>` written without `source=`, or a number drawn any
  other way (any site the census patterns find), fails `build97-numbers` §6 by file and line. Proven by planting
  both in a synthetic screen.
- **Guard two, the footing.** `tests/fix2-a-footing.test.js` builds an org with known gifts across this year and
  last, fetches the rows behind EVERY figure on all four dashboards (every page) and checks each foots in cents; a
  percentage through its numerator and denominator, a blank through its sentence. Proven by moving a figure one
  cent, one count and one point.
- **The dashboards live INSIDE Reports (NAV-1, 2026-09-30).** "Dashboards" and "Reports" were two
  nav items sharing one glyph and one question. The four dashboards are now the FIRST group of the
  Reports rail (`RAIL_GROUPS[0]`, id `dashboards`, ids prefixed `dash:`), filled from the server's
  own `GET /dashboards` list exactly as the saved group is filled from `/saved-reports`, so the
  rail cannot drift from what exists. `Dashboards.jsx` draws no rail of its own when it is given a
  `dashKey` — two left rails side by side is the scanning problem NAV-1 set out to fix — and is
  unchanged otherwise. **Nothing is deleted and every way in still lands**: `navigateTo("board")`
  is kept as a synonym that opens Reports on the board dashboard, `/dashboards` redirects to
  `/dashboard?report=dash:board` (main.jsx, the one mechanism the weekly email's link already
  used), and `tests/smoke-walk.test.js` opens the dashboards from inside Reports on every run, so
  folding them in did not quietly stop walking them.
- **The dashboards.** Each answers its question in a sentence at the top, whose numbers are figures too (Board:
  "We are $X ahead of this time last year.", its $X the two tiles' difference in cents). Board has the fiscal
  year month by month, this year in emerald against last year in brass, each point opening its gifts; retention
  with its cohort; designation as Restricted and Unrestricted with their funds. Dates through
  `shared/displayDate.js`; the PDF prints the sentence and no ISO date.

## Where the code is
- `client/src/lib/homeLayout.js` — section registry and merge · `shared/homeNote.js` — the Home note and its sentences
- `client/src/components/Dashboard.jsx` — Home and board render, Thread rows, `OneLineEmpty`, `goalHeadSub`
- `shared/threadShape.js` · `shared/threadRank.js` — step defaults and extraction · queue ranking
- `shared/dashboards.js` · `shared/numberCensus.js` — definitions for dashboard metrics · for every other screen
- `figureSources.js` · `client/src/components/Figure.jsx` · `MetricBreakdownPanel.jsx` — every number opens (FIX-2 A)
- `shared/reportBuilder.js` — custom-report catalogue and `STANDARD_REPORTS`
- `client/src/lib/reportsRail.js` · `client/src/lib/reportFormat.js` — the one rail and its resolver · how a report cell reads
- server.js `REPORT_HANDLERS`, `reportToCsv`, `sendReportCsv`, `reportBuntList`, `parseReportParams`
- `drift.js` + server.js `computeDriftForDonors` — Drift · `orgTime.js` — `orgPeriodBounds`, `orgReportYear`

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Database tables (moved from the old "Database — key tables and columns")

### Retention & stewardship (goals, impact metrics, milestone detection)
The system behind the pivot's staff-facing retention engine (see "Strategic pivot" at top) — notices patterns in donor data and drafts or suggests, a human always reviews and sends. No donor-facing surface, no donor login.

- `fundraising_goals` — id, org_id, period_start, period_end, goal_type (`lapsed_recovery`|`total_raised`), goal_amount, label, created_at. Only one goal is "active" at a time: `GET /goals/active` picks the most recently created row whose period contains today — creating a new overlapping goal replaces the prior one with no delete/deactivate step needed. `lapsed_recovery` progress is reconstructed live from gift history (a gift counts if it's a donor's most recent gift in the period AND followed a >365-day gap since their prior gift), not from a stage-history table. `POST /goals` is `checkWriteAccess`-gated.
- `impact_metrics` — id, org_id, name, dollar_threshold, outcome_template, active, created_at. Org-configured "at this cumulative giving amount, here's what it funded" copy — `dollar_threshold` doubles as cost-per-unit-of-impact used to compute `{n}` in the template (threshold=300 + donor total=1200 → n=4). Settings.jsx has a manager panel mirroring the Custom Fields UI pattern. `POST`/`PUT /impact-metrics/:id` are `checkWriteAccess`-gated.
- `milestone_drafts` — id, org_id, donor_id, sequence_enrollment_id, milestone_key, subject, body, status (`pending_review`|`dismissed`|`sent`), created_at, reviewed_by, sent_at. AI-drafted milestone/anniversary emails land here for staff review — deliberately never auto-sent. `MILESTONE_THRESHOLDS = [10000, 5000, 2500, 1000, 500]` (fixed checkpoints, separate from `impact_metrics` which is org-configured content for what to SAY, not when to fire) plus giving anniversaries (6-month, then yearly) detected in `computeMilestoneCandidates()`. `milestoneKey` (e.g. `threshold_1000`, `anniversary_year_3`) lets `autoEnroll()` tell a genuinely new milestone apart from one already handled, without a separate tracking table. `ensureMilestoneSequences()` lazily provisions one `trigger='milestone'` sequence per org that has configured ≥1 active `impact_metrics` row — content is generated per-donor by `generateMilestoneDraft()`, not from `sequence_steps.body` like other trigger types. Routes: `GET /milestone-drafts`, edit/dismiss/send under `/milestone-drafts/:id`.
- `note_reminders` — id, org_id, donor_id, sequence_enrollment_id, milestone_key, talking_points (JSONB), status (`pending`|`sent`|`dismissed`), created_at, sent_at, sent_by. Non-AI-drafted sibling of `milestone_drafts` — major milestones/anniversaries get a "write a personal note" nudge with real, computed talking points (`computeNoteTalkingPoints()`) instead of a drafted email. No note content is ever generated or stored — `talking_points` are reference facts only. `POST /note-reminders/:id/send` marks it sent and logs a `stewardship` interaction confirming a note went out (never writes the note's actual content); `POST /note-reminders/:id/dismiss`.
- `metric_snapshots` — id, org_id, metric_key, value, snapshot_date, created_at. UNIQUE(org_id, metric_key, snapshot_date) — re-snapshotting the same day updates in place. **`POST /metrics/reset-baselines`** (requireAuth + requireAdmin, org-scoped, BUILD-06 Phase E) wipes the org's own snapshot history and re-snapshots today from live data — the fix for post-purge baseline pollution (trends comparing real data against snapshots of deleted test donors); run against the prod demo org 2026-07-17. Generic daily history store shared by `stewardship_debt`/`first_touch_delay` and any future metric of the same shape (see "Product design patterns" below), rather than a bespoke table per metric. `GET /metrics/stewardship-summary` computes both metrics live on every call (never served stale-only) and persists today's snapshot as a side effect, on top of a periodic background snapshot job.

## Board Reports
- `board_reports` table: id, org_id, quarter, year, generated_at, generated_by, generated_by_name, metrics (TEXT/JSON), pdf_data (TEXT/base64)
- `GET /reports/board` — list past reports (no pdf_data in response)
- `GET /reports/board/:id/pdf` — stream stored PDF back as binary (requireAuth + org scoped)
- `POST /reports/board` — generate report: pulls live Finance/Donor/Grant/Comms/Task data, calls claude-sonnet-4-6 for 3-para executive summary, builds 5-page PDF via pdfkit (bufferPages: true), saves pdf_data as base64, returns PDF binary
- pdfkit installed: `pdfkit ^0.18.0` in package.json
- Board.jsx subtabs: "members" | "reports"; raw fetch() for binary PDF download (not apiFetch)
- **`GET /donors/:id/impact-summary/pdf`** (requireAuth) — one-page printable/mailable per-donor PDF: cumulative giving, milestones reached, org-configured impact translations from `impact_metrics`. Reuses the same pdfkit pattern as `/reports/board` (buffer-to-Promise, page-footer loop) rather than a new rendering system.
- **pdfkit footer bug, fixed in both routes**: footer text drawn at `y = page.height - 28` sits below pdfkit's default `maxY` (page.height − bottom margin), which silently auto-triggers a page break on each footer `.text()` call — the Impact Summary PDF was spilling onto 3 pages instead of 1, found via a live download test against the demo account (`fac46d4`), then the identical latent bug was proactively fixed in the older Board Report PDF too (`6159672`). Fix: pass an explicit `height` option on the footer `.text()` calls so pdfkit doesn't treat it as overflow.
