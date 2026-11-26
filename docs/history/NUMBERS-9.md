## NUMBERS-9 · Every money figure agrees with its neighbour, to the cent, on every screen and on paper (2026-11-26)

Six items from the fleet's 26 November lead ("a director cannot trust the money on screen"). One new suite,
`tests/numbers9-agree.test.js` (38 checks), red on main in every section (11 passed, 27 failed on c2e96c9).

- **Gifts on the books beside transactions in** (`shared/numbers/fundGap.js`). Staging's General Operating: 649
  posted gifts at $745,561.13 gross against $745,479 of income rows. A read-only query found the $82.13 row by row:
  four gifts whose donor covered the card fee ($2,686.20 = $2,608 grossed up at 2.9% + 30¢, and $51.81, $26.06,
  $26.06). The demo seed grossed those gifts up after their ledger rows were written; the product posts the
  charge (`giftFooting.js`: the ledger counts gross). The seed now moves the row with the gift. The card and the
  dialog print one line from one function: the two figures, gross or as posted, and each part of any difference
  (card fees covered, other gifts whose row differs, income entered by hand) as a figure that opens its rows
  (`fund-books-gap`). The truth check gained `numbers9`: card = dialog, the parts foot, the funds' gifts on the
  books = Finance's Posted.
- **A letter's deductible is the total** (`shared/numbers/deductible.js`). The letters list summed the gifts; the
  letter's only deductible figure was the goods-and-services disclosure under the one gift that bought something
  ($310 of a $600, $410-deductible letter). A year-end statement read a third rule (the stored deductible, else
  the whole gift, never the fair market value). One rule now for the letter, the list, the receipt and the
  statement, and a letter covering several gifts names each and ends "the deductible amount of these 2 gifts is
  $410.00". `scripts/ops/numbers9-letter-deductible.js` (read only) lists letters already marked sent that printed
  one gift's figure.
- **Last gift is net of its refund.** `donors.last_gift_amount` is the gift less its refunds (`lastGift.NET_OF`),
  and the Directory and the profile name the refund ("$35 · $50 less a $15 refund"). The nightly check reads the
  same rule. Existing people carry the gross figure until their next write or `numbers6-recompute`.
- **Reports and the profile give one lifetime.** No prod read was allowed; the likely $4,100 was LYBUNT/SYBUNT's
  household line, which added a couple's lifetimes on a row named for one of them. The line now says
  "household" and each person's part; LYBUNT's people rows read Lifetime live (`lifetime.LIFETIME`), not the
  stored rollup. The read-only query for prod is in `docs/needs-jonathan/NUMBERS-9.md`.
- **Gives through is the Owner link too** (`softThrough.CREDITED_THROUGH`). An Owner-linked person is credited the
  organization's gifts (soft, labelled), the organization names them, and the figure opens the rows. Staging's
  Granville is a program officer: the rail now says the foundation's gifts are its own and how to credit him.
- **One thank-you backlog** (`shared/numbers/thankBacklog.js`). Waiting to be thanked: a gift, no thank-you
  logged, not sample data, person not deleted, dated on or after the Steward start day; a draft still waits.
  Home's tile, Acknowledgments (its "older than N days" said in its sentence), the thank-you card ("7 gifts …
  waiting since …; 3 have no draft yet") and the Report builder's Thanked = No read it. The tile counted a sample
  person's gifts; Acknowledgments had its own 730-day window.
