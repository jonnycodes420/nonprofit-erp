# One schema file per build (RULES-1)

A build's DDL goes here, in its own file named for the day and the brief:
`2026-11-24-rules1.js`. Boot runs every `.js` file in this folder in name order,
after `part7.js` (`server/db/ddl/builds.js`), so two builds never edit the same
schema file. A file named any other way refuses boot.

Each file exports `run(pool)` with additive DDL only (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`), on part7's DDL session (short `lock_timeout`, retry).
No rows are written. Move nothing that already exists into this folder.

`tests/clean1-merge.test.js` reads these files for columns that point at a
person, so a new `person_id` here must join `MERGE_REFS` (or `NOT_MOVED`, with a reason).
