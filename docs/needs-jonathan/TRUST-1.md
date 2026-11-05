## TRUST-1 · Turn off the sequences Steward made and left on (prod database credential)

- Read: `psql "$DATABASE_URL" -f scripts/ops/trust1-steward-sequences-readonly.sql` (read-only; org ids, sequence ids and counts).
- Dry run: `DATABASE_URL=… node scripts/ops/trust1-turn-off-steward-sequences.js --i-know-this-is-prod`, then the same with `--apply` to turn them off (ids saved to /tmp to undo).
