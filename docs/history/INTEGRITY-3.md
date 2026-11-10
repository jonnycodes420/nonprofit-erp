# INTEGRITY-3 · An import undo can never destroy a person (2026-11-10)

**Why.** Fiona Callahan ($35,000, the demo org) was gone from every surface: not in the Trash, search, the Audit log
or Recent changes. The fleet's trail: a 1,000-row undo put her in the trash (7 Nov), a later import brought her back
and was undone (8 Nov), and the lead noted that undo removed its created people outright (9 Nov). The Everyone
breakdown also said 277 in the trash where the Trash page said 276.

**What reproduced (Playwright, real clicks, production build).** The brief's literal trail (a person here before both
imports) ended in the trash on main, but on a new trash row ("Import undo of b.csv") in place of her own. The trail
that destroys a person is a record an import CREATED (her gifts came with that file), later in the trash and moved in
and out by other imports: undoing that first import removed the file's gifts, found her with none, and ran
`DELETE FROM donors`, taking her trash rows (FIX-52) and writing one row for the whole undo that named nobody. The
277/276 was a record merged into another: the breakdown counted it, the Trash page did not.

**The rule now.** An undo puts every person back to where they were before that import: created people to the trash,
restored people back on their original trash row, active people untouched; nothing an undo does is a hard delete, and
every move is one audit row per person. Empty trash and the 30-day clear-out write one row per person too. One trash
count (`shared/numbers/trash.js`). Two decisions made on the way: a staged import's never-shown people are still
discarded with the preview (ONBOARD-1's rule, now with a row each); and FIX-54's "someone you deleted stays deleted"
leaves out the people an undo trashed because their file created them, so re-importing a file after Undo works as it
always did (otherwise every row would wait on Bring them back).

**What is left.** Rows already destroyed cannot be rebuilt in code: `scripts/ops/integrity3-find-person.js` shows what
is left of a person by name (ids and states only), and `docs/needs-jonathan/INTEGRITY-3.md` has the point-in-time
restore steps for one row. People sent back on a new trash row before this build are counted by
`scripts/ops/integrity3-trash-rows.js` (dry run); the repair is REPAIR-1's.
