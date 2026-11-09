## PLEDGES-3 · SEE WHICH OLD ROWS STILL NEED A PERSON (2026-11-08)

1. **Dry run only** after the deploy, from `~/nonprofit-erp` after `git pull`: `railway run -- node scripts/ops/pledges3-old-rows.js` (writes nothing; lists pledges whose installment flags disagree with their payments, receipts whose gift changed after issue, and grants awarded with no award row).
