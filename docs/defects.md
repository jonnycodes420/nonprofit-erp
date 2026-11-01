# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## The truth check against the key (TRUTH-1, 31 Oct 2026)

Found by `assertSurfacesAgree` once it compared every surface to the key (`tests/keys/truthKey.js`, from the rows, no app code), on `tests/surfaces-agree.test.js` org D (soft and matching credit rows, a household, a pledge-held person, gifts marked already deposited). Each is a duplicate MAP-1 marked "by luck", not the shared version, so none was rewritten here (NUMBERS-3 folds them). D-1, D-2 and D-5 were fixed in TRUTH-1 itself, because fixing the shared sources made those duplicates stop footing beside them. Each is marked KNOWN in `tests/lib/knownDefects.js` and passes the check only at exactly the value it predicts; the same surface off by anything else fails. Delete the marker with the line.

- **P1 · D-3 · Ask and Atlas count credit rows as money and as givers.** Org D, "How much have we raised this year?": $5,840.00 against $540.00; "How many donors do we have?": 5 people gave this year against the key's 3 (the Board says 3). `askEngine.js:46` `giftSet` selects every gift row; the metrics sum and count them. Suggested: NUMBERS-3.
- **P1 · D-4 · Finance's money in counts credit rows as money.** Org D's twelve months: $5,840.00 against $540.00. `routes/finance.js:214` (money in by month) and `finFigure` `moneyInThisMonth` (`:143`). Suggested: NUMBERS-3 (or the Finance sweep).
- **P1 · D-6 · The bookkeeper's file calls a deposited gift "not matched to a deposit".** Org D: the three gifts she marked already deposited (FIX-59) are on Finance's deposits and in the bookkeeper's `no_deposit` issue; on real-shaped, all 278 of the gift file's gifts after the import's own "already deposited". `reportBookkeeper` reads `deposit_ref` (`routes/crm.js:24988`), which only Undo writes (`routes/finance.js:426`); a deposit run holds its gifts by `import_id` and writes neither column. The deposits file (`depositsFile.js:52`, `/reports/deposits`, `routes/crm.js:25076`) and QuickBooks' deposit mode (`qboSync.js:680-742`) read the same column. Suggested: NUMBERS-3 makes `routes/finance.js` `ON_NO_DEPOSIT` the one definition, and decides what `deposit_ref` holds (see the TRUTH-1 report).
- **P2 · D-8 · Fundraising's Recent gifts lists a soft credit row as a gift.** The walk of org D: "Oona Credit · $5,000" sits among the recent gifts beside the Raised tile's $540. The recent-gifts query (`/fundraising/overview`, `routes/crm.js` near 22058) lists every row. No truth-check leg reads a list of recent gifts, so it has no marker. Suggested: NUMBERS-3.
- **P3 · D-7 · The onboarding card's gift count counts credit rows as gifts.** Org D: 10 against the key's 8. `routes/crm.js:3318` (`/org/setup-status`). TRUTH-1's brief allows a known marker only for a P1; this one is marked too, so CI stays green, and Jonathan decides whether it waits for NUMBERS-3 or is fixed alone. Suggested: NUMBERS-3.

## Donors, Data health and imports (SWEEP-2, 31 Oct 2026; walk in docs/sweeps/sweep-2/walk.md)

- **P3 · smoke-walk's report reads race the report's figures.** On SWEEP-2's first CI run `units.feeTablesOnPage` read 0 rows from the bookkeeper's table that the next check read drawn (run 41249592761), and the "?"-between-a-count-and-its-noun check only sees a report's figures when they arrive before it reads (CI yes, locally no), which is how SWEEP-2's CI found four real misses that local runs pass. Suggested: the next tests build waits for a report's figures and rows before reading them, and proves it by planting one of the four back.
- **P3 · On a phone the Donors toolbar fills the first screen.** Two chips, search, four view tabs, Log a call, + Add, Import & tools, five selects and three buttons come before the first donor at 390, and "Re-engage" breaks as "Re- / engage". Suggested: the people sweep folds the selects behind one Filters button on a phone, as Team and Data health already do.

## Staff mail (STAFF-MAIL-1, 30 Oct 2026; walk of Settings → My email and the morning email)

- **P2 · The morning email's date line reads "2026-10-31".** `renderMorningBriefBody` (server.js) prints `today` as the raw ISO string beside the person's name ("Wren Walker · 2026-10-31"), where every other screen shows a written date. Seen on the walk's 9 AM send. Suggested: the next staff-mail or Settings sweep, through `shared/displayDate.js`.

## Home (suggestion from Jonathan, 31 Oct 2026, raised during STAFF-MAIL-2; SWEEP-1 owns Home)

- **P3 · Home's Set up Steward card in the right rail opens closed.** Jonathan wants its steps shown by default (each step with its sentence and action, as in his screenshot of Justin's Place), closing only when the person clicks Hide the steps, and staying closed for them after that. Today `SetupRailCard` (client/src/components/HomeSetup.jsx) starts with `useState(false)`, so it shows "Show all steps". `tests/smoke-walk.test.js` §home-4 pins "Show all steps" and would change with it. Suggested: SWEEP-1.

## The battery on a weekend (STAFF-MAIL-2, 31 Oct 2026)

- **P3 · Two suites fail only with the weekend clock pin.** With `STEWARD_TEST_NOW=2026-11-02T17:00:00Z` (the Monday-noon pin), `polish1-trust` §bare (the month-close banner reads the October close's other gifts) and `capture1-zero-day` §7 (time to thank reads 1.52 days, not 1.5: real-time stamps against the shifted database clock) fail on this branch; both pass unpinned, and neither reads anything STAFF-MAIL-2 changed. Suggested: the next tests-and-CI build makes both fixtures read the test clock.

- **P3 · numbers1-foot §1 depends on which suites share its shard.** §1 runs the numbers checker on every org in the shard's database. When agents1-persona-scope (which loads tenant-matrix's fixture, `org_mxa` and `org_mxb`, written straight to the tables) runs earlier in the same shard, §1 fails on those orgs' stored totals. TRUTH-1's second battery, with timings refreshed by the first, put the two together; with main's timings they are apart and §1 passes. Suggested: the next tests-and-CI build makes §1 skip fixture orgs that bypass the gift path, or has tenant-matrix's fixture recompute its totals.

## Communications (SWEEP-3, 30 Oct 2026; walk in docs/sweeps/sweep-3/walk.md)

- **P1 · A campaign reaches only people set to Always include, even with Campaign emails on for Everyone.** `donorMailDecision` (routes/email.js) refuses kind `campaign` unless `donors.auto_email` is true (SEND-GATE-1), while SEND-GATE-2's rule for a type set to Everyone is "anyone not set to Never". On the walk org with Donor mail and Campaign emails on for Everyone the builder still said "315 donors · 0 can get this email: 247 have no email address, 68 have automatic email off". Who a campaign reaches is a sending rule, so it needs Jonathan's word on which rule is meant, then the real-shaped check and the truth check. Suggested: SEND-GATE-3.
- **P2 · A campaign merge with no gift reads "your gift of your previous gift".** `legacyCampaignBody` (server.js) fills `{{gift_amount}}` with "your previous gift" for someone with no gift, and the Thank-you starter says "Thank you for your gift of {{gift_amount}}". The preview now shows a real giver's gift; the send's fallback is a send change. Suggested: SEND-GATE-3, with the starter's sentence.
- **P3 · Thank-yous and welcomes sign differently.** The one-person thank-yous sign with the org's name when nobody has a signature in My profile or Brand; the designed welcomes sign with the sender's account name. Suggested: the next editor build picks one rule.
- **P3 · Quick edit and print previews the top giver; the email editor previews the newest giver.** Same template, two people. Suggested: the next editor build.
- **P3 · "Use Eastern Daylight Time (America/New_York)".** The Sequences timezone button shows the zone's database name (`zoneLabel`, shared with Settings). Suggested: the Settings sweep.
- **P3 · The Journey emails switch sits flush to the card's left edge** on an open journey. Suggested: the next Journeys build.
- **P3 · Campaign list subjects outside the builder still use the sample "Margaret".** `subjectPreview` in the legacy sequence preview (Communications.jsx) has no donor to fill. Suggested: the next editor build.

## Events and pledges (SWEEP-4, 29 Oct 2026; walk in docs/sweeps/sweep-4/walk.md)

- **P3 · Two tile looks on After the event.** White figure tiles (Raised … Gave) above cream buttons (Invited … Sponsors) on one card; First-time givers and Sponsors open rows but are not `<Figure>`s with a source. Suggested: EVENTS-3.
- **P3 · Check-in draws every guest on the event page.** 195 rows under the door search; the search is the door, the list could fold. Suggested: EVENTS-3.
- **P3 · The open-pledge banner and the Next move repeat each other.** Both list the same installments on the profile. Suggested: the people sweep.

- **P2 · An event's people figures count persons; the Finding Joy key counts guest-list rows.** The combined workbook's key says 443 people, 172 attended, 104 gave, 77 came and gave, 95 came without a gift; Steward makes a couple's row two people, so the event page, Home's Grow card, Fundraising and Ask say 252 came, 149 gave, 122 came and gave, 130 came without a gift (each opens to exactly the key's rows; money matches the key). Decided in FIX-60: an event's people figures count giving units (a household once), as the ladder does; not built in FIX-60's time. The plan is in FIX-60's report: `numbers.eventGuests` groups by `COALESCE(household_id, donor id)`, the four `event-*` sources open one row per unit, the Events list counts, the truth check's event truth, and the suites built on couples as two (fix59-event-import, fundraising2-screens, import5 §6, sweep4, real-shaped §FJ asserts the key directly). Suggested: EVENTS-3.

## Finance, Reports, Grants (SWEEP-5, 29 Oct 2026; walk in docs/sweeps/sweep-5/walk.md)

- **P3 · Budgets' revenue variance reads backwards and in red.** Variance is budget − actual for both sections, so revenue ahead of a $0 budget reads "-$1,750" in red and revenue $39,250 short reads "+$39,250"; "over budget" and an over line are red, which is for a destructive confirm only (overdue is brass). Found by FIX-60's walk. Suggested: FIN-2.
- **P3 · Budgets' projected year-end straight-lines a one-off.** One $1,200 expense in month 3 of a fiscal year projects to $3,600 "over budget". Found by FIX-60's walk. Suggested: FIN-2.
- **P3 · Grants · Reports: "AWARDED, FY 2026–27" broke across two lines at 1440.** Sentence case shortened it and neither walk org had a grant to draw it after the fix. Suggested: the next Grants build looks with a grant on file.
- **P3 · Phone, Reports: the rail is a select.** Each report opens by its own URL on a phone and costs 0.6 to 1.7 s locally; not throttled to slow 4G in this walk. Suggested: PERF-3 measures Reports at 390 on slow 4G.

## Giving pages, the donor side and the phone (SWEEP-6, 30 Oct 2026; walk in docs/sweeps/sweep-6/walk.md)

- **P2 · Home on a phone is 4.5 s, not 3 s.** SWEEP-6 took every click-only panel out of Home's code (315 → 271 KB of JavaScript; usable 4.82 → 4.50 s, ready 4.37 → 3.85 s) and measured that the phone is now bandwidth-bound on slow 4G: asking for the chunks earlier changes nothing. What is left on Home's first look: react-dom (~42 KB), Dashboard.jsx (108 KB raw), MeetingPanels (48 KB raw, for MorningBrief, which shares the meeting forms), the Insights deck (34 KB raw) and its 39 KB read, InboxConnect's banner, Dashboards (17 KB raw, for CallsToMake's GoalRow), LogConversation (for two Thread buttons), and the fonts (54 KB, arriving after the first paint). Suggested: PERF-2 splits MorningBrief and GoalRow out of their modules, moves ThreadDismissMenu and PutItOnMyCalendar out of LogConversation, trims the deck's first read, then lowers perf-app's phone budget from 4.8 s.
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
