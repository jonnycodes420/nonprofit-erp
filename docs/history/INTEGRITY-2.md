# INTEGRITY-2 · Trash you can restore from, deletes that clean up after themselves (2026-11-08)

**Why.** The fleet's 7 and 8 Nov synthesis: Fiona Callahan ($35,000) went to the trash in a Finance import undo she was
not part of, and Trash offered only "Empty trash" for 267 people (W-1107-Finance-35); Everyone read 1,218 against 1,217
and nobody could name the extra (W-1107-Prod-04); the 1,000-row undo kept Hugo Kovac and needed a second click
(W-1107-Finance-17); a deleted donor left "Owner: … $0" on two businesses (W-1108-Donors-45X); Delete donor did not
ask (W-1108-Finance-50X); a deleted meeting left its prompt and tasks (W-1108-Volunteers-17X).

**Fiona's path.** INTEGRITY-1 tied a "Bring them back" stamp to the file's fingerprint. The fleet imports the same
fixture files from several areas, so two areas' files have the same fingerprint: one user's Bring them back was claimed
by another user's import of the same file, and that import's Undo trashed her. Reproduced on main (her trash row names
the other user's import). The claim now needs the stamp's presser to be the importer too.

**The rules now.** One door out for a person (`personTrash.trashPeople`): deleted_at, a trash row with who and why,
and their links (`server/donors/personLinks.js`) kept on it; the one door back (`bringPeopleBack`) restores them. The
Trash list and the 30-day clear-out are `server/donors/trashList.js` (the 30 days count from 9 Nov at the earliest, so
nobody already in the trash is deleted on the day this shipped). Who an undo may move, and what counts as activity
since, is `server/imports/undoPeople.js`: never by name or email; a record holding gifts from before the import never
moves; a line Steward wrote by itself is not activity; the choice to move the active ones is in Undo's confirm. A
deleted meeting (`server/donors/meetingTrash.js`) takes its open tasks, next step and prompt; Done tasks and notes stay,
labelled. "Where does N come from?" is `shared/numbers/everyoneBreakdown.js`, on the same Everyone fragment.

**Existing rows.** `scripts/ops/integrity2-trash-residue.js` (dry run; `--apply` moves links left on trashed people onto
their trash rows; the Fiona-shape people and orphaned meeting tasks are listed for a hand click).
