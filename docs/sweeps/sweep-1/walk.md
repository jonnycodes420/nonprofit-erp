# SWEEP-1 · the walk: Home and Atlas

Walked 31 Oct 2026 on the scratch stack (main at 37a702b), as Allie would, on two orgs:

- **the walk org** (`org_sw1walk`): a fresh org with the real-shaped files imported in order (gift history 287,
  the dinner workbook 106 with the dinner dated 17 Oct 2026, contacts 656) and the scrubbed guest list.
- **the empty org** (`org_sw1empty`): a brand-new org with nothing in it.

Home at 1440 and 390 on both; every moves tab, a card in each, the chips under the moves, the right rail,
the thank-you list; Atlas opened from Home's Ask box with ten common questions. Screenshots in the
scratchpad (not committed): `walk-before/` and `walk-after/`. Severity: **P1** wrong number, data loss,
sends or breaks; **P2** reads or looks wrong; **P3** polish. Status after the fixes is at the end of each line.

Timings (desktop, local stack): Home usable 0.15–0.3 s after the shell and idle at 0.9–1.1 s on both orgs;
the first look on a freshly imported org was idle at 0.98 s (the 13 s seen once was the server's own cold
start, not the org's). Every Ask answer drew in 0.54–0.59 s. Phone on slow 4G was measured by SWEEP-6
(4.5 s, in docs/defects.md for PERF-2) and not re-measured here.

## Known misses from the brief

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 1 | Home · Your moves | Drafts to organisations open "Hello, thank you…": OAKVILLE Foundation, Ulis & Verin Cranville Family Foundation, Halridge Bank and every business sponsor. `insights.js` had its own greeting and said "Hello" for any organisation instead of the one rule in `shared/greeting.js` (FIX-56: the named contact, else "friends at" it). | P2 | fixed: the moves greet through `shared/greeting.js` ("Dear friends at OAKVILLE Foundation,"; a named contact by name) |
| 2 | Home · Your moves · Keep | Ulis & Verin Cranville Family Foundation gave $25,000 on 4 Sep 2026 (and $577.60 in July), this fiscal year. The card said "Gave $50,000 in December 2025. Nothing yet this year-end." and asked $50,000 on top. | P1 | fixed: "Ask $24,422: last December's $50,000, less the $25,577.60 given since Jul 1."; a giver who already gave as much this fiscal year is not a year-end move (20 → 19) |
| 3 | Home | All 1,000-odd people show "No owner"; nothing on Home offers to assign them. | P2 | fixed: an Owners card in the rail for an admin while nobody owns anyone: "Make my top 25 mine", with Undo |
| 4 | Home · event card | The card counts places taken (`SUM(quantity)`, a party of two is two) against capacity; the event page's Registered is each person once (`numbers.eventGuests`). Two measures under one word. | P2 | fixed: "5 people registered, for 40 places." (five parties of two said 10 before) |

## Home

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 5 | Your moves · Grow tab | "$50,463 at stake" is the first 150 moves only (the deck's cap). All 244 Grow moves are $84,163, which is what the server says. | P1 | fixed: the tab says the server's total for every move ($84,163), less what was acted on here |
| 6 | Ask box · Try | "How is the Annual Fund doing?" is offered to every org. This org has no Annual Fund, and the answer is all its giving this year ($75,291.96) under that question. | P1 | fixed: Home offers "How much have we raised this year?"; a fund, appeal or event the org doesn't have is said by name ("There's no fund, appeal or event called \"Annual Fund\" in Steward.") |
| 7 | Your moves · drafts | Greetings read wrong beyond organisations: "Hi &," (Mr & Mrs. Ivoina G Dunwell), "Hi K," (K Valon Lane), "Hi J," (J Thornland), "Hi Foxland," and "Hi Redshaw," (business names). | P2 | half: "Dear Mr & Mrs. Ivoina G Dunwell,", "Dear K Valon Lane,", "Dear Foxland,"; a business with no business word in its name ("Redshaw Holville Wine Spirits") still reads "Hi Redshaw,": defects.md |
| 8 | Your moves · Grow and Planned | The tab says "Grow · 74 second gifts" and its card "One of 86 in first gift, no second yet"; "Planned · 2" beside "One of 12 in planned-gift signals". A person is one move, under their highest, so both are true, and nothing says so. | P2 | fixed: "One of 19 in year-end givers due; 2 of them are under a bigger move" |
| 9 | Chip · rows to review | Each row's date is the raw "2025-12-19". | P2 | fixed: "Dec 19, 2025" (`shared/displayDate.js`) |
| 10 | Right rail at 1440 | Today, Snap a check and one sentence beside a 2,000 px main column: most of the rail is empty. | P3 | left: defects.md |
| 11 | Empty org | Import is offered three times above the fold (Next: import your donors, the row's Import, Your moves' Import a spreadsheet). | P3 | left: defects.md |
| 12 | Phone 390 | The mic button sits over the setup card's "Set up →". | P3 | left: defects.md |
| 13 | Thank-yous | "Teach Steward your voice →", "Set your words" and "Keep Steward's words" are in a different, smaller type from the rest of the list. | P3 | fixed: the page's type |
| 14 | Greeting, setup card, Keep/Major cards, chips (families, ladder, drift), Today, the thank-you rows | Meet the bar on both orgs at both widths: no console error, no 4xx/5xx, no "Not set", undefined or ALL-CAPS label. | | |
| 15 | First look after an import | Meets the bar: the deck and the thank-yous are there under 1 s. | | |

## Atlas (from Home's Ask box)

| # | Question | Miss | Sev | Status |
|---|---|---|---|---|
| 16 | Who are our top donors? | "Steward can't filter by that yet (top). Nothing was changed, and we've noted the question." "top 20 donors" works; "top donors" did not. | P2 | fixed: the top 10 this fiscal year, with their names |
| 17 | How many donors do we have? | Answers "72 people gave this year": the givers of this fiscal year, not the donors on file. | P2 | fixed: "How many donors do we have?" is everyone who has given, all time; with a period it is that period |
| 18 | Who gave this week? / Who gave for the first time this year? | The heading reads "The people behind donors · this week" and "The people behind new donors". | P2 | fixed: "Who gave", "Who gave for the first time", "Who gave the most" |
| 19 | Who should I call this week? | A lone "?" on its own line under each reason. | P3 | fixed: the "?" sits beside its amount |
| 20 | Who came to the dinner and didn't give? | "$0" beside every one of the 165 names. | P3 | fixed: no amount is drawn for a $0 row |
| 21 | How much did we raise last year?, How much have we raised this year?, Who has lapsed?, Who came to the dinner and didn't give? | Meet the bar: each number opens its people, and Why, What and Thread switch. | | |
| 22 | How is the Annual Fund doing? (in the Atlas panel) | Found while fixing #6: Atlas's own reader took "How is …" for something other than a question and said "My reading is off for this organization…"; and "How is the General Operating fund doing?", a fund the org has, found no figure on either path (main too). | P2 | fixed: "how is / did / was …" is a question to Atlas, and a fund on file is its giving |
| 23 | Any refusal | "Answer ready" sits above "There's no fund … called …" and "Steward can't answer that one yet." | P3 | left: defects.md |

## After the fixes

Walked again on both orgs at both widths and with the same ten questions (`walk-after/`): no console
error, no 4xx/5xx, nothing the bar names. Owners: Make my top 25 mine, then Undo, left 0 owners.
Timings unchanged: Home idle 0.93–1.16 s, every answer 0.54–0.56 s. The walk caught one defect of
this build's own before it shipped: the new owners read was not on Home's bundle list, so the whole
rail bundle answered 400 (fixed; it is on the list).

