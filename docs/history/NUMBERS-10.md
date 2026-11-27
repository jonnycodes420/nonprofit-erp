## NUMBERS-10 · Every figure on a record foots to the rows behind it (2026-11-27)

Six items from the fleet's 27 November lead. Built in four parallel worktrees and merged as one PR. The truth check
gained `numbers10fund`, `numbers10thanks` and `numbers10softevent`, and real-shaped gained §N10A, §N10C and §N10D.
Each part was red on 0e706e9's product files before its fix.

- **One fund total** (`fundCard.fundLedger`). The card, the Funds dialog, the Transactions footer for a fund and
  Finance's fund balances read one SQL. Before this, fund balances had their own query. Every sentence says covered
  card fees are in, and a fee left out by a row posted before the fee is named beside the figure. Staging's $82.13
  is four demo rows the pre-NUMBERS-9 seed posted before grossing the gift up. The NUMBERS-9 seed fix skipped them
  because they were already grossed. The seed now heals them, and `scripts/ops/numbers10-fee-rows.js` is the
  dry-run repair.
- **One thank-you backlog.** Closed by POLISH-14 (7c28403): at 0e706e9, Home and Acknowledgment backlog both read
  118 gifts, $88,336.91 since Apr 22, 2025 on Harborlight. The fleet's 846 rows came from the report before
  POLISH-14. The report now also shows "Older than the window" as its own figure (`unthanked-before`).
- **Gives through for a program officer** (`softThrough.CREDITED_THROUGH`). This reverses NUMBERS-9's call that a
  program officer is not credited. The brief made the decision. A program officer link credits the organization's
  gifts as soft credit, never as lifetime. A "works at" link still credits nothing, and an explicit soft credit
  keeps its own amount.
- **A draft names each gift.** ONE-MOVE-1's one-thank-you-per-day fold rewrote the draft with the day's sum. The
  template now says "your gifts of $1,000 and $25". The Gift History header counts and totals by the profile
  glance's rule and names any listed row it leaves out. The fleet's "19 gifts" for 11 rows was not reproduced
  (org_stagewalk had 11 gifts and three deletes since), so it stays OPEN. `scripts/ops/numbers10-merged-drafts.js`
  lists older drafts that state a sum, read only.
- **First-time givers** (`shared/numbers/eventFirstGift.js`). The figure counted any event gift dated on the
  person's first-gift day. Now it counts only when the person's first gift ever, in recorded order, belongs to the
  event by the event's own rule.
- **Deletes and the import headline.** A written-off pledge with a payment says "This pledge stays on the record"
  before any confirm (`server/donors/pledgeDelete.js`), and a server refusal shows in the app, not an `alert()`.
  Deleting a gift writes one "Thank-you cancelled: …" timeline line when it cancels a thank-you step, and Undo
  removes it. This is a narrow exception to THANKS-1's "a gift delete writes nothing on the timeline". The import
  preview and receipt share one headline (`shared/importHeadline.js`), with scheduled gifts counted inside the
  gifts, because this import brings future-dated rows in as scheduled. `scripts/ops/numbers10-orphan-thanks.js` is
  the dry-run repair: 5 silent stopped journeys on staging's Harborlight, which the script never writes.
