# THANKS-1 · Needs Jonathan

- Prod demo (CREO Arts Demo), Priya Anand's "Gift removed" notes: `DATABASE_URL=<prod> node scripts/ops/thanks1-gift-removed-notes.js` (dry run, counts), then `… --org <its org id> --apply --i-know-this-is-prod` to move them off the timeline (one audit row keeps them).
- Prod counts for the report's item 2: `DATABASE_URL=<prod> node scripts/ops/thanks1-receipt-not-thanked.js --i-know-this-is-prod` (read only).
