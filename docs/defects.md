# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## The campaign audience (TRUST-1, 4 Nov 2026)

- **P1 · A campaign from the Thank-you or Year-end starter can't be sent from the editor.** The six campaign starters (`shared/emailTemplates.js`) write `{{gift_amount}}` and `{{total_giving}}`; opened in the block editor (`campaignBlocksFromHtml`), neither is a block field (`EMAIL_MERGE_FIELDS` has `{{last_gift_amount}}` and no lifetime total), so "Checked against" says "{{gift_amount}} is not a field Steward can fill" and Send stays shut. Same on main. The legacy send fills both. Suggested: the next editor build maps `gift_amount` to `last_gift_amount` in `campaignBlocksFromHtml` and adds a lifetime-total block field, with a test that every starter passes preflight.

## The P3 sweep's walk (POLISH-4, 2 Nov 2026)

- **P3 · A person whose earlier gift has no date reads "Donor since 2026 · New" after one dated gift.** Noren Pemland (Insights fixture): a $5,000 gift with no date, then $250 today, and About says "New: gave once this fiscal year". The undated gift counts in Lifetime but not as giving before (the undated rule), so the lifecycle reads New. Suggested: NUMBERS-5 decides whether an undated gift is "giving before" for New and Donor since.
- **P3 · Compare and merge says "1 linked record" for a table it has no word for.** `TABLE_WORDS` (DataHealth.jsx) names most tables a merge moves; the rest read "linked record". Suggested: the next Data health build names the rest or leaves internal tables out of the sentence.
- **P3 · "People and their businesses" cannot fire when the organization's record has no address, phone or email.** On the Insights fixture "Noren Pemland Excavating, Inc" has none, so the owner is only linked by hand (which works). Suggested: the people sweep offers "this looks like an organisation" on import, with its contact fields.

## The split screens (SCREENS-1, 2 Nov 2026)

- **P3 · The old import wizard is code nobody can open.** `DonorImport` and `GiftHistoryImport` (now `components/DonorImport.jsx` and `components/import/`, about 3,300 lines) are rendered by no screen: every door opens the one reader (`SpreadsheetImport`), and real-shaped §9 asserts no door renders them. Only `MergeDuplicatesModal`, `parseFileToSheets` and the label helpers (`plainFieldLabel`, `txRoleLabel`, `anyFieldLabel`) are still imported. SCREENS-1 moved them verbatim, as the brief said. Suggested: a PRUNE build deletes the wizard and its steps, keeping those five exports, after a search for any caller.
- **P3 · `components/home/` keeps parts nothing draws.** PERF-3 took out what Dashboard.jsx computed every render and drew nowhere (`goalCardsSection`, `driftSection` and its empty state, `goalDriverHint`, the briefing, the old queue's actions and their state), so App's chunk is 4 KB smaller. The parts themselves (`goalCardsSection` in goalSections.jsx, `driftSection`, `driftEmptyState`, `submitDriftDone` in driftSection.jsx, `MiniEmpty`) are still in their files, with their SCREENS-1 render cases, and nothing calls them; four unused values remain in Dashboard (`queueLoading`, `setDriftSort`, `thankClockLow`, `paceColor`). Suggested: a PRUNE build deletes the parts and their render cases, or a Home build places the goal cards if they were meant to show.

## The 25,000-row sheet walk (IMPORT-7, 3 Nov 2026)

- **P2 · The preview lists every shared phone or email, one line each, with no cap.** "Import a spreadsheet" (`SpreadsheetImport.jsx`, the People layer's notes from `u.placeholders`) printed thousands of "The phone … is on 3 different people" lines for a generated 25,000-row file whose phones repeat. A real file with a shared office number on many rows reads the same way. Suggested: the next imports build shows the first few and a count.
- **P3 · A big Undo's sentence says "0 gifts removed".** On a file of people only, the receipt's Undo reads "Undone. 0 gifts removed and 25,000 people this file created." Suggested: the next imports build leads with what was there.
- **P3 · Settings, Imports dates an evening undo the next day.** An undo at 21:10 EST on 3 Nov reads "Undone Nov 4, 2026" under "Recorded Nov 3, 2026, 9:07 PM": the undone date is read in UTC. Suggested: the next imports build reads it in the org's zone.

## The last money sums (NUMBERS-5, 3 Nov 2026)


- **P3 · A person with only credit rows is on the LYBUNT and SYBUNT lists.** `buntPredicate` (server/reports/handlers.js) and the `bunt` source ask for any gift row last year, a soft or matching credit included, so a credit-only person is listed with $0 given (their dollars are money now, so nothing is overstated). Suggested: the next reports build reads `GIFT()` in both predicates, with the truth check.
- **P3 · Home's cards do not read a screening file for Room to give.** The profile's Suggested ask counts a screening the viewer may see; Home's cards read the person's own file only, so a rising donor known only through a screening steps up on the profile and holds on Home. Suggested: the next Home build passes the screenings the viewer may see.

## One rule per donor label (NUMBERS-4, 1 Nov 2026)

- **P3 · `shared/lostAndFound.js` works out the last gift itself** (latest dated gift above zero), in the browser, on a file Steward never stores. It agrees with `lastGift.js` except for credit rows, which an uploaded file does not type. Suggested: the build that bundles `shared/numbers` for the browser.
- **P3 · Insights' retained and first-time stats are their own rule** (`insights.js` `retainedFromPrior`, `firstTime`): per giving unit and calendar years cut at the file's last gift, which `retained.js` and `firstGift.js` cannot yet say. Suggested: NUMBERS-5 gives `retained.js` a unit grouping and an as-of day.
- **P3 · `/donors/counts` total counts sample people.** `shared/numbers/households.js` says people are not deleted and not sample; the counts endpoint feeds the welcome and sample-data screens, which read the total to know data is there, so it was left. Suggested: the onboarding build gives those screens their own "has data" read and the total moves to `households.counts`.

## The battery as parallel jobs (CI-2, 1 Nov 2026)

- **P3 · Emoji glyphs in a legacy sequence row.** The Sequences row in `Communications.jsx` reads "⏸ Pause" / "▶" (product copy with emoji). Found by CI-2; the P1 it came with was fixed by TRUST-1. Suggested: the next editor build drops the glyphs.

## One home for every giving number (NUMBERS-3, 1 Nov 2026)

- **P3 · `xeroSync.js` sends credit rows** (MAP-1 §12); QuickBooks now leaves them out (`shared/numbers/money.js`). Suggested: the next bookkeeping build reads the same predicate.

## Home and Atlas (SWEEP-1, 31 Oct 2026; walk in docs/sweeps/sweep-1/walk.md)

- **P3 · Home's right rail is mostly empty at 1440.** Today, Owners, Snap a check and one sentence beside a 2,000 px main column. Suggested: the next Home build moves the thank-yous or the chips into the rail.

## The house rules (ARCH-1, 1 Nov 2026)

- **P3 · Nothing schedules `sweepQuietConnections`** (server.js, near 2259); `POST /connections/sweep` is the only way it runs, and nothing calls that. Suggested: the next integrations build either schedules it on the tick or removes both.
- **P3 · `GET /pos/attendance-drift` has no caller,** yet `scripts/seed-demo.js` seeds a fixture for it. Kept under amendment A1 (no deletion without Jonathan's yes); listed in `docs/architecture/routes-reviewed.md`. Suggested: the events build that next touches POS.


## Communications (SWEEP-3, 30 Oct 2026; walk in docs/sweeps/sweep-3/walk.md)

- **P3 · Thank-yous and welcomes sign differently.** The one-person thank-yous sign with the org's name when nobody has a signature in My profile or Brand; the designed welcomes sign with the sender's account name. Suggested: the next editor build picks one rule.
- **P3 · Quick edit and print previews the top giver; the email editor previews the newest giver.** Same template, two people. Suggested: the next editor build.

## Events and pledges (SWEEP-4, 29 Oct 2026; walk in docs/sweeps/sweep-4/walk.md)

- **P3 · The open-pledge banner and the Next move repeat each other.** Both list the same installments on the profile. Suggested: the people sweep.


## Finance, Reports, Grants (SWEEP-5, 29 Oct 2026; walk in docs/sweeps/sweep-5/walk.md)

- **P3 · Budgets' projected year-end straight-lines a one-off.** One $1,200 expense in month 3 of a fiscal year projects to $3,600 "over budget". Found by FIX-60's walk. Suggested: FIN-2.
- **P3 · Grants · Reports: "AWARDED, FY 2026–27" broke across two lines at 1440.** Sentence case shortened it and neither walk org had a grant to draw it after the fix. Suggested: the next Grants build looks with a grant on file.
- **P3 · Phone, Reports: the rail is a select.** Each report opens by its own URL on a phone and costs 0.6 to 1.7 s locally; not throttled to slow 4G in this walk. Suggested: PERF-3 measures Reports at 390 on slow 4G.

## Home on a phone (PERF-2, 1 Nov 2026)

- **P2 · Home phone 3.5 s vs 3 s bar.** PERF-2 took Home on a phone (390, slow 4G) from 4.4 to 3.5 s; by PERF-3's start main measured 3.84 s and failed perf-app's 3.64 s budget. PERF-3 (2 Nov) took it to 3.48 s (perf-app, median of 5; a second visit 1.31 s, from 1.53), Home's layout shift from 0.49 to 0, and the first look from 314 to 294 KB: DM Sans 37 to 24 KB, the fonts cached for a year, the deck's code preloaded and drawn with Home, Vercel's beacons after load, Dashboard's dead sections gone (docs/history/PERF-3.md). The budget is 3.58 s (3.48 + 0.1). What is left on the waterfall (local preview, cold): the document at 0.6 s; react-dom 63 KB in at 2.38 s, App 83 KB at 2.52 s, the deck 15 KB and eight more small chunks by 3.1 s, DM Sans at 3.28 s; first paint 3.1 s, Home's first frame 3.23 s, the rail ready 3.48 s (it draws a second time once four of Dashboard's own reads come in through its effects: setup, the Thread, task counts, recurring health). The link carries 294 KB in about 2.7 s, 110 KB/s of its 180: the local preview is HTTP/1.1 with six connections a host, so fifteen first-look files queue and each waits a 562 ms round trip; Vercel serves HTTP/2. After the last byte, parse and render at the phone's 4x CPU take about 0.4 s. Suggested: the rail's last four reads taken from the boot's parked answers as the deck's are (about 0.1 s); fewer first-look files (the nine small shared chunks exist because pages outside the app import them; a chunk plan that does not grow the giving pages), or measuring perf-app over HTTP/2 as production serves it; and the app on `api.stewardapp.dev` (docs/needs-jonathan/SECURE-3.md), whose preconnect app.html already follows.
- **P3 · `/donors/counts` is Home's slowest read on messy-25k (150 ms):** one query that works out every person's status (`donorStatus.statusSql`) to count the lapsed. Suggested: the numbers build reads the stored status.
- **P3 · `/org` answers `SELECT *`** (the house rule: never into a response); it is one of the app's seven boot reads. Suggested: the next accounts build names its columns.

## Giving pages, the donor side and the phone (SWEEP-6, 30 Oct 2026; walk in docs/sweeps/sweep-6/walk.md)

- **P2 · Recurring paints a failed card red.** Terracotta text on a pink Needs recovery band, and "failed recently" in terracotta; the four-colour rule keeps red for a destructive confirm. Suggested: the recurring build, brass as overdue is.
- **P3 · Year-end pages made before SWEEP-6 still promise a receipt.** The template's thank-you said "Your receipt is on its way to your inbox"; new pages no longer do, but a page already made keeps its words (her words now, and no row changes at deploy). Suggested: the editor shows a note beside a thank-you that mentions a receipt when the org's receipts are off.
- **P3 · A new giving page is live at its link before Publish.** The words now say so; nothing lists it. Suggested: EDITOR-2 decides whether a never-published page answers "Not open yet".
- **P3 · "Card updated, thank you!" shows for anyone who adds `?card_updated=true`.** Suggested: GIVE-4 reads the setup session as the event thanks page reads its own.
- **P3 · Profile at 390: the status chips and "+" are 20–29 px.** "Log a call" no longer wraps (seen on POLISH-4's walk). Suggested: the next profile build.
- **P3 · The Thread's "Nov 1 / Due on" puts the date above its own label.** Suggested: the next Home build.
- **P3 · ACH was not walked end to end.** Stripe's own page and the days-later settlement cannot be driven on a stub; the Steward side is the card's webhook path. Suggested: a test-mode walk on the Stripe sandbox when one is set up for Steward.
