## INTEGRITY-1 · TWO DRY RUNS TO READ, THEN APPLY (2026-11-07)

- Run `node scripts/ops/integrity1-find-vanished.js` against prod (dry run, org ids and counts only); if CREO Arts (Demo) or any org is listed, run it again with `--apply` (one audit row per org; `--undo=<audit id>` reverses). This brings back people an import's undo trashed who were here before that import (Fiona Callahan, W-1107-Finance-35).
- Run `node scripts/ops/integrity1-duplicate-invites.js` against prod (dry run), then `--apply`: it revokes all but the newest pending invite per address. The next deploy or restart builds the unique index `invites_one_pending_per_email`; until then the boot log says it was not built.
