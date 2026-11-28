## IMPORT-13 · A messy migration lands right, not just close (2026-11-28)

Jarvis's import gauntlet (27 Nov) ran a real migration in order through staging's UI in org_stagewalk and graded it
against a key built without the import code: gift dollars landed $2,164.00 over the key, "close, footed, and wrong".
The gauntlet's files were not on this Mac, so `tests/fixtures/import/gauntlet/make.cjs` rebuilds the eight passes from
the brief's description (same names, same shapes, its own key from the rows it writes; the scale file's corrected key,
493 creatable people of 500 names).

**What the gauntlet found, and why, read from the code and reproduced (staging, real clicks; and the local API):**
- **A gift ID twice in a file landed twice, and a resent ID with a new amount landed as a new gift.** The one reader
  never stored a gift's ID: re-imports were deduped only by a hash of the row's cells, so any changed cell (a note, the
  amount) was a new gift. It now stores `external_id`, sets the second in-file row aside, and asks about a changed one.
- **The workbook screen's Pledges role wrote 0 pledges.** `extractWorkbookPledges` read a "Donor Name" column as the
  person's ID and the client sent no name, so the server could not place the pledge. Found beside it: on a workbook
  joined by ID (no name column on Gifts), a gift equal to the sum of the rows above it was read as "a total row" and
  silently lost ($100 of Wanda's $200).
- **"next Friday" and "not a date" landed undated.** IMPORT-4 had decided "a blank or unreadable date is an undated gift";
  the gauntlet's key used BUILD-77's error rule. Neither is switched silently: blank stays undated, unreadable is set aside
  by default with "Import them undated" one click, each counted on its own line.
- **Every negative row was set aside** on a spreadsheet no system claims (IMPORT-12 netted refunds only for known
  exports), so lifetimes overstated. **Identical no-ID twins** were set aside as IMPORT-11 copies in a file and dropped as
  "already here" across files. One rule now: a negative row is its gift's refund or "a refund with no gift to match"; twins
  are counted, in a file and against what the org holds.
- **"TOTAL CONTACTS: 3" became a person** (the total-row rule needed money on the row) and **an email-only row was a person
  named by its email**; the one reader listed deceased and do-not-contact notes with no way to apply them.
- **The receipt and Undo said different things.** The footing folded "already here" into "set aside" while the headline
  counted them apart; the set-aside reasons dropped a negative part ("other reasons $750" of $720); the client computed the
  undo date from the browser's clock in UTC while the Imports list used the org's zone (Dec 28 against Dec 27); Settings
  said 7 days for a gift file and 30 for a spreadsheet when every door is the one reader; the re-import warning said every
  gift would come in a second time; a partial undo run as a job read "Undone." because the job's sentence replaced the result's.

**Found and left for the next brief:** Home's "of the N people drifting" counts the high-confidence drifters while Drift
lists all of them; the truth check compares the two and disagrees once a file brings in hundreds of lapsing people (the
scale pass: Home 11, Drift 205). §I13 skips that one comparison (`homeDrift`) on passes 6 and 7 and says so. On staging,
org_stagewalk's scale file asked 494 questions: the fleet's earlier gauntlet runs left QAIMP people there.
