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
- **Scheduled sends reserve a ledger row first (`digest_sends`, `saved_report_sends`) and release it on failure.**
  They ride the existing 5-minute tick, never a second scheduler. (BUILD-17, BUILD-98 P3)
## Gotchas
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
## Where the code is
- `client/src/lib/homeLayout.js` — section registry and merge · `shared/homeNote.js` — the Home note and its sentences
- `client/src/components/Dashboard.jsx` — Home and board render, Thread rows, `OneLineEmpty`, `goalHeadSub`
- `shared/threadShape.js` · `shared/threadRank.js` — step defaults and extraction · queue ranking
- `shared/dashboards.js` · `shared/numberCensus.js` — definitions for dashboard metrics · for every other screen
- `shared/reportBuilder.js` — custom-report catalogue and `STANDARD_REPORTS`
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
