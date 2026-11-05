# LEDGER-2 · The fiscal year never flips, splits add up, goals reconcile, awards book, links count (2026-11-05)

A walk on 5 Nov and our own checks found seven money figures that did not hold. The causes:

1. **The fiscal year flipped.** The server was right every time (`orgReportYear`, the org's date in the org's
   zone). Reports labelled its chips `serverFy || CUR_CY`: until the giving summary answered, and for good when
   that request failed, it used the browser's calendar year as the year a fiscal year ENDS in. On 5 Nov 2026
   that is "This FY 2025–26 / Last FY 2024–25", a year behind the server's "2026–27". The giving summary now
   sends `calendarYear` beside `fiscalYear`; `shared/fiscalPeriod.js` `reportYearsFrom` is null until both are
   known, Reports shows no chips until then, and asks again on a failure. Reports.jsx no longer reads the clock.
   The truth check then found a second label: for a year that starts in January, `fyLabelFromEnd` named the
   server's year 2027 (Jan to Dec 2026, `reportYearBounds`) "FY 2027". It subtracts one for every start month.
2. **Splits.** `/donors/:id/fund-affinity` counted Unrestricted as only the gifts with no fund, and Restricted as
   gifts on restricted funds, so a gift on an unrestricted fund (General Operating, a board-designated Gala
   Reserve) was in neither bucket: "Unrestricted $0" beside $12,523 in General Operating, and $3,000 + $28,750
   beside a $36,750 lifetime. It also divided by the stored total. `shared/numbers/fundSplit.js` is Lifetime cut
   by fund: each gift in exactly one bucket by its fund's restriction (no fund, a fund that is gone and the
   imported total are Unrestricted), the buckets sum to Lifetime, whole percents add to 100.
3. **Goal pace.** No card in this code says "projects $X"; the walk's "$1,062,700 from $225,151" has no formula
   here that makes it (the server's `/annual-fund` projection, read by no screen, is a calendar-month one).
   `shared/pace.js` `paceMath` is the one projection: raised × days in the window ÷ days gone, today counted,
   and the pace badge's hover states it: "$225,151 raised by day 128 of 365, on pace for $642,032".
   **Portfolios.** `/portfolio/officers` and the `officer-portfolio` figure source summed the stored
   `donors.total_giving`, a cache any later recompute moves with no gift change (the boot's `keepEarlierTotals`
   repair counts credit rows; a recompute after an unrelated write snaps a stale value). Both read Lifetime live
   (`shared/numbers/lifetime.js`). The exact +$160 row is in prod data this build does not read.
4. **The award and the ledger.** GRANTS-FIX made `PUT /grants/:id/award` the only way into Awarded and it wrote
   the pledge only, while the general PUT still stamped the whole award as income on a move back into Awarded.
   This build first made the award write that income row too, with a backfill. Then GIFTS-1 (#342) landed
   Record a payment received: a gift on the award pledge through `recordGift`, which books its own income. The
   award row would have counted the money twice ($15,000 award + $10,000 payment = $25,000 of income). Jonathan
   ruled the award books exactly as an ordinary pledge, and an ordinary pledge writes nothing to the ledger
   (`pledgeWrite.js`). So the award writes no ledger row, the general PUT's stamp (`stampGrantAward`) is gone,
   and there is no backfill: `server/grants/awardLedger.js` and `scripts/ops/ledger2-award-rows.js` were
   removed before merging. The award route keeps its one transaction for the pledge and the grant's award.
5. **"Gives through".** The rule already pooled `owner`/`works_at` (POLISH-4) and the tag read Current. What stayed
   Lapsed was the stored stage that Home's "my stats", its Lapsed list and the work list read: the after-change
   step un-lapses a person whose unit gave only when an AUTOMATIC Lapsed move was on record, and an import or a
   merge writes the stage with no move. Now anyone an officer did not move to Lapsed by hand is un-lapsed.
   **Donor since** read the stored `first_gift_date`; `/people/:id` reads the first gift live (`FIRST_DATE`).

Tests: `tests/ledger2-money-figures.test.js`. §4 is the award: $15,000 awarded writes nothing, a $10,000
payment grows Finance income by $10,000 (never $25,000), Reporting → Awarded on the edit books nothing, and the
grant shows $5,000 remaining. Red on the code before the change (the award's row: $25,000). Run against origin/main before the last two were added:
15 of 17 red (the two green: the file import and the link being written). Added after, not run on main: the
calendar-year chip and the truth-check pass. TRUTH-1's check
(`tests/lib/surfacesAgree.js`) adds: each touched person's Restricted + Unrestricted is their Lifetime, and the
key's fiscal year is the Board's, Fundraising's and the giving summary's. Planted: `fiscalYear.fiscalYear` from
the UTC date (§1 red, "FY 2027–28"); the split dropping no-fund gifts (§2 red, $250 short).

Found, not fixed (next brief): award stamps written before GRANTS-FIX by the old general-PUT stamp
(`source='grant'`, no `gift_id`) may still be on prod ledgers. For such a grant, a payment recorded now (or
`scripts/ops/gifts1-grant-received.js --apply`) books the money a second time. Not read here (prod data).

Not done: the Home goal banner, GoalRow and the Dashboards goal card still say the pace without the hover
arithmetic; `computeFundraisingPace` reads UTC today for the pace; Home's "my stats" pipeline total still sums
the stored total with `stage NOT IN ('lapsed','closed')`; `/insights` "slipping" does not pool linked people.
