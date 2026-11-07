## COMMS-1 · one thing is yours (2026-11-06)

- Run the old-sequence-drafts cleanup on prod: dry run `DATABASE_URL=<prod writer url> node scripts/ops/comms1-old-sequence-drafts.js --i-know-this-is-prod`, then the same with `--apply` (undo one org with `--undo=<audit id>` from its output).
