# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## One home for every giving number (NUMBERS-3, 1 Nov 2026)

- **P3 · Two gifts on one day from one import pick the "last" one by random id.** An import writes its rows with one `created_at`, so `LAST_GIFT_ORDER` (date, created_at, id) falls to the gift's random id: OAKVILLE Foundation's two gifts of 16 Dec 2025 ($20,000 and $5,000) show either as the Last gift, run to run. Seen on the real-shaped before-and-after capture. Suggested: the next imports build stamps each row's file position (or `created_at` plus its row number) so the later row is the last.
- **P3 · Not moved in NUMBERS-3's five hours:** MAP-1 §2's remaining by-luck copies of lifetime (`insights.js` units, `why.js`, `engagement.js` generosity, `prospectBrief.js`, `/donors/:id/fund-affinity`), this year (the AI board report's calendar year), last gift (`routes/why.js`, `/impact`, `shared/lostAndFound.js`, `setup.js`), first-time (`askEngine` uses the shared rule now; `callsToMake.js`, `groups.firstGiftFrom`) and retained (the AI board report SQL, `insights.js`). Each still agrees with the shared module on data without credit rows or refunds. The client's Reports year picker (`Reports.jsx` `fyOf`) is the one fiscal-year line left on the ratchet. Suggested: NUMBERS-4, file by file, with `route-gift-sql` going down each time.
- **P3 · `xeroSync.js` sends credit rows** (MAP-1 §12); QuickBooks now leaves them out (`shared/numbers/money.js`). Suggested: the next bookkeeping build reads the same predicate.

## Home and Atlas (SWEEP-1, 31 Oct 2026; walk in docs/sweeps/sweep-1/walk.md)

- **P2 · A business with no business word in its name is greeted by a first name.** "Redshaw Holville Wine Spirits" (kept as a person) reads "Hi Redshaw,"; `isPersonUnit` (insights.js) and `shared/greeting.js` know a business by its record's kind or a word like Inc, LLC, Bank, Club. Suggested: the people sweep offers "this looks like an organisation" on import and in Data health, so the kind is right at the source.
- **P3 · Home's right rail is mostly empty at 1440.** Today, Owners, Snap a check and one sentence beside a 2,000 px main column. Suggested: the next Home build moves the thank-yous or the chips into the rail.
- **P3 · An empty org is offered Import three times above the fold** (the setup card's Next, its Import row, Your moves' Import a spreadsheet). Suggested: the next Home build lets Your moves' empty card stand alone while the setup card is open.
- **P3 · Phone: the mic button sits over the setup card's "Set up →".** Suggested: the next phone build gives the floating button a gutter Home's cards respect.
- **P3 · "Answer ready" sits above a refusal** ("There's no fund … called …", "Steward can't answer that one yet."). Suggested: the next Ask build labels a refusal as one.

## Donors, Data health and imports (SWEEP-2, 31 Oct 2026; walk in docs/sweeps/sweep-2/walk.md)

- **P3 · On a phone the Donors toolbar fills the first screen.** Two chips, search, four view tabs, Log a call, + Add, Import & tools, five selects and three buttons come before the first donor at 390, and "Re-engage" breaks as "Re- / engage". Suggested: the people sweep folds the selects behind one Filters button on a phone, as Team and Data health already do.

## Staff mail (STAFF-MAIL-1, 30 Oct 2026; walk of Settings → My email and the morning email)

- **P2 · The morning email's date line reads "2026-10-31".** `renderMorningBriefBody` (server.js) prints `today` as the raw ISO string beside the person's name ("Wren Walker · 2026-10-31"), where every other screen shows a written date. Seen on the walk's 9 AM send. Suggested: the next staff-mail or Settings sweep, through `shared/displayDate.js`.

## Home (suggestion from Jonathan, 31 Oct 2026, raised during STAFF-MAIL-2; SWEEP-1 owns Home)

- **P3 · Home's Set up Steward card in the right rail opens closed.** Jonathan wants its steps shown by default (each step with its sentence and action, as in his screenshot of Justin's Place), closing only when the person clicks Hide the steps, and staying closed for them after that. Today `SetupRailCard` (client/src/components/HomeSetup.jsx) starts with `useState(false)`, so it shows "Show all steps". `tests/smoke-walk.test.js` §home-4 pins "Show all steps" and would change with it. Suggested: SWEEP-1.

## Days cut at the database's midnight (ARCH-1, 31 Oct 2026)

- **P2 · Some windows still cut the day at the database's midnight (UTC on prod), not the org's.** ARCH-1 put the org's midnight in one seam (`orgTime.orgDayWindowSql`) and moved the figure sources, Fundraising's started-not-finished list, the monthly-giving month, the mail-type and privacy counts, and the officer, pipeline and audit-log windows onto it. Not yet moved, each a timestamp or `CURRENT_DATE` read as a day: the rolling "last N days" lookbacks in routes/crm.js (`?::date - ?::int`, the thread-event finders near 13635–13773, and `CURRENT_DATE - ${days}` near 14725), `goingOut.js:127`, `qboSync.js:787`, routes/give.js:613, 5177, 5189, the `CURRENT_DATE` windows in routes/finance.js (135, 254, 301, 352, 376, 413, 1502), routes/surveys.js:190, 193, routes/volunteerScheduling.js:393, 449, groups.js:529, server.js:5076, 5086, and the task trigger in db.js:8650; Settings › Admin metrics (routes/billing.js:2428) reads the server's month for Steward's own figures. Each is off by up to a day between 8 PM and midnight in New York. Suggested: the next tests-and-CI or numbers build moves them through the same seam, with this list (the old `scripts/build72-date-audit.js` was removed by ARCH-1; `git show 1ef9b5f:scripts/build72-date-audit.js`).

## The house rules (ARCH-1, 1 Nov 2026)

- **P3 · Nothing schedules `sweepQuietConnections`** (server.js, near 2259); `POST /connections/sweep` is the only way it runs, and nothing calls that. Suggested: the next integrations build either schedules it on the tick or removes both.
- **P3 · `GET /pos/attendance-drift` has no caller,** yet `scripts/seed-demo.js` seeds a fixture for it. Kept under amendment A1 (no deletion without Jonathan's yes); listed in `docs/architecture/routes-reviewed.md`. Suggested: the events build that next touches POS.


## Communications (SWEEP-3, 30 Oct 2026; walk in docs/sweeps/sweep-3/walk.md)

- **P1 · A campaign reaches only people set to Always include, even with Campaign emails on for Everyone.** `donorMailDecision` (routes/email.js) refuses kind `campaign` unless `donors.auto_email` is true (SEND-GATE-1), while SEND-GATE-2's rule for a type set to Everyone is "anyone not set to Never". On the walk org with Donor mail and Campaign emails on for Everyone the builder still said "315 donors · 0 can get this email: 247 have no email address, 68 have automatic email off". Who a campaign reaches is a sending rule, so it needs Jonathan's word on which rule is meant, then the real-shaped check and the truth check. Suggested: SEND-GATE-3.
- **P2 · A campaign merge with no gift reads "your gift of your previous gift".** `legacyCampaignBody` (server.js) fills `{{gift_amount}}` with "your previous gift" for someone with no gift, and the Thank-you starter says "Thank you for your gift of {{gift_amount}}". The preview now shows a real giver's gift; the send's fallback is a send change. Suggested: SEND-GATE-3, with the starter's sentence.
- **P3 · Thank-yous and welcomes sign differently.** The one-person thank-yous sign with the org's name when nobody has a signature in My profile or Brand; the designed welcomes sign with the sender's account name. Suggested: the next editor build picks one rule.
- **P3 · Quick edit and print previews the top giver; the email editor previews the newest giver.** Same template, two people. Suggested: the next editor build.
- **P3 · "Use Eastern Daylight Time (America/New_York)".** The Sequences timezone button shows the zone's database name (`zoneLabel`, shared with Settings). Suggested: the Settings sweep.
- **P3 · The Journey emails switch sits flush to the card's left edge** on an open journey. Suggested: the next Journeys build.
- **P3 · Campaign list subjects outside the builder still use the sample "Margaret".** `subjectPreview` in the legacy sequence preview (Communications.jsx) has no donor to fill. Suggested: the next editor build.

## Events and pledges (SWEEP-4, 29 Oct 2026; walk in docs/sweeps/sweep-4/walk.md)

- **P3 · The open-pledge banner and the Next move repeat each other.** Both list the same installments on the profile. Suggested: the people sweep.


## Finance, Reports, Grants (SWEEP-5, 29 Oct 2026; walk in docs/sweeps/sweep-5/walk.md)

- **P3 · Budgets' revenue variance reads backwards and in red.** Variance is budget − actual for both sections, so revenue ahead of a $0 budget reads "-$1,750" in red and revenue $39,250 short reads "+$39,250"; "over budget" and an over line are red, which is for a destructive confirm only (overdue is brass). Found by FIX-60's walk. Suggested: FIN-2.
- **P3 · Budgets' projected year-end straight-lines a one-off.** One $1,200 expense in month 3 of a fiscal year projects to $3,600 "over budget". Found by FIX-60's walk. Suggested: FIN-2.
- **P3 · Grants · Reports: "AWARDED, FY 2026–27" broke across two lines at 1440.** Sentence case shortened it and neither walk org had a grant to draw it after the fix. Suggested: the next Grants build looks with a grant on file.
- **P3 · Phone, Reports: the rail is a select.** Each report opens by its own URL on a phone and costs 0.6 to 1.7 s locally; not throttled to slow 4G in this walk. Suggested: PERF-3 measures Reports at 390 on slow 4G.

## Home on a phone (PERF-2, 1 Nov 2026)

- **P2 · Home phone 3.5 s vs 3 s bar.** PERF-2 took Home on a phone (390, slow 4G) from 4.4 s (real-shaped) and 4.7 s (messy-25k) to 3.4 to 3.5 s; perf-app measured 3,537 ms and its phone budget is now 3.64 s (that plus 0.1 s, so it cannot regress). What is left on the waterfall: the document lands at 0.6 s; the entry's scripts (react-dom 62 KB, main 16 KB) finish at 1.6 to 2.4 s, sharing the 1.4 Mbps link with App's chunk (80 KB, Dashboard.jsx at 108 KB raw), the shared components (25 KB) and nine smaller chunks, 214 KB of JavaScript in all, and the two fonts (56 KB, done at 3.3 s); the reads, started by the preloader, are in by 1.7 s and wait on nothing; first paint is at 3.0 to 3.3 s and the rail is ready about 0.4 s later, parse and render at the phone's 4x CPU. On the local preview (HTTP/1.1, six connections) each of the 13 first-look scripts also waits its turn; over HTTP/2, as Vercel serves it, the same build measured 3.4 s. Suggested: a Home build that splits Dashboard.jsx (the board surface, edit mode, the rail's drill-downs) so Home's first look is its own chunk, then lowers the budget to 3 s.
- **P3 · A Grow move's draft greets "Dear Dr.,".** On messy-25k (Eugene Ramirez, Grow · Second gift) the suggested note opens "Dear Dr., your first gift in June 2026 is already at work"; the greeting takes the honorific as the name. Seen on PERF-2's walk at 1440; the same on main. Suggested: the next Insights build greets by the first name (shared/greeting.js) and never by a title alone.
- **P3 · The Planned tab reads "Planned · 3,417 / 150 people".** The count is every planned move and the line under it is how many the deck carries (its first 150), so the two numbers disagree on one tab. Seen on PERF-2's walk on messy-25k (on real-shaped "Planned · 2 / 2 people"); the same on main. Suggested: the next Insights build says the tab's own people count, as the other tabs say their own "at stake".
- **P1 · numbers1-foot's random sequences break "Donor since" on seed 695574508** (sequence 146 of 500, step 5: the profile roles line, lifecycle tags, Donors filters and groups disagree with the rule that the first gift is the earlier of the first gift on file and the old system's). Found by PERF-2's battery; the same seed fails the same way on main (620cc4c), and other seeds pass. Replay: `NUMBERS1_SEED=695574508 node tests/numbers1-foot.test.js`. Suggested: the next numbers build.
- **P1 · A 25,000-person workbook in one import request did not finish.** The workbook path (`WorkbookImport.jsx` posts every person in one `/donors/import-combined`) ran `KEEP_IMPORTED_TOTAL` (`donorSummary.js`, `d.id = ANY($2)` over 25,034 ids, self-joined) for over 15 minutes before PERF-2 cancelled it on its scratch database; the same file in requests of 1,000 people took 32 seconds. Suggested: the next imports build batches that statement (or the request) and adds messy-25k to an import budget.
- **P3 · `/donors/counts` is Home's slowest read on messy-25k (150 ms):** one query that works out every person's status (`donorStatus.statusSql`) to count the lapsed. Suggested: the numbers build reads the stored status.
- **P3 · `/org` answers `SELECT *`** (the house rule: never into a response); it is one of the app's seven boot reads. Suggested: the next accounts build names its columns.

## Giving pages, the donor side and the phone (SWEEP-6, 30 Oct 2026; walk in docs/sweeps/sweep-6/walk.md)

- **P2 · Recurring paints a failed card red.** Terracotta text on a pink Needs recovery band, and "failed recently" in terracotta; the four-colour rule keeps red for a destructive confirm. Suggested: the recurring build, brass as overdue is.
- **P3 · Year-end pages made before SWEEP-6 still promise a receipt.** The template's thank-you said "Your receipt is on its way to your inbox"; new pages no longer do, but a page already made keeps its words (her words now, and no row changes at deploy). Suggested: the editor shows a note beside a thank-you that mentions a receipt when the org's receipts are off.
- **P3 · A new giving page is live at its link before Publish.** The words now say so; nothing lists it. Suggested: EDITOR-2 decides whether a never-published page answers "Not open yet".
- **P3 · Stripe is said twice on the giving form** (under the button and in the trust panel), and the org's name three times above it. The footer sentence lives in the form every layout shares. Suggested: GIVE-4 drops the footer line where the trust panel is drawn.
- **P3 · "Card updated, thank you!" shows for anyone who adds `?card_updated=true`.** Suggested: GIVE-4 reads the setup session as the event thanks page reads its own.
- **P3 · The donor portal, switched off, says only "This page isn't available."** No name and no way to give. Suggested: the portal build points to the org's giving page.
- **P3 · /giving sign-in says "Your Giving" in capitals.** Suggested: the donor-network build.
- **P3 · Profile at 390: "Log a call" wraps to three lines and the status chips and "+" are 20–29 px.** Suggested: PROFILE-2.
- **P3 · The Thread's "Nov 1 / Due on" puts the date above its own label.** Suggested: the next Home build.
- **P3 · ACH was not walked end to end.** Stripe's own page and the days-later settlement cannot be driven on a stub; the Steward side is the card's webhook path. Suggested: a test-mode walk on the Stripe sandbox when one is set up for Steward.
