## 0-HARDEN-2 · COUNT THE PEOPLE RESTORED THE OLD WAY (2026-10-27)

- **Run the read-only count on prod:** `psql "$PROD_DATABASE_URL" -f scripts/ops/stale-deletions-readonly.sql` (it begins READ ONLY and rolls back; it prints org id and a count, nothing else). For any org it lists, a dry run shows what would close: `DATABASE_URL=… node scripts/ci/close-stale-deletions.js --org <org id>`; add `--apply --i-know-this-is-prod` only when you want it closed. Not run by the build.
