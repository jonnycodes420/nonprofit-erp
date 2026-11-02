# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## One rule per donor label (NUMBERS-4, 1 Nov 2026)

- **P1 · "Import a spreadsheet" misreads the 25,000-person workbook.** The recommended door (Donors, Import & tools, the adaptive reader, `/sheet-import/understand`) refuses messy-25k outright ("That request body is too large": its routes sit under the 5 MB default, where the other import routes have 64 MB). Given 64 MB (tried on NUMBERS-4's walk, then taken back, because a wrong reading that can be imported is worse than a refusal) it reads the file in 5 s, but as "A list of people with no gifts: Donors, 19,998 rows", 1,101 people with 18,867 rows set aside, and none of the gift sheets; the workbook screen (`WorkbookImport.jsx`, BUILD-82) reads the same file as 25,034 people and 90,523 gifts and imports it in under a minute. The menu sends this file to the adaptive reader, so the workbook screen is not reachable for it from Donors. Seen on NUMBERS-4's walk. Suggested: the next imports build makes the adaptive reader hand a multi-sheet workbook it cannot read to the workbook screen (or read its sheets), with messy-25k as the case.
- **P2 · 50 money totals a person sees still count credit rows (or ignore refunds), and 2 more use `GIFT()` where a total wants `MONEY()`.** `docs/architecture/money-sums.md` lists every one by file and line, in the order to move them ("For NUMBERS-5": donor-facing first, then Home, Reports and the figure sources). NUMBERS-4 moved 43 of the 93 it found (a pledge's paid is `shared/numbers/pledges.js` in 17 places; the portal, the account page's tax summary, Home's season figures, the Donors list's This year, groups' "gave more", Ask's gift entity and Ask why's sums read `money.js`). Suggested: NUMBERS-5, the route-gift-sql ratchet (now all server code, 362 lines) going down with each.
- **P3 · A rising donor's ask can still differ between Home and the profile.** `shared/numbers/ask.js` is one rule for both, but the profile holds a rising donor at their own level when Room to give is not yet known, and Home's cards step up (SWEEP-1 §6 pins the card's step). On real-shaped gift history 3 of 93 one-person moves differ (Toris Brookworth: Home $250, profile $200). Suggested: the next Home build reads Room to give per giving unit and holds the same way.
- **P3 · The first gift on a tie is still picked by random id.** Two gifts on a person's first day from one import read either as their First gift, run to run (real-shaped gift history: Belley Wilah $125 or $500). NUMBERS-4 gave it the last gift's order (recorded first, then the row on file) and import4-layers §9 then disagreed with the checker's key on one person by $100 against $500; with no time left to find why, the order went back to main's (date, then id). Suggested: NUMBERS-5, with that suite's person as the case.
- **P3 · `shared/reportBuilder.js` counts a credit row as paying a pledge** (its Paid and Still to come fields). It is an ES module the client bundles, so it cannot read `shared/numbers/pledges.js` (CommonJS). Suggested: NUMBERS-5 serves the builder's pledge fields from the server, or makes `shared/numbers` loadable by both.
- **P3 · `shared/lostAndFound.js` works out the last gift itself** (latest dated gift above zero), in the browser, on a file Steward never stores. It agrees with `lastGift.js` except for credit rows, which an uploaded file does not type. Suggested: the build that bundles `shared/numbers` for the browser.
- **P3 · Insights' retained and first-time stats are their own rule** (`insights.js` `retainedFromPrior`, `firstTime`): per giving unit and calendar years cut at the file's last gift, which `retained.js` and `firstGift.js` cannot yet say. Suggested: NUMBERS-5 gives `retained.js` a unit grouping and an as-of day.
- **P3 · `/donors/counts` total counts sample people.** `shared/numbers/households.js` says people are not deleted and not sample; the counts endpoint feeds the welcome and sample-data screens, which read the total to know data is there, so it was left. Suggested: the onboarding build gives those screens their own "has data" read and the total moves to `households.counts`.

## The battery as parallel jobs (CI-2, 1 Nov 2026)

- **P1? · Any org's admin running `POST /sequences/process` makes an active "at risk" sequence in every org.** `autoEnroll` (server.js) calls `ensureAtRiskSequence`, which loops over `SELECT id FROM orgs` and inserts an `active` at_risk sequence in each org that has none, demo orgs included. A write in other orgs from one org's request, and an active sending sequence nobody in that org turned on. Found by CI-2's shuffled battery: mail-suppression (which calls the route) ran before fix39-campaigns in one shard, the demo org got the sequence, and fix39's browser leg read "⏸ Pause" on Sequences (an emoji in product copy, `Communications.jsx` legacy sequence row). The severity needs Jonathan's read: whether that sequence can reach a donor. Suggested: a SEND-GATE or tenant build scopes the sweep to the caller's org (the hourly job keeps the all-org pass) and creates the sequence off, and the editor build drops the ⏸/▶ glyphs.

## One home for every giving number (NUMBERS-3, 1 Nov 2026)

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
