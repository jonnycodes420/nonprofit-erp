# IMPORT-12 · For the fleet

**Surfaces changed:** Import a spreadsheet (the preview's "Read as a … export" line, now naming a people file and a
gifts file as one import, and its set-aside list, which no longer lists refunds). The import receipt. The person's
record: gifts carry a refund row against them, and the Soft credits, tribute and anonymous marks. The import check
page (Imports → an import → Check your file).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Donors → Import & tools → Import a spreadsheet → choose BOTH
   `tests/fixtures/import/systems-full/neon-accounts.csv` and `neon-donations.csv` at once. The preview says "Read as
   a Neon CRM Accounts + Donations export." and asks nothing. Import shows Import (not Answer). Import, then open Check
   your file: no line shows ≠, and the money line reads $6,376,647.80 both sides.
2. **(Needs a write.)** In that org, open a person whose gift was refunded (Gifts tab, a negative row "Refund of the
   $… gift of …"). Their Lifetime leaves out the refunded money, and the refunded gift reads refunded. Press
   Undo on the import from its receipt: the person and both rows go.
3. **(Needs a write.)** Off the happy path: choose only `bloomerang-transactions.csv`. The preview still reads the
   gifts, but each person is known only by Account Number and name. Write down what the preview says about the
   missing Constituents file: the sentence naming it is not built yet (OPEN, item 3).
4. **(Needs a write.)** Import the same two Neon files a second time. The preview asks "You imported this file on …
   Import again anyway?". Say yes: the receipt says every row was already here, and no count on Home moves.
5. **(Read only, Harborlight.)** Open any person with a soft credit: the soft credit shows under Soft credits and is
   not in their Lifetime.

**What could have broken nearby:** every spreadsheet import (the one reader changed how a negative row and a soft
credit row are read); the receipt's gift count, which now counts a refund row as one of its rows; Lifetime, Last gift
and the lapsed tags for people with a gift refunded in full (IMPORT-12-R1, known to disagree between screens); the
Move Report; Data health's duplicates (a person with two old IDs).

**Needs a write:** checks 1 to 4 must run in org_stagewalk, never Harborlight.
