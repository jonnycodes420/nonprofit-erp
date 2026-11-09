# PLEDGES-3 · Pledges, grants and receipts tell one story (2026-11-08)

The 8 Nov fleet found one pledge told four ways (W-1107-Finance-20), a $150 payment on a $100 installment saved with no word and a schedule still saying $100 (25X), an Awarded grant asking to "Record the award" beside $0 and 0% and a live countdown (31), and receipts that kept their amount after the gift changed (09X).

Why it happened: each pledge surface computed its own "next": the profile from installments, the Calendar from `paid_at` flags at face value, the figure dialogs from the pledge's own due date or the first scheduled (already paid) installment, and the Pledges list had none. The award line treated "awarded with an amount, no award row" as "record the award". A receipt is a snapshot and nothing compared it with its gift after issue.

What changed: `shared/numbers/pledges.js` has `summaryOf` (and its SQL twins `NEXT_INSTALLMENT`, `SUMMARY_WORDS_SQL`, `OPEN_INSTALLMENTS_SQL`), and every pledge surface reads it. `shared/pledgeCover.js` says what a payment covers before Save. `shared/grantAwardLine.js` gained `grantMoneyTiles`. `server/receipts/drift.js` reads the drift live and adds `POST /receipts/:id/reissue`; a $0 gift never gets a receipt from `issueGiftReceipt`.

Each item was reproduced first by clicks against a production build (NODE_ENV=production server, the built client), on fixtures shaped like the fleet's description. Old rows: `scripts/ops/pledges3-old-rows.js` (dry run) lists them; the pledge flags are REPAIR-1's step 10.
