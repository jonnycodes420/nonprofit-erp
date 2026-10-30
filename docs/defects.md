# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## Communications (SWEEP-3, 30 Oct 2026; walk in docs/sweeps/sweep-3/walk.md)

- **P1 · A campaign reaches only people set to Always include, even with Campaign emails on for Everyone.** `donorMailDecision` (routes/email.js) refuses kind `campaign` unless `donors.auto_email` is true (SEND-GATE-1), while SEND-GATE-2's rule for a type set to Everyone is "anyone not set to Never". On the walk org with Donor mail and Campaign emails on for Everyone the builder still said "315 donors · 0 can get this email: 247 have no email address, 68 have automatic email off". Who a campaign reaches is a sending rule, so it needs Jonathan's word on which rule is meant, then the real-shaped check and the truth check. Suggested: SEND-GATE-3.
- **P2 · A campaign merge with no gift reads "your gift of your previous gift".** `legacyCampaignBody` (server.js) fills `{{gift_amount}}` with "your previous gift" for someone with no gift, and the Thank-you starter says "Thank you for your gift of {{gift_amount}}". The preview now shows a real giver's gift; the send's fallback is a send change. Suggested: SEND-GATE-3, with the starter's sentence.
- **P3 · Thank-yous and welcomes sign differently.** The one-person thank-yous sign with the org's name when nobody has a signature in My profile or Brand; the designed welcomes sign with the sender's account name. Suggested: the next editor build picks one rule.
- **P3 · Quick edit and print previews the top giver; the email editor previews the newest giver.** Same template, two people. Suggested: the next editor build.
- **P3 · "Use Eastern Daylight Time (America/New_York)".** The Sequences timezone button shows the zone's database name (`zoneLabel`, shared with Settings). Suggested: the Settings sweep.
- **P3 · The Journey emails switch sits flush to the card's left edge** on an open journey. Suggested: the next Journeys build.
- **P3 · Campaign list subjects outside the builder still use the sample "Margaret".** `subjectPreview` in the legacy sequence preview (Communications.jsx) has no donor to fill. Suggested: the next editor build.

## Events and pledges (SWEEP-4, 29 Oct 2026; walk in docs/sweeps/sweep-4/walk.md)

- **P2 · The Events list's four numbers do not open.** They are `<Figure>`s with their sentences now, but there is no figure source across events (events this year, came this year, received at events, came of registered), so a click opens nothing. Suggested: EVENTS-3 adds `events-year-*` sources in `figureSources.js` and passes them.
- **P2 · Pledges from the history import route have no installments.** `POST /donors/import-semantics` (the bulk route for other systems' exports) writes pledges with no schedule, and shell pledges link payments that no installment knows about. Writing installments there changes what Undo and the shell repair see, so it needs the real-shaped check. Suggested: IMPORT-6.
- **P2 · A fresh pledge does not count as activity.** Somebody who pledged $15,000 at the dinner twelve days ago reads Lapsed and Cooling on their profile: status reads gifts only. Suggested: the people sweep.
- **P3 · Two tile looks on After the event.** White figure tiles (Raised … Gave) above cream buttons (Invited … Sponsors) on one card; First-time givers and Sponsors open rows but are not `<Figure>`s with a source. Suggested: EVENTS-3.
- **P3 · Check-in draws every guest on the event page.** 195 rows under the door search; the search is the door, the list could fold. Suggested: EVENTS-3.
- **P3 · The open-pledge banner and the Next move repeat each other.** Both list the same installments on the profile. Suggested: the people sweep.

## Finance, Reports, Grants (SWEEP-5, 29 Oct 2026; walk in docs/sweeps/sweep-5/walk.md)

- **P2 · Annual report and 3-year comparison compare a running year with a whole one.** The annual report now says "so far" and "against the whole of FY 2025–26", and points at the Giving summary; the 3-year comparison still prints "a change of -69% year over year" for four months against twelve. Suggested: REPORTS-6, the same-point source the Giving summary uses (`samePointLastYearSource`) for the newest column.
- **P3 · Month close calls day-groups deposits.** "4 deposits, $26,777.61 gross" when nothing has been deposited: the gift detail groups unmatched gifts by the day they were recorded and the sentence calls each group a deposit. Suggested: FIN-2, "4 days of gifts not yet on a deposit".
- **P3 · Budgets are calendar years on a fiscal page.** The picker says "Calendar year" now and is no longer hard-coded to 2023–2026, but a fiscal-year org budgets on the calendar. `/finance/budgets?basis=fiscal` exists on the server; moving to it reinterprets every stored budget row, so it needs a decision and a migration note. Suggested: FIN-2.
- **P3 · Budgets' variance reads "+$0".** A zero variance carries a sign. Suggested: FIN-2.
- **P3 · Grants · Reports: "AWARDED, FY 2026–27" broke across two lines at 1440.** Sentence case shortened it and neither walk org had a grant to draw it after the fix. Suggested: the next Grants build looks with a grant on file.
- **P3 · Figure "?" sits between a count and its noun** ("0 ? grants") on Grants · Reports and the Board. Suggested: the next Figure pass.
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
