## NUMBERS-5 · The last hand-written money sums, the big workbook in the main importer, and the leftovers (2026-11-03)

Brief: the 25,000-person workbook through "Import a spreadsheet", the last 50 money sums NUMBERS-4 listed (and the 2 partial ones), the first gift on a tie, "New" on a person with no gift, Home's ask against the profile's, three import reader words, and a before-and-after on the real-shaped files.

**The big workbook.** ITEM1_PLACEHOLDER

**The money sums.** All 52 moved; none turned out to be a legitimate own sum. Rather than add `MONEY()` to fifty WHERE clauses, the sums themselves moved into `shared/numbers/` with the credit rule inside them: `MONEY_SUM` and `MONEY_CENTS` (money.js), `SPAN_SUM` and `SPAN_CENTS` (givingBetween.js, a report's year column) and `GRANT_RECEIVED` (pledges.js). Where a sum is shown beside the people it counts, the people follow the same rule: a donor in a year gave a gift in it, so a refund or a credit row alone no longer makes someone a prior-year donor in the retention report. The report builder turned out to be loaded by the server only (no screen imports it), so it imports `shared/numbers` directly and its gifts entity is money. Where a total opens rows, the rows moved too (a grant's payments, Finance's gifts with no fund), so each still foots. `route-gift-sql` went from 348 lines to 296. The one new test, `tests/numbers5-money-sums.test.js`, plants a soft credit, a matching credit and a refund across giving, a pledge, a grant and a recurring gift: 16 of its 18 checks fail on main. The real-shaped files hold no credit rows, so no figure on them moved.

**The first gift on a tie.** NUMBERS-4 tried the last gift's order and the checker disagreed. The checker sorted first gifts by date then id; it now reads the same order as the app (recorded first, to the microsecond as Postgres orders, then the larger, then higher up the file), which the last-gift key already did. `firstGift.FIRST_GIFT_ORDER` holds it. On main two runs of the same import gave seven people a different First gift; on the branch, none.

**"New" without a gift.** The server never gave it: `statusSql` has no row for someone with no gift, only a refund, a credit or a pledge. What PROFILE-3 saw was the closeness word "New" (a relationship that is new), which is not a giving tag. Pinned in numbers-home §16.

**The ask.** SWEEP-1 §6 pins that the arithmetic can step up a rung, not that Home should when nothing says the person has room. So the profile's rule won: a rising donor is held at their level until Room to give is known, on the profile and on every card (`ask.roomKnown`), and a held card ask says why. On the real-shaped gift history the cards and the profile now agree on 54 of 54 one-person suggested asks (51 on main); six units' asks came down a rung.

Left in `docs/defects.md`: a person with only credit rows still lands on the LYBUNT and SYBUNT lists (at $0), and Home's cards do not read a screening file for Room to give.
