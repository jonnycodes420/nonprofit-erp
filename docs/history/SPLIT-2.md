## SPLIT-2 · the three full files get room to breathe, with nothing changing on screen (2026-11-05)

`server.js` was 12,906 lines, `db.js` 9,778 (both at their ratchet limit) and `DonorProfile.jsx` 1,460 (40
under the 1,500 cap). Builds were working around them. All three are now shells: server.js 22 lines, db.js 47,
DonorProfile.jsx 260. The arch-check's new `split-shells` rule caps each at that size.

**db.js** moved by concern into `server/db/`: `pool.js` (the pool and request limits), `query.js` (query, run,
transactions, advisory locks), `schema.js` (initSchema, the DDL session, the database lock), `ddl/part1…7.js`
(runSchemaInit's 1,496 statements cut at statement boundaries, run in order), and `seed.js`. db.js keeps getDb
and the one export list, so no caller changed. One line changed: the schema hash used to be a hash of db.js
(`__filename`), and an edit to a DDL part would then not have run the init. It now hashes db.js plus every file
under server/db/ (`schemaSources.js`). The proof: a fresh database built by the split code dumps (`pg_dump
--schema-only`) identical to one built by main, and the split code booting on main's database ran the init once
and stored the new hash.

**DonorProfile.jsx**: the tabs, header, rail and dialogs were already parts (PROFILE-3). What filled the file was
the component's own state and handlers, about 1,200 lines in one scope. They moved verbatim into six hooks under
`components/profile/` (useProfileRecord, Actions, Pipeline, Giving, Files, Rail), called in the order they were
written. This works because of a fact, checked with eslint-scope before cutting: of 305 statements in the
component, only one read a name declared below it (lines 129 and 130, kept together), and none assigned another
statement's variable. So a hook needs only what earlier hooks return, and the hooks run in the same order every
render. The proof: Playwright screenshots of every profile tab, at 1440 and 390, for three people (two with the
most gifts, one with none) in an org loaded from the real-shaped gift and contact files. Main's build against
this build: 48 of 48 identical to the pixel. A first run differed in one spot on both builds alike: the rail's
status read "Updating…" on the first view, before it was computed.

**server.js** is the hard one: one script scope, 318 functions hoisted to the top, and 27 top-level `let`s that
code reassigns later (lazy imports landing, `dbReady`, sweep statuses), some read thousands of lines away. The
split: the functions go to `server/boot/helpers-N.js`, loaded first (a function existed from the start, as
hoisting made it). Every other statement goes to `steps-N.js`, required in server.js's order, so route order
and middleware order cannot change. Each module keeps its own copy of each server.js name it reads.
`server/boot/share.js` refreshes every copy after each statement that declares a name, and after each of the 34
later writes, where the generator added ` __share({ name });` right after the write. The proof is
`scripts/ci/route-diff.js --strict` (SPLIT-1's tool): the same 1,462 routes, the same middleware chain on each
(names and function-source hashes), the same order for the 63 pairs that can answer one request, and
`readSource("server.js")` byte-identical to main's.

How the suites keep reading the old text. Each moved block is marked `// SPLIT-2 <file> piece N` …
`// SPLIT-2 end`, and is the file's own text, with relative requires written from the new folder.
`readSource("server.js")` and `readSource("db.js")` put the pieces back in N order: they reverse the require
paths and drop the inline `__share` calls. For server.js that is byte for byte main's file, and the FIX-1 and
SPLIT-1 stitching then runs on it unchanged. `splitText(rel)` gives the file's own text for a suite that used to
read the raw file, and `isSplitPiece(f)` lets a suite that walks the tree skip the pieces.

The rule going forward: a new top-level name in server.js's modules that a function reassigns needs
` __share({ name });` after the write. A new migration goes at the end of the last DDL part. New profile state
goes in the hook it belongs to.
