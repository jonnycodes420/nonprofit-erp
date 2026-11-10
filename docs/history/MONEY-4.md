# MONEY-4 · Grants, refunds, offline recurring, EIN and import footing (2026-11-09)

The 9 Nov fleet found Wexford still reading "payments not set up" and "No payments set up" with an Application Deadline date beside "Application Closed" (W-1107-Finance-31), NEA saying "Received $35,000, award not recorded" beside Awarded "Not set" and Received "No payments set up" (W-1109-Finance-33), two EINs (W-1109-Fundraising-35X), no way to record a refund (W-1109-Finance-27), offline plans missing from Recurring giving (W-1107-Finance-24), an import with no dollar footing (W-1109-Finance-15), and an Imports list flag that disagreed with its receipt (W-1109-Atlas-13X).

Why it happened: PLEDGES-3 made "awarded with an amount, no award row" say "payments not set up", which is still not the award. NEA's typed Received only became a payment through a script once an award existed. The footer read its own typed EIN copy (`portal_settings.ein_line`). Refunds existed only as rows an import or Stripe wrote. The roster and MRR read `recurring_subscriptions` only. The receipt's ✓ came from the sheet ledger while the list's flag came from the stored columns: two computations.

What changed:
- Grants: a known amount is the award ("Awarded $120,000 · $0 received of $120,000"); recording the award turns a typed Received into its first payment (`server/grants/awardFirstPayment.js`, GIFTS-1's external id); application deadlines disappear from Deadlines, the Calendar and Home's count once awarded (`server/grants/applicationOpen.js`). `scripts/ops/money4-grant-awards.js` for old rows.
- Refunds: `server/donors/refunds.js`, a linked negative row through recordGift (`gifts.refund_of`, `refund_reason`), `refunded_in_full` read by `shared/numbers/money.js` GIFT so the count drops only on a full refund; receipts voided and reissued at net; Stripe refund only after a confirm naming the amount; the webhook echo changes nothing. `shared/numbers/refunds.js` holds the sums.
- Recurring: `server/donors/offlineRoster.js` and `shared/numbers/offlineMrr.js`.
- EIN: `server/org/einLine.js`; the editor field is a read-only line pointing at Settings. `scripts/ops/money4-ein-copies.js` lists orgs whose copies differed.
- Imports: `server/imports/footing.js` is the one footing; the findings, the list's flag and the receipt's two lines all read it.

Each item was reproduced first by clicks against a production build on fixtures shaped like the fleet's description, and on main's own build in a throwaway worktree. Atlas-13X reproduced on an existing row whose stored columns disagree with its ledger.
