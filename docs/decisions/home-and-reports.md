# Home, the Thread and reports

Read this when you touch Home, the Dashboard, the Thread, Drift, tasks and follow-ups, goals, report definitions, custom reports or board reports.

## Rules
- **The ladder and the cards are one engine (INSIGHTS-1).** `insights.js` is pure (every input, `asOf`
  included, is a parameter); `insightsData.js` reads; `routes/insights.js` serves Home, the first look, the
  profile, the Donors list's rung column and filter, and Ask (through the list's `rung`, `ladder_status` and
  `planned` fields). Nothing is stored: a rung is computed from the gifts each time (an in-process memo keyed
  by the org's gift fingerprint). A household is one giver. Every number in a card's words must be in its
  facts (`numbersOk`); a GET writes nothing (the page POSTs `/insights/seen`). Review leads the first look and
  follows the people cards on Home. A person with an undated gift is never in Drift or "Gone quiet"
  (`excludedReason: undated_gift`).
- **Not a gift is Finance revenue, never a gift row (INSIGHTS-1, Jonathan 27 Oct; the INT-POS rule).** Review's
  Not a gift makes the money a `fin_transactions` line (`source 'not_a_gift'`, type income, the person, date,
  amount and memo; 4050 Special Events for a purchase or tickets, 4060 Other Revenue for a reimbursement) and
  removes the gift row, kept whole in `insight_reviews.row_data`; `/insights/review/:id/undo` puts both back
  exactly. Out of every giving total by construction; Finance's money in counts the line. The truth check
  holds Finance's money in to gifts plus what she marked. Refused for a gift with a receipt, a payment, a
  pledge or an open thank-you.
- **Lapsing respects rhythm (INSIGHTS-1).** `lapseRule.js`: a yearly or year-end giver (`donor_rhythm`)
  whose expected next gift has not come yet is not Lapsing; the tags, groups, the at-risk email, the journey
  trigger and the dashboard's at-risk list read it (`rhythmAheadSql`). Lapsed is unchanged.
- **A next step is one record in three views (FIX-31).** Every thread has one `link_kind='next_step'` task written
  by `trg_thread_task_sync`; Tasks, the Thread and the Calendar read that one pair. Ticking the task logs
  "<label>: done." and closes the thread on that line; Undo deletes the line and reopens it. The Calendar draws
  the step, never its task; Home's queue, the daily task email and the digest skip next-step tasks because the
  thread already carries them. `backfillLinkedTasks()` (db.js) runs with the schema and is safe twice.
- **A booked meeting is one thing (FIX-34).** When a next step IS a meeting, `calendar.js foldMeetingSteps`
  keeps the meeting item and hangs the step on it (`item.step`); the card offers Prep, Reschedule, Mark done.
  The Thread (`composeThreads`, no `donorId`) is one row per donor: the soonest open step, the rest as
  `moreSteps`, and `stat.open` counts donors. Tasks and a profile read keep every step. A call or meeting
  next step is finished through how it went and what's next: `/tasks/:id/complete` refuses a bare tick
  (422 `needs_outcome`) and the Calendar opens Tasks' `FinishSheet`. A deadline's task keeps its plain tick.
- **A task is in exactly one view, by one rule (TASKS-2).** `shared/taskShape.js viewOf` and `taskViewSql`
  (routes/crm.js) say the same thing: today, upcoming (next 7 days), overdue, later, no date, done (last 30
  days). The list, `GET /tasks/counts` and Home's "Due today" read it; `tasks2-thread` §6 checks they agree.
  A call or meeting task with a person finishes only with an `interactionId` from
  `POST /donors/:id/conversations` (a next step or "No next step"); a linked next step still ticks as FIX-31.
- **A Thank-you or Email task does the thing (FIX-34).** Its button opens the draft in Tasks, from the org's
  template (Templates), for that person and, for a thank-you, THAT gift (`source_gift_id`, else the latest
  unthanked). `POST /tasks/:id/thank` (Send or Mark sent) thanks the gift as `/acknowledgments/mark` does,
  takes its drafted thank-you out of the queue and closes the task; `/thank/undo` puts all three back.
  `POST /tasks/:id/email` sends through `sendMilestoneDraft` and leaves the task open: it finishes through
  `/tasks/:id/complete` with that email's `interactionId` and a next step or "No next step". Select boxes
  show only after "Select" (or a long press); every row tap target is 44 x 44 px.
- **First thing speaks in one subject (`shared/firstThing.js`).** The logged line's pronoun becomes the first
  name, and the step says its day ("Christine asked for the impact report. Send it today.").
- **Last conversation has one rule: `meetings.js conversationsWith`.** A held meeting (logged or on
  a calendar), or a call, email, ask or stewardship touch, dated on or before the org's today. A
  note is never a conversation, whoever wrote it (the Agent included), and a newsletter line is not
  one. Last met is `lastMeetingWith`, so last conversation is never older than last met. The header's
  closeness line and the Last contact figure both read it. Engagement's "most recent touch" is
  worded at read time (`engagement.reasonFor`), never from text stored on the day scores ran. (FIX-24)
- **Calls to make is one rule.** `callsToMake.js callsSql`: first gifts in the last 7 days, and gifts at
  or over `orgs.call_gift_floor_cents` (WHY-1's $250 by default) in the last 60, with no call logged with
  that person on or after the gift date. Mark called writes a call interaction; Snooze hides one gift for
  7 days (`call_snoozes`). The panel and its count read the same SQL (`calls-to-make` source). (PARITY-1)
- **"Vs last year" is one computation: `numbers.vsLastYear` (span from `numbers.lastYearSpan`, i.e.
  `orgTime.samePointLastYear`).** This period so far against the same days last year, both halves the `gifts`
  source. Home's Why and What line, the season card, Fundraising's Raised tile (`period.compare`) and the
  Board read it, and each sentence says it compares the same days. Fundraising once compared the year so far
  with all of last year beside Home's same-point figure. (HARDEN-1)
- **An event's "raised" is received + pledged for its year, said both ways: `numbers.eventsRaised` (HOME-3).**
  "Finding Joy Dinner: $124,290 raised ($45,340 received, $78,950 pledged)". Received is `event-received`, pledged
  is `event-pledged` (unpaid installments due before the event's first anniversary), raised is `event-raised` (both,
  one list); installments due later are said apart (`later: true`), never added. The event card and page, the first
  look and Reports' giving summary read it and draw it with `EventRaised.jsx`. A figure that counts gifts only says
  "received". Fundraising's "Are we on pace?" leads with `numbers.vsLastYear` (received), splits pledges "due this
  year (`pledges-due`) · over all years (`pledges-open`)", drops the grant clause for an org with no grants and hides
  "Pledged and paid" at $0. (HOME-3)
- **Home's file line reads live counts.** `/move`'s `homeLine` counts the onboarding card's people and gifts
  now, never the move runs' stored counters. (HARDEN-1)
- **Every surface agrees, and a suite proves it.** `tests/lib/surfacesAgree.js assertSurfacesAgree(orgId, ctx)`
  asks every place that shows people or money and lists each disagreement; suites call it after imports,
  deletes, undos and merges. (HARDEN-1)
- **Retention has three definitions, each a ratio whose halves open.** Calendar year (`retention`),
  fiscal year and rolling 12 months (`retention-window`). The dashboard says which one is showing. (PARITY-1)
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
  The note sits in the Thread header (`.thread-note`). Below 1100px the header, then the rail, then the work. Cards inside the panel
  draw no edge (`.home-block`). The board keeps real cards. (BUILD-89)
- **Home's header is the greeting, the day and Ask (HOME-TIDY).** Under the greeting, one box asks a
  question or tells Steward what to do (`AskHero`: a question opens the Why/What rail, anything else goes to
  Agent), over the two doors, Why and What, each with its grey line. Agent's input lives there, not as a
  section. The header renders once: in the work column on a wide screen, above the stacked panel on a phone
  (`homeWide`), so Ask is always under the greeting. The meeting prompt and the Thread's first thing sit at
  the top of the Today rail; the day is not repeated there. Calls to make shows three people, the Thread
  and Drift the first five; the rest open in place, and the Thread and Drift lists each fold away from a
  chevron by their title (remembered in that browser, `steward_home_fold`). Institutional givers are gold
  links to their records. List actions are outlines or text.
- **Home's lead slot is decided by `shared/homeLead.js` and read by `GET /home/lead` (HOME-2).** The frame never
  moves: the day, Ask, the Thread, the rail and the floating mic. Under Ask sit at most two cards, one per kind
  (meeting, gift, confirm, drift, card, season, seasonCall, event), ranked by named points: STAKES against the org's
  p90 line, TIME, UNUSUAL. The score never reaches the screen. Below the floor (15) the lead is the quiet card, so it
  is never empty. A director (admin) reads the org; anyone else reads the people assigned to them and their own
  calendar. Why and What show only when this year is 5% and $500 off last year at the same point; otherwise they
  fold into Ask's "Try:" questions. The rail orders its own five blocks (`rail`). "Not now" stores a row in
  `home_lead_dismissals`: the card stays aside that day, and three of a kind in 90 days halve that kind for that
  person only. A gift the person entered themself is not news to them and never leads their Home. `?at=` pins the
  read in TEST_MODE only (tests/home2-living).
- **The gift-to-thank-you tile is first in the Today rail's resting view** (CAPTURE-1, approved from the mockup). It
  reads `/thank-yous/clock`, the same number as Acknowledgments, shown exact so it foots with its rows; it draws nothing
  for an org with no thanked gift and no card waiting.
- **The Today rail has two states and is never empty.** At rest it shows three numbers side by side, each
  definition on the label's "?" (the profile tiles' keyboard-reachable convention, BUILD-100). A number opens its
  list and a row opens the donor, so every tile goes somewhere. No tab strip. (BUILD-89, BUILD-88d)
- **A Thread row has Drift's shape.** It shows a face, then a wrapping sentence ending "Next: <step>"
  (`lowerFirst`), then one fact on the right: how late it is. Use `min-height:64px`, never a fixed height.
  The person's NAME is the real `<a href="/donors/:id">` and the row opens through `rowClick`, so
  what opened the thread, the step and anything the words name can be links too. (FIX 2026-09-18, BUILD-89, THREAD-2)
- **Every name is a link (THREAD-2).** A Thread item carries `refs` (and `stepRef`); render a sentence
  with `Linked`/`RefLink`, and build a link in an email with `shared/itemLinks.js`, never by hand. A new
  item type gets links by carrying refs. A name never prints blank, "null" or "Unknown" (`nameOrFallback`).
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
  SCALE-2: the gift-derived half of each person's answer (the assessment, yesterday's state, the recent-pledge
  marker) is stored in `donor_drift` for one org day and read from there; a statement trigger on `gifts` deletes
  the rows of everyone a write touched, the after-change step recomputes them at once, and `refreshStoredDrift`
  recomputes an org for its new day. Flags, subscriptions, open pledges and last contact are still read live.
  `assessment` is TEXT so it reads back in the order it was written; `DRIFT_STORE_OFF=1` computes everything.
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
- **The org goal bar counts the Raised card's gifts.** On Fundraising, a `total_raised` goal with no campaign shows the
  same figure as "Raised · FY" (one query, `curRows`), paced over that year, and says so under the bar. A label that is
  only the amount is not shown as a name, and no pace badge rides a bar at $0. (FIX-34)
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
- **A saved dashboard is tiles she picked, and a tile is a DECLARATION, never SQL (`shared/boardPack.js`).** One of
  three kinds, each already in the product: a `figure` (a `figureSources.js` source name), the one `chart`
  (`givingByMonth`), or a `list` (a standard or saved report, run through `savedReportFor`/`runSaved`). A kind,
  chart or source the registry does not hold is refused by `validateDashboard`. They live in the Dashboards group
  of the one rail, prefixed `sdash:`, beside the board pack and the tile picker: no second list, no new button. (REPORTS-3)
- **A dashboard's filters are authoritative and a tile's own params are the fallback.** `from`/`to`/`fund`/
  `campaign`/`owner` save with the dashboard and live in the URL. A filter a tile's source cannot honour is SAID on
  the tile (`ignoredFilterSentence`), never silently dropped under a heading that claims it was narrowed. (REPORTS-3)
- **ONE tile's failure costs that tile.** A source that cannot be read, a report that no longer exists, a chart
  that will not compute: each becomes a `missing` section where it sits and the rest of the dashboard still draws.
  It used to throw out of the composition and take the whole screen down. (REPORTS-3)
- **The board pack is ONE composition (`composeBoardPack`), and the PDF is drawn from it.** The screen and the
  paper read the same object, so a number cannot be one thing on one and another on the other. Its definitions are
  written in `shared/boardPack.js` for an ARBITRARY period and are deliberately NOT borrowed from
  `shared/dashboards.js`, whose sentences are written for the fiscal year: printing "since the first day of your
  fiscal year" over a quarter's number is the one thing the definitions page exists to prevent. (REPORTS-3)
- **A board pack goes to the org's own `board_pack_emails`, and the server refuses an address on file as a donor.**
  Staff and board, never donors. The schedule is one row per org, OFF until somebody turns it on, monthly or
  quarterly on a day between 1 and 28 (29 to 31 do not exist in every month), reporting on the last COMPLETE
  period through `orgPeriodBounds(org, period, -1)`. It reserves `board_pack_sends` before the first send and
  releases it when nothing was accepted, and rides the existing 5-minute tick. "Send a test to me" goes to the
  caller alone and reserves nothing. (REPORTS-3)
- **A figure still loading is a skeleton, never a 0; a read that failed is a dash.** Home's rail starts
  at `null`, not `||0`. (FIX-27)
- **A campaign has a page, and its list and page are on the census.** `CampaignsList.jsx` is in
  FIGURE_SOURCE_SCOPE, and `fix2-a-footing` runs that census. (FIX-27)

- **Every dated thing in Steward is on the Calendar.** A new kind of dated row joins `TYPES` in
  calendar.js in the same build, or it is not on the calendar (`tests/fix28-calendar-rule.test.js`).
  A person's own items (deadlines, steps, tasks, journey steps) go to her connected Google or Outlook
  calendar only when she turns it on (`push_dates`), one way, all-day, no attendees. (FIX-28)
- **The calendar reads; each item's own route writes.** `GET /calendar/items` never changes anything, and a
  drag is `shared/calendarMoves.js`'s request to the item's own route, so it is that route's one audit write;
  Undo is the same route with the old values through `offerUndo({ undoAction, message })`. Add a type to the
  calendar by adding its read to `calendar.js` and, if it can move, its route to `moveRequest`. (CAL-1)

- **A booked meeting changes the record, through `meetingEffects.js` only (FIX-33).** Next step = the meeting
  (an open step is taken over and given back on cancel or after the meeting is logged), a prep task the business
  day before, an after task on the day, timeline lines for booked / moved / cancelled, journey steps within three
  days moved to the business day after, and "Meeting set for 16 Oct" on the status line and drift rows. Moving or
  cancelling on either side (Steward or the synced calendar) goes through `applyMeeting` / `revertMeeting`.
  `meeting_effects` is the receipt and is in the merge's MERGE_REFS.

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
- **A RATIO source has no `measure` function.** `retention`, `giving-change` and `giving-difference` are computed
  from their two parts, so `sDef.measure(p)` throws on one. Ask `tileFigureKind` what kind of number a source
  makes. The default board pack is all sums and counts, so no server test saw this; the seeded dashboard's
  retention tile crashed the whole screen on the first browser open. (REPORTS-3)
- **A screen that swaps itself for a spinner while loading unmounts the control being typed in.** The saved
  dashboard returned a bare `<Spin/>` on every filter change, which destroyed the date input mid-keystroke: the
  filters could not be typed at all. Keep the header and filter bar mounted and dim only what is reloading. (REPORTS-3)
- **An uncompressed pdfkit PDF writes text as a KERNED array (`[<hex> -20 <hex>] TJ`), not as `(…) Tj`.** A reader
  that looks only for the second form returns nothing, and every "is this printed" assertion then passes
  vacuously. Assert the reader can tell two near-identical numbers apart before trusting anything it says, and
  pin a number to its own LABEL: "somewhere on the page" was satisfied by a coincidentally equal total elsewhere
  in the document and caught only one of six planted defects. (REPORTS-3)
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
- `shared/boardPack.js` — the pack's sections, the tile kinds, the schedule rules · routes/crm.js
  `composeBoardPack`/`renderBoardPackPdf`/`runBoardPackScheduleForOrg` · `client/src/components/SavedDashboards.jsx`

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

## The two scores (ENGAGE-1)

- Engagement and generosity are computed only by `engagement.js` from the weights in
  `shared/engagementWeights.js`, stored in `donor_scores`, and recomputed on the six-hour tick and a
  few seconds after any write to a person, gift, conversation, event, shift or meeting.
- A score's parts always add to the score (largest remainder), and each part opens the rows it
  counted (`donor-engagement-part`, `donor-generosity-part`). Change a weight and its sentence together.
- Never from wealth or capacity data. No "hot" labels: a number, Close / Warm / Distant, and the reason.
- "Asked this year" means an `ask`/`solicitation` interaction, or a proposal opened or moved, since 1 January.
- **Things that need a person open a step through two seams.** `openCareThread(orgId, donorId, {label,
  dueInDays, path})` for a person (a lapsed membership, a missed shift, a won auction item not paid after
  two days), owned by the person's owner; `openAdminTask(orgId, {title})` for the office (a peer-to-peer
  page awaiting approval, an import's new duplicates, a giving source gone quiet), one open task per title.
  Both only write a row. The calendar shows memberships ending, auctions closing and campaign and page end
  dates, and a journey step or deadline that opened a Thread step shows once, not twice. (WIRE-1)

## REPORTS-4 · a report's numbers are its sources' numbers (2026-10-07)

- A report never states a number it computed itself. It names each figure's source in `reportFigures`
  (routes/crm.js), which returns the value, the source and the sentence, and the screen draws a `<Figure>` from it.
- Footing has ONE rule, `figureSources.footCheck`: a sum to the cent, a count to the row, a mean as total over count,
  a median as the middle row, a percentage through its two halves. `tests/reports4-foot.test.js` walks every
  figure a report response carries (any `source`, any `figures` map, and the `*Source` / `*_source` fields) and
  checks it foots AND is the number on screen. A new report figure is covered the day it carries a source.
- Every figure's rows can leave the drawer as a CSV or a static Group (`KeepRows` in MetricBreakdownPanel.jsx).
- Every tile and inline figure has a "?" (`FigureWhy` in Figure.jsx). Table cells do not; their drawer opens on the
  sentence.
- Still bare, with their builds, in `docs/reports-4/figures.md`.


## THREAD-3 · what opens a step on its own (2026-10-07)

- **A donor's email that needs a reply.** Only mail logged from a connected mailbox, from a person on file, of kind
  `personal` (`mailKind` in shared/mailboxLog.js), from the last 14 days, with no reply one business day after it
  arrived. A reply is an outbound email, or a call, meeting or email logged by a person, written after the email and dated
  on or after its day (imported history written today is not a reply). One step per person; a task when a step is open.
  `mail_reply_steps` claims each email once.
- **An event's no-shows are one task per event**, never one per person (`openNoShowTask`, unique on `tasks.event_id`),
  with a "Missed you at" draft per person with an email in Drafts. Nothing is sent.
- **The calendar never shows one entry per plan.** Monthly gifts are one line a day from Stripe's `current_period_end`
  forward; a plan with no date is left off, never guessed. Failed charges and cards expiring this month show one by one.
- **No history yet is not cold.** A person with no conversation, note or meeting on file (gift lines do not count)
  reads "No history yet" on the profile, never "Engagement 0, Distant", and Home's "no recent contact" list skips
  them. `NOT_HISTORY_TYPES` in routes/crm.js is the one list of interaction types that are not history. (IMPORT-2)
- **Calls to make skips no phone calls**, as well as deceased, do not contact and anonymous. It does NOT skip do not solicit: every row is a thank-you call, and thanking is not asking. Asking lists, appeals, Drift's re-engagement asks and the asking starters still leave do not solicit out (`solicitableSql`). (IMPORT-2, corrected by FIX-35)

## LIVE-1 · what an import told us, and what Steward learned (2026-10-12)

- A readout (`readout.js`, table `readouts`) is written when an import is recorded, a giving-source read
  finishes or a QuickBooks read is saved. Lines: came back, biggest ever, more than last year, new donors
  and new above the median, recurring started and stopped, now late for their own rhythm, crossed into a
  group, data problems. A line with a zero is not written. Each count is a `readout-line` figure that opens
  exactly its people; each line has a one-sentence Why naming the rows and the rule; each has one action.
- Lines about gifts read the person's whole history, including older gifts the same file brought, and
  only gifts dated in the last 90 days count as news. "Now late" never names someone new in that file.
- An action makes the real thing: tasks for today (thank personally, call, add to calls), thank-you
  drafts (only for gifts from the last 30 days: FIX-36's rule holds behind every button), or it opens the
  group or Data health. Nothing reaches a donor.
- Three dismissals of a kind in a row, with nothing done about it in between, move it to the bottom and
  the page says why; "Put it back" restores it. What worked counts gifts within 60 days after an action
  and says "gave after", never "because".
- The newest readout of the last 7 days is one row on the Thread (the stopped-card row's shape, no Done);
  the morning email has "What yesterday told us"; the Agent's context and Ask read the same rows.

## RECONCILE-1 · an old report is checked, never trusted or added in (2026-10-15)

- `reconcile.js` is the one check of an imported report against Steward. It reads only through
  figureSources, so each Steward figure it shows is a source that opens and foots.
- A reason for a difference is said only when it is computed from rows; whatever is left over is
  "Steward can't tell why", with the rows on each side. Never a guess, never the AI.
- An old report stands in for a comparison (giving summary, Board, board pack, Goals) only after
  "Use as last year's total" (`old_report_baselines`). Shown beside Steward's number, it needs no click.
- No step of the check, and no fix-it, writes a gift. Adding a missing person writes a person.
- Checkable kinds and the reason for each that is not are `CHECKABLE` / `NOT_CHECKABLE` in reconcile.js.


## HOME-3 · greeting first, then one move at a time (2026-10-28)

- Nothing renders above Home's greeting except the trial banner: org and greeting, the date, the pace sentence, Ask, then Your moves. On a phone: greeting, tabs, the card, then Today.
- Pace is said once, in the greeting, from `numbers.vsLastYear` over the org's fiscal year (`shared/homeLead.js paceLine`). The insights engine has no pace card. `assertSurfacesAgree` compares Home's greeting with the Board and Fundraising.
- The deck is `insights.js buildDeck`: Keep (year-end, pledges, sponsors, lapsing), Grow (second gift, moving up), Major, Planned. One person, one move (the highest-value one; Planned never outranks money); the rest are "also" lines. Planned counts people.
- A move's button makes a task dated for its window (kind write, call or meeting) with the line and the ask in its notes, and records Done. Home never sends.
- Sentences treat one giver's gifts on one day as one gift (`giftDays`). Planned excludes organisations, foundations, companies and funds.

## HOME-4 · the rail, the bottom and setup (2026-10-28)

- The rail draws once, whole: its reads are `lib/homeReads.js RAIL_READS`, asked for in their own bundle at the same moment as the deck's, and nothing in the rail starts a read after Home's first paint (perf-app checks it). Until then `HomeRailSkeleton` holds its shape.
- Today is one card that never shows a zero ("Nothing due today." when nothing is); Calls to make shows three then "See all N", named by what it holds; To confirm is one line. On a wide screen the rail is sticky; the app root uses `overflow-x: clip`, never `hidden`, or sticky breaks.
- Under the deck: one row of chips (`MoveChips`), each hidden at zero. The Thread draws on Home only when it has rows. Home has no Drift section: `insights.js withDrift` puts every person GET /drift lists (early signs too) into the deck, and the Drift chip opens Drift on the Donors page.
- Setup: `HomeSetup.jsx setupStage` places it: "first" (under Ask) for a new org, "rail" mid-way or after "I'll finish later", nothing when done or dismissed.
- Home reads `/insights?view=deck` (the deck, no cards); panels read the cards when they open.


## IMPORT-5 · the guests who came and didn't give (2026-10-29)

- Who came and gave, who came and didn't, and who was invited and didn't come are one answer: `numbers.eventGuests`
  (predicate `figureSources.EVENT_GUEST_GAVE`, source `event-guests`). A guest gave when a gift (the event's own gift
  match) or a pledge is tied to the event for them or anyone in their household. The event page, Home and Ask read it.
- Home: each guest who came to an event in the last 120 days and didn't give is a Grow move ("Came to the {event} on
  {date} and didn't give. Thank them for coming."), no ask on the first touch, the action a thank-you-for-coming task
  with the note drafted. One person, one move (otherwise an "also" line). "See all N" opens the event page. Grow draws
  150 cards by dollars, so $0 thank-yous can sit past the cap, still counted on the tab.
