## INTEGRITY-2 · RESTORE FIONA BY HAND, THEN READ ONE DRY RUN (2026-11-08)

- In the app, on CREO Arts (Demo): Settings, Imports, Trash, search "Callahan", press Restore on Fiona Callahan. Then open Donors and press "Where does N come from?" under Everyone: the newest records name the extra one (if it is QA residue, the demo tidy clears it).
- Run `node scripts/ops/integrity2-trash-residue.js` against prod (dry run, org ids and counts only). If part 1 lists an org, run it again with `--apply` (one audit row per org; `--undo=<audit id>` reverses). Parts 2 and 3 are listed only: restore by hand in Trash, close by hand in Tasks.
