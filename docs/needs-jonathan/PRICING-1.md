## 0-PRICING-1 · THE RECORD-BAND PRICES IN STRIPE, AND TWO EXISTING DEALS (2026-10-21)

Until step 2 is done, public signup answers "That plan is not available to buy online yet. Write to us" (nothing breaks, nothing is charged).

1. **Live prices:** `cd ~/nonprofit-erp && STRIPE_BILLING_SECRET_KEY=sk_live_... node scripts/ops/stripe-live-prices.js --live` (add `--dry-run` first to preview). Safe to run twice: it reuses what exists.
2. **Railway (nonprofit-erp, production) Variables:** paste the 12 lines it prints (`STRIPE_PRICE_R500_MONTHLY` … `STRIPE_PRICE_R25000_SETUP`). Leave the old `STRIPE_PRICE_T*` / `CORE` / `TEAM` / `FOUNDING` ones in place: orgs may be on them.
3. **Test mode (optional, to see a real Checkout):** the same command with an `sk_test_` key and no `--live`.
4. **Super-admin, Organizations, CKRH:** Custom price `149`, ends on the date you agreed, note "first customer". Do the same for each beta org with `0` and its free-until date. Those orgs are then never moved to a band price.
