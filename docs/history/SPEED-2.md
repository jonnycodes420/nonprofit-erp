# SPEED-2 · Nothing a person waits on takes more than 3 seconds without saying why

Muse's walk (6 Nov, Feel 1) waited on merge, the import preview, the giving page
editor, Settings and Atlas. Measured on the walk-sized fixture (1,000 people) at a
150 ms browser round trip, and on the server at prod's 17 ms database round trip.

**Why merge was slow.** `mergeInTx` walked MERGE_REFS (about 90 pointer columns) one
at a time: an `information_schema` read for the id column, a read of the rows, then
savepoint, UPDATE, release. A typical pair was 202 statements, and opening the
side-by-side screen was 176 more (one COUNT per column per person). At 17 ms a
statement that is 3.6 s and 3.0 s before any work.

**What changed.** `server/donors/mergeMoves.js`: the table shapes (id column, every
unique or exclusion key) are read once per process; the merged person's rows in every
column come back in one UNION ALL; every column no key covers moves in one statement
of data-modifying CTEs (one per table per statement); a keyed column still moves under
a savepoint and only goes row by row when its key objects (the twin is set aside, or a
"refuse" table refuses), unchanged. The moved and set-aside records keep their shape,
so undo is untouched. The pair screen counts in one statement per person, both at once.
Merge: 202 → 21 statements, 3,605 → 409 ms. Pair: 176 → 4, 3,047 → 120 ms.

**The rest, measured and not slow here.** A 1,000-row gift file previews on the server
in about 400 ms at prod's round trip (9 statements); in the browser at 150 ms, from
picking the file to the preview drawn, 1,364 ms, and 1,335 ms once the spreadsheet
reader starts downloading when the import window opens (SpreadsheetImport.jsx). Every Settings section is ready at
about 1.6 s at 150 ms, its own reads in parallel; the wait is the Settings code arriving.
The giving page editor is ready at about 1.5 s, its six reads in parallel. What Muse saw
on prod in these three was not reproduced on this fixture; the next look is prod's
/ops page timing for them, which does not name Settings sections or the editor yet.

**Atlas** was left: ATLAS-4 (#355, open) is changing the same answer path for speed.

**Seam.** `countedClient` (server/db/query.js): under TEST_MODE a transaction's
statements are counted and pay TEST_DB_LATENCY_MS, as pool statements already did.
