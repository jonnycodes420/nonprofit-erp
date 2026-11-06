# IMPORT-9 · Undo really undoes, and a messy file says what it guessed (2026-11-05)

**Why.** Muse's Walk B (5 Nov), on a real-shaped demo org: a 1,000-row file was imported and undone, its people ended
in the trash ("Remove them too"), and the file was imported again. The preview matched the 199 people in the trash and
"Bring them all back" restored them. Undoing that second import removed the gifts and left all 199 live at $0:
Everyone went from 1,017 to 1,217 with no safe way back. The same walk saw "3/4/25" read as March 4, a Date column
mixing formats and "$75.5" all normalised without a word.

**Cause (undo).** An import's undo knew the people it created (`donors.created_import_id`) and the fields it changed on
people already here (`summary_json.personChanges`). Who it had brought back from the trash was written nowhere: the
bring-back closed the trash rows and the import then saw ordinary matched people.

**Fix.** `server/imports/restoredPeople.js`. Bring them back stamps each trash row it closes
(`row_data.__bringBack`); the import's write claims the stamped rows of the people it matched (closed in the last day,
not yet claimed) inside its own transaction and lists them as `summary_json.restoredFromTrash`; Undo puts each back in
the trash with a fresh trash row, unless a gift, note, call or task was added since (then they stay, named). The undo
sentence says "199 people it brought back from the trash are back in the trash". The restore question and the
bring-back answer say how many come back and that undo returns them. No schema change.

**Cause (dates, amounts).** `profileColumn` set `dayFirst` only when some cell's first number was over 12; otherwise a
column was read month first in silence. Amounts went through `normalizeMoney` and nothing counted what it changed.

**Fix.** `shared/sheetGuesses.js`: `dateOrderFor` asks once per column when its numeric dates could be either order
and nothing in the column settles it (or it holds both), with up to four cells read both ways; the answer
(`answers.dateOrder`) decides the read and Import stays closed until it is given. A known export shape reads month
first and says so. `mixedDates` lists rows written in a different format from the column's main one; `amountTidier`
counts and lists tidied amounts on the rows that became gifts or pledges. The preview shows them
(`client/src/components/import/SheetGuesses.jsx`). The cell readers moved to `shared/sheetCells.js` so
`shared/sheetRead.js` stays under its ratchet.

**Cleanup.** `scripts/ops/import9-undo-leftovers.js` finds, from the bring-back audit rows, people restored by a
bring-back whose next import into the org was undone, with nothing added since the bring-back and no audit row naming
them since the undo. Dry run by default (org id and count); `--apply` trashes them with one audit row per org;
`--undo=<audit id>` brings them back; a second run of either changes nothing.

**Tests.** `tests/import9.test.js` (the one new suite: donor data). Red on main 12 of 13 (the pass is a precondition;
main ends the walk at 216 people, 17 + 199). Planted: undo skipping restored people turned §1's final check red;
guessing the date silently turned all three §3 checks red.

**Not done.** The workbook screen (`/donors/import-combined`) has no bring-back and was not changed. The old CSV
wizard's own date handling was not changed.
