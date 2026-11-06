# GIFTS-2 · A gift can be split across funds, recurring giving is easy to find, the goal can count pledges (2026-11-06)

From Muse's walk (6 Nov): no way to split one gift across two funds (Gift 5); the goal did not count
$23,750 of open pledges (Rep 7); recurring giving could not be found from Finance, Fundraising or search,
"Request a gift" was a payment link, and "Preview as yourself" did not change the campaign preview (Feel 4).

1. **Split a gift.** There was no place for it: a gift had one `fund_id` and one ledger row
   (`uq_fin_txns_gift`). The lines are a new table, `gift_fund_lines` (gift, fund, amount, actor), written
   by `server/donors/giftFundLines.js` beside the gift, never instead of it: still one gift, one receipt, one
   deposit line, one ledger row. The gift's own fund (and its ledger row's) is the largest line, so a reader
   that does not cut by lines still sees a real fund. Readers that sum BY FUND go through
   `shared/numbers/fundLines.js`: `GIFT_FUND_ROWS` (a gift's lines, or itself) for Reports' by-fund table, the
   person's restricted/unrestricted split (`fundSplit.js`), the fund cards' "restricted by" and the `gifts` /
   `givers` figure sources when asked by fund; `LEDGER_FUND_ROWS` (a split gift's one income row cut by its
   lines, in proportion, the last line taking the remainder) for the fund balances, a fund's rows, the
   restricted/unrestricted figures and the Finance summary. `linesRefusal` is the one rule: two or more lines,
   each fund once, each above $0, adding to the gift to the cent. POST and PUT refuse with that sentence; a PUT
   that changes the amount of a split gift without new lines is refused. The form is
   `client/src/components/gifts/FundField.jsx` (Save is held while the lines are off). TRUTH-1's check adds
   "fund lines sum to gift".
2. **Recurring giving.** It was a part of Fundraising's "Campaigns & pages". It is now a part of Money in
   (the old `recurring` link lands there) and of Finance's "Deposits and payouts" (the same `RecurringView`);
   global search has a Recurring giving destination for "recurring", "monthly" and the like; a profile's plan
   card links to it.
3. **The goal can count pledges.** `count_pledges` on `fundraising_goals` and `campaigns` (NULL: the org goal
   off, a campaign on; `shared/numbers/goalPledges.js`). Pledged is what is still owed on open pledges (due by
   the goal's last day, for the org goal; attributed, for a campaign), so committed never counts a payment
   twice. On: "Raised $X + $Y pledged = $Z committed" and the pace badge compares committed; the bar, percent
   and "over" stay money raised, which is what goal-progress and Reports read. Off: the pledged line still
   shows. The switch is on the goal card and the campaign page (`PUT /goals/:kind/:id/count-pledges`, admin).
4. **Two names.** "Request a gift" is "Send a payment link", and the menu offers "Record a pledge". "Preview
   as yourself" set `as` to null, and the campaign editor read null as "the first recipient", so the preview
   never changed. `client/src/lib/previewAs.js` is the one rule for both editors: null is "me".

Found and fixed in passing: the gift edit form never received `event_id`, so saving an edit cleared a gift's event.

Tests: `tests/gifts2-split-goal.test.js` (30 checks), red on the planted defect (lines need not add up: 14 red).
