# LEDGER-1 · After any change, every money figure agrees with the gifts (2026-11-04)

Two walks on a demo org found the numbers TRUTH-1 proved on a fresh load stop agreeing once somebody
changes something. The causes, each found by driving the change against the real-shaped gift file:

1. **Edit and delete.** The server moved every figure (lifetime, the fiscal year, the rail's year, the
   thank-you row, Fundraising, the fund ledger). The profile did not: after an edit or a delete it re-read
   only `/donors/:id` (the header), never `/rail` or `/relationship`, so the rail and its thank-you stayed
   on the old figure until a reload. That is the $31,496 vs $31,446. Now both call `told()`, the re-read
   an added gift already used. An edit left the thank-you draft's TEXT on the old amount (the queue row
   reads the gift live; the body is written once): an unsent, unskipped draft is written again
   (`queueThankYouDraft` with `replace`). Edit and delete also skipped the after-change step; they run it.
   The step's stored this-year/last-year (`donor_rhythm`, read by nothing yet) counted calendar years; it
   counts fiscal years now (`shared/numbers/fiscalYear.js`).
2. **Deposits.** The Deposit sheet was sound: two checks are two `recordGift` calls with their own keys
   (+$250, +3 in the suite). The walk's numbers are Tell Steward's: its read dropped a second amount equal
   to one already read (`money.some(x => x.cents === cents)`), took only the first amount of a sentence
   that named two, and gave every amount to the memo's main person. Each amount now carries its own words
   (`amount`) and giver (`from`), and only the same words read twice are one.
3. **SYBUNT.** Its "Gave prior year" was LYBUNT's column: the money in last fiscal year. Everyone on SYBUNT
   and not on LYBUNT has $0 there by definition (May 2025 is FY2025 with a July year, two years back). Both
   now read one rule, `givingBetween.LAST_YEAR_SUM`: what they gave in the last year they gave, in the
   report's own years. For LYBUNT that is last year, unchanged.
4. **Pledges.** Due and Overdue summed whole unpaid installments. A $300 payment that matches no
   installment never marks one paid, so $1,200 stayed due beside a $900 balance. One rule now
   (`shared/numbers/pledges.js` `dueOf` / `DUE_SQL`): what the schedule asked for by the day, less what
   has been paid, never more than the balance. The totals, the Pledges rows and the profile read it.
   **Goals.** Home's annual goal read the umbrella goal's own gifts (`goal-raised`); its gifts sit on its
   child goals. `goalFigureRow` and the board pack read the portfolio's own sources (`goal-rollup-raised`
   for a goal with goals under it). Home picks a goal running today, as the roll-up does. Fundraising's
   card is the roll-up of every running goal and says so.
5. **Soft credit.** The gift form was sound (a `gift_soft_credits` pointer, never money). The giver's gift
   row said nothing; it says "Soft credit to …" now. Tell Steward had no soft credit, so "soft credit to X"
   became a hard gift on the memo's person; it is a follow-up for the gift form now, never a gift card.

Second sums removed: the profile's own due-this-year (`server/donors/gifts.js`), the Pledges rows' own
due and overdue (`server/reports/fundraising.js`), the after-change step's calendar year. The ratchet's
`route-gift-sql` baseline went down by one.

Tests: `tests/ledger1-after-change.test.js`, 33 checks, 13 red on main; `assertSurfacesAgree` has an
after-change pass (`ctx.people`). Planted: the ledger stamp left on a deleted gift, and SYBUNT stepping
calendar years, each went red.

Not done: refund, restore and move-to-another-person have no gift routes of their own to change; the
event page's open pledges (`EVENT_PLEDGE_OPEN`) still sum whole installments.
