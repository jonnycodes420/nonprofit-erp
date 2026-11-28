## IMPORT-13 · Rows already stored in the gauntlet's shapes (prod database credential)

- Read only: `DATABASE_URL=… node scripts/ops/import13-gauntlet-rows.js`. It counts, per org id, possible repeated gifts within one import, undated gifts whose file had words in the date cell, and workbook imports whose Pledges sheet wrote nothing. No names. Each is decided with the org in the app.
