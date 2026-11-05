## GIFTS-1 · TURN OLD TYPED GRANT "RECEIVED" FIGURES INTO PAYMENTS (2026-11-05)

1. **Dry run** after the deploy, from `~/nonprofit-erp` after `git pull`: `railway run -- node scripts/ops/gifts1-grant-received.js` (writes nothing; lists each grant whose typed Received differs from its recorded payments, with "would write", "left for a person" or "above").
2. **Apply**: `railway run -- node scripts/ops/gifts1-grant-received.js --apply --i-know-this-is-prod`. One payment gift per grant for the difference, from the funder, on the award, dated the award date, marked "from typed Received", one audit row each. A second run writes nothing.
