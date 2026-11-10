## MONEY-4 · AWARDED GRANTS WITH NO AWARD ROW, AND OLD EIN COPIES (2026-11-09)

1. **Grants, dry run** after the deploy, from `~/nonprofit-erp` after `git pull`: `railway run -- node scripts/ops/money4-grant-awards.js` (writes nothing; lists each grant at an award stage with no award row, what award it would record and whether its typed Received becomes the first payment, or "left for a person" when there is no funder record or no amount).
2. **Grants, apply**: `railway run -- node scripts/ops/money4-grant-awards.js --apply --i-know-this-is-prod`. One award pledge per grant on the funder (the awarded amount, else the requested amount), then the typed Received as its first payment through recordGift. A second run writes nothing.
3. **EIN, read only**: `railway run -- node scripts/ops/money4-ein-copies.js` lists orgs whose giving-page EIN copy differed from Settings → Tax Receipts. Their public footer now shows the Settings EIN; check each one is right.
