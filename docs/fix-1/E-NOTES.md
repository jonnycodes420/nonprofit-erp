# FIX-1 E — Finance that earns its place: notes for the lead

## What Finance answers now

Finance opens on **Restricted** and its tabs run, in order: Restricted ·
Payouts · Monthly close · Overview · Transactions · Funds · Budgets · Audit Log.

1. **Where restricted money sits** — the Restricted view (BUILD-100 Part 7,
   unchanged inside) is the first tab and the one Finance opens on. Cash on hand
   sits beneath it in one line with its defining sentence. The four period
   figures (Cash on hand, FY revenue, FY expenses, net) moved from above the
   tab bar into Overview, so nothing sits above the restricted position.
2. **Which gifts made up this payout** — Payouts lists the connected account's
   recent payouts; opening one calls `GET /finance/payout-lines?payout=po_…`
   (routes/finance.js), which asks Stripe for the payout and its balance
   transactions **as the org's own connected account**, links each charge and
   refund to the Steward gift carrying that payment intent (and its donor), and
   reconciles in integer cents through `shared/payoutReconcile.js`. A payout
   that does not add up says so and by how much, on a brass wash (attention,
   never red). A payout line's donor opens the donor.
3. **What goes to the bookkeeper this month** — Monthly close is the BUILD-87
   bookkeeper export (`/reports/bookkeeper`) asked for one month: the foot
   sentence, totals by fund, and the download. A month that does not foot is
   refused as a file by the server (409) and the screen says why in the
   server's words. There is no second export path.

"Cash on hand" carries `CASH_ON_HAND_SENTENCE` everywhere it appears, and the
Stripe balance carries `stripeBalanceSentence(...)` — a $0 balance says Stripe
has already paid everything out to the bank and that cash on hand is the
ledger's figure, naming it. Both strings live in shared/payoutReconcile.js.

## What was removed (the brief's cut; Jonathan did not ask for either back)

From `client/src/components/Finance.jsx`:

- **The manual Accounts tab**: the `accounts` entry in `SUBTABS`, the whole
  `subtab === "accounts"` view (the per-type account list, the per-account
  drill-down ledger and its balance footer, "+ Add account"), the
  `AccountModal` component, `handleSaveAcct`, the `showAcctModal` /
  `editAcct` / `drillAcct` state and the `ACCT_TYPES` list (its colours live
  on as `TYPE_COLOR` for the ledger's account badge).
- **The AI "✦ 6-Month Forecast" and "✦ Risk Analysis" buttons** on Overview,
  their two `AIPanel`s, `getForecast` / `getRisks` and their four state
  hooks. Finance no longer imports `askClaude`, `AIBtn` or `AIPanel`.
- The Overview line "Gift-level reconciliation is coming — for now, match
  against the online gifts in your ledger." (it has come: Payouts).
- Two unused locals (`totalRev`, `totalExp` and the maps only they read).

**Kept on the server, on purpose:** `GET/POST/PUT /finance/accounts`. The GET
feeds the transaction form's account picker and Budgets are built from the
chart of accounts; POST/PUT are exercised by finance-reintegration (the
read-only 402 gate) and tenant-matrix. The chart is still provisioned at
signup. The AI buttons called `askClaude` (the shared streaming route every
other AI surface uses), so nothing server-side was theirs alone.

The Budgets empty state no longer tells people to add accounts "under the
Accounts tab".

## Routes

One new route: `GET /finance/payout-lines?payout=po_…` (requireAuth, read
path, never write-gated). The payout id rides the query string, so it has no
row-id path param for tenant-matrix to cross; tenancy is the caller's own
`orgs.stripe_account_id` (another org's payout is Stripe's 404, and ours) and
the gift join is `g.org_id = ?`. `/finance/stripe-summary` gained
`balanceSentence`; its payouts list is still five (finance-reintegration pins
≤5). Route inventory regenerated.

## Sign-first

`fmtFull` has been sign-first since 3256bfb. RestrictedView no longer
prepends its own "-" to `fmtFull(Math.abs(...))`. No client source writes a
literal `"$-"` (fix1-walk §8, and fix1-finance §4 greps for the prepend shape
too). The ledger's `+`/`−` in front of `fmtFull(amount)` in Transactions is
left alone: those amounts are always positive and the glyph is the direction.

## Tests

`tests/fix1-finance.test.js` (added to CORE). Browser leg at 1440 and 390;
screenshots with `FIX1_E_SHOTS=docs/fix-1/E`.
