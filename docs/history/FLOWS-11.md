# FLOWS-11 · Refunds, splits, households and deletes: money that reads true everywhere

Third staging night (lead-2026-11-14). Six items, one PR.

- **W-1113-Fundraising-01 (repeat).** FLOWS-9 made the figure's answer return the gift count but the
  dialog still paged every row, so "Showing 1–50 of 659" sat under 651 gifts on staging: refund rows
  and gifts refunded in full each took a line. A source whose rows are `counted` now pages its
  counted gifts only (`server/reports/giftRows.js`); a gift's refunds are listed under it, and the
  rest ("not counted as gifts") once at the end, so every row still opens and the foot still adds up.
- **W-1113-Finance-27X (repeat).** The glance (First, Largest, Average's count), the Thank-yous rail,
  the tags (donorStatus.js), the closeness facts, Insights (Next move and its ask) and two groups
  read a bare `amount > 0`. Each now reads `giftCount.KEPT`: above $0 and not refunded in full.
- **W-1114-Finance-29.** A household's one year-end statement (`server/receipts/householdStatement.js`),
  type `household_year_end`, beside each person's own. Tax receipts stay per giver.
- **W-1114-Finance-05X.** Transactions read the raw ledger row; Fund Balances read
  `LEDGER_FUND_ROWS`. Transactions now reads the same cut (`server/finance/ledgerLines.js`), a split
  gift's lines grouped under it, with an All years choice so a fund's lines foot to its balance.
- **W-1114-Finance-26X.** Add person's "Gift amount" was a before-Steward total that also stamped a
  gift count and a last gift. It is now "Giving before Steward (a total from your old system, not a
  gift)" behind More, stamps neither, and Lifetime says "Includes $X from before Steward". A real gift
  keeps its one door (Save and record a gift, through recordGift).
- **W-1114-Finance-04X.** A past first gift's thank-you is the first step of the journey it starts,
  and that step names its thread, not the gift, so the delete's `source_gift_id` void never reached
  it. A journey now records `source_gift_id`, and the one delete path stops the journeys a gift
  started (`server/donors/giftThanks.js`), voids the open thank-you and writes the same note.
