# IMPORT-13 · For the fleet

**Surfaces changed:** Import a spreadsheet (Donors → Import & tools → Import a spreadsheet): four new boxes on the
preview, each listing its rows with a suggested answer: **dates Steward couldn't read** (Set them aside / Import them
undated), **people with only an email** (Set them aside / Use the email as their name), **gifts changed since your last
import** (Set them aside / Update to the file's amount) and **notes that read like a flag** (Leave them as they are / Mark
them as the notes say). The set-aside list's new reasons (a gift ID already in the file, a total line, a refund with no gift
to match). The undo line under Import (now the org's time zone). The "You imported this file on…" question (time of day,
and "Gifts already here are skipped"). The import receipt: its gift line ("37 gifts $5,620 · 1 refund -$45 · $5,575 in
all", each part opening its rows), its row footing ("… 6 written + 15 already here + 1 set aside"), its dollar footing by
reason, the unreadable-dates / twins / changed-gifts lines, its undo date. The import check page (`/imports/<id>/verify`,
the same lines). Undo's confirm and its result ("Undone, except 1 person you kept: … (a note was added Nov 27)").
Settings → Imports (one undo window sentence). The workbook screen (multi-sheet .xlsx with names on the gifts sheet): the
Pledges role, the "Not imported yet: …" stop when a sheet reads UNBALANCED, and the "Not finished: …" receipt headline.

**Clicks to try for the next three nights** (made-up files; the generator is `tests/fixtures/import/gauntlet/make.cjs`,
run `node tests/fixtures/import/gauntlet/make.cjs` and use its pass files):
1. **(Needs a write: org_stagewalk.)** Import `pass1-contacts.csv`. Right: 20 people, and the set-aside list has
   "row 22: a total line ("TOTAL CONTACTS: 20"), not a person"; nobody named TOTAL on the Donors list. Receipt: "21 rows in
   the file = 20 people created + 1 set aside ✓".
2. **(Needs a write.)** Then `pass2-gifts.csv`. Right: "2 gifts have no date." and, separately, "1 gift has a date Steward
   couldn't read: 'next Friday'" with Set them aside outlined; the set-aside list names "gift ID ST-001 is already on row 2"
   and "Cora Fenn … a refund with no gift to match (-$30)". Import: 37 gifts and 1 refund; Amelia Hart has one Jan 15 $250;
   Rita Calloway's Lifetime reads $100. Off the path: before importing, press **Import them undated**: the count becomes 38
   gifts and the line still lists 'next Friday'; press **Set them aside** again before importing.
3. **(Needs a write.)** Then `pass3-reexport.csv`. Right: "1 gift has changed since your last import: ST-001 was $250.00,
   the file now says $999.00." Import with the default: 6 gifts, $1,225; New Donor One reads $500; Amelia's ST-001 is still
   $250. The receipt's row line reads "22 rows in the file = 6 written + 15 already here + 1 set aside ✓".
4. **(Needs a write.)** A one-row CSV `Gift ID,Donor Name,Email,Gift Date,Amount` / `ST-001,Amelia Hart,
   amelia.hart@stress.test,2026-01-15,$999.00`; choose **Update to the file's amount**, Import: Amelia's ST-001 is $999,
   still one gift. Undo that import: back to $250.
5. **(Needs a write.)** `pass4-workbook.xlsx`: 6 gifts $375 (Wanda Pryce has both $100 gifts) and 1 pledge $900 on Wanda's
   Giving tab. `pass5-ugly.csv`: "3 people have only an email. Use the email as their name, or set them aside?"; nobody
   named orphan@…; "2 notes read like deceased, do not contact…" with **Leave them as they are** outlined; Ottoline Brack is
   not marked deceased unless you press **Mark them as the notes say**.
6. **(Needs a write.)** `pass6-scale.csv` (2,500 rows): 493 people, 2,465 gifts, "5 gifts have dates Steward couldn't
   read: 'not a date'"; no QAIMP Scale Donor 250 is made. (If it asks hundreds of "more than one QAIMP…" questions, earlier
   gauntlet runs left those people in org_stagewalk: empty them from the trash first.)
7. **(Needs a write.)** Import `pass2-gifts.csv` again: "You imported this file on Nov 28, 10:15 AM (37 gifts). Gifts already
   here are skipped. Import again anyway?" Import again: "Nothing new". Then add a note to Leah Sandoval, open Undo on the
   pass5 receipt: the confirm names Leah ("a note was added …") before anything runs; Undo: "Undone, except 1 person you
   kept: Leah Sandoval (a note was added …)". Settings → Imports, the receipt and the Undo line all give the same date.
   Undo every import at the end.

**What could have broken nearby:** every import receipt (the gift line and footing are shared: real-shaped files, the
Finding Joy workbook, auction sheets, known-system exports); the Imports list's "Does not reconcile" flag (footing.js);
recordGifts' batch insert (now storing the gift's ID; a file whose IDs collide with gifts from another import path now
counts them already here instead of erroring); Settings → Imports' window sentence; Undo for old mapper runs (now 30
days, not 7); refunds on any spreadsheet (Lifetime, last gift, LYBUNT for people with a refunded gift); the copies rule
(rows with an ID still skip by default; rows with no ID now import).

**Needs a write:** every click above runs in org_stagewalk, never Harborlight.
