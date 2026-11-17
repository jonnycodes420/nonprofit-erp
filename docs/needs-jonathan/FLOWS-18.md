# FLOWS-18 · needs Jonathan

- Optional, read only: list saved campaign drafts and email templates on prod that still name `{{year}}` or `{{total_giving}}` (from the old Year-end starter), so the team knows which to open and edit: `DATABASE_URL=<prod db> node scripts/ops/flows18-starter-tags.js` (then `--org <id>` for the names). It never writes.
