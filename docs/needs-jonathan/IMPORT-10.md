## IMPORT-10 · three prod scripts, dry run first (2026-11-12)

- Imports that left a person's row out as a "total" (read only, lists org/import/line/amount): `DATABASE_URL=<prod> node scripts/ops/import10-lost-total-rows.js --i-know-this-is-prod`
- Imported auction purchases with no winner: `DATABASE_URL=<prod> node scripts/ops/import10-auction-winners.js --i-know-this-is-prod`, then add `--apply` (undo: `--undo=<audit id>`)
- People marked donor who never gave: `DATABASE_URL=<prod> node scripts/ops/import10-donor-roles.js --i-know-this-is-prod`, then add `--apply` (undo: `--undo=<audit id>`)
