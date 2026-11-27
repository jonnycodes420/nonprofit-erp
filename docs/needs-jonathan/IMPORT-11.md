## IMPORT-11 · Gifts already stored over $100,000,000 (prod database credential)

- Read only: `DATABASE_URL=… node scripts/ops/import11-over-cap.js`. It lists org ids and counts only, no names. Each row it finds shows as $0 wherever a reader refused it; correct it, delete it, or undo its import from the app.
