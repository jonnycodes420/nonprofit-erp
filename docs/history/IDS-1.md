## IDS-1 · Every new id is long enough never to collide (2026-11-03)

- **Why.** On 3 Nov POOL-1's battery hit `duplicate key value violates unique constraint "threads_pkey"` once
  in DATES-1's bulk "Add to a journey". It was not a race. Ids were `"th_" + uuid().slice(0, 8)`, and 8 hex
  characters (4.3 billion values) give even odds of a repeat at ~77,000 rows in a table shared by every org.
- **One helper.** `server/shared/newId.js`: `newId(prefix, sep = "_")` returns prefix + sep + 20 hex from
  `crypto.randomBytes` (80 bits). Every server-side `uuid().slice(0, N)` that made a row id now calls it with the
  same prefix, as do the dash-stripped UUIDs cut to 12 hex or fewer and `hh_` (4 random bytes). Old rows
  keep their ids; nothing in the database was rewritten.
- **Shape checks** that pinned the old length now take both: `et_` (12 or 20 hex) and `wid_` (8 or 20 hex). Every
  id column is TEXT (checked on the live schema: no VARCHAR or CHAR column exists).
- **It stays fixed.** The arch-check's `short-ids` rule is a hard 0 for `uuid().slice(` in server code.
  `tests/ids1-new-ids.test.js` pins the helper, the thread collision (red on main, 500 `threads_pkey`), the old ids
  and the planted ratchet defect.
