# FLOWS-14 · Refund rows, households and owners: money that reads true, round three (16 Nov 2026)

Fifth staging night (lead-2026-11-16). Each item was reproduced first on staging (52d90bd, Harborlight,
read only) and on a local production build; `tests/flows14.test.js` was red on main's code for each.

- **A refund goes with its gift (W-1115-Finance-07X, repeat).** The undo of a deposit or gift file
  deleted its gifts by `import_id`; a refund recorded later has no `import_id`, so it stayed, pointing
  at nothing. FLOWS-11 made a refunded gift undeletable but gave no path that removes both.
  `server/donors/refundPairs.js` removes a gift's refunds (their ledger line, timeline line and draft)
  in the same transaction as the gift: the undo does it per chunk, and the delete does it on
  "Delete the gift and its refund" (`DELETE /gifts/:id?withRefunds=1`). Old rows:
  `scripts/ops/flows14-orphan-refunds.js`.
- **The average (W-1116-Fundraising-07).** The guess (a stored answer not invalidated) was wrong: the
  stored answer moved with every refund. The average read each counted gift at its net and left out
  refund rows, while the total took every row in the period, so an orphaned refund (or a refund in a
  different period from its gift) moved the total and not the average. The `gifts` source's mean is now
  the total's own rows over the counted gifts (`per_gift`).
- **The ask (W-1115-Finance-34X, repeat).** Insights asks over the giving unit, and a household is one
  unit, so Samuel T. read his spouse's $250 as "largest gift $250". The words now say
  "the Okonkwo household's largest gift" (`ask.whoseGifts`); the profile's own Suggested ask was
  already per person. A fund suggestion reads only funds with money given.
- **The starter (W-1116-Fundraising-15X, repeat).** `{{gift_amount}}` in a legacy campaign body and
  the Communications preview read the newest row (`ORDER BY date DESC LIMIT 1`): a refund.
  Both read `lastGift.js` now (`server/donors/lastGiftWords.js`); a refund fires no gift trigger.
- **Thanks (W-1115-Finance-02X, repeat).** The sidebar count had FLOWS-11's rule; the rows, Home's
  org-wide count, the backlog and the dashboard list did not. One rule, `shared/numbers/thanks.js`
  AWAITING, and one row state, `shared/thankState.js` ("Refunded, no thank-you needed").
- **Portfolios (W-1115-Donors-06X, repeat).** `server/majorGifts/portfolioFile.js`: an Unassigned row
  and one sentence saying the rows add up to the Donors tab; the Owner filter offers Unassigned.

## What was learned
- A labelled guess is worth one measurement before it is built: the stored answer was fresh; the two
  numbers were computed from different rows.
- A rule fixed on one surface (the sidebar's thanks, FLOWS-11) repeats on every surface that kept its
  own copy. A shared predicate is the fix, not a second copy.
