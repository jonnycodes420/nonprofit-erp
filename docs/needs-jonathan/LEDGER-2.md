## LEDGER-2 · Book the income of grant awards recorded since GRANTS-FIX (prod database credential)

- Dry run (writes nothing): `DATABASE_URL=… node scripts/ops/ledger2-award-rows.js --i-know-this-is-prod` (add `--org=<org_id>` for one org).
- Apply: `DATABASE_URL=… node scripts/ops/ledger2-award-rows.js --apply --i-know-this-is-prod`. One ledger row and one audit row per award; a second run books nothing.
