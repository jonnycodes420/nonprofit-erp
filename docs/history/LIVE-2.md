# LIVE-2 · Screens refresh from what the write actually changed (Nov 23, 2026)

**Why.** After a write, the browser chose what to re-read from about forty URL rules in
`client/src/lib/changes.js`. A route the rules didn't name, or whose effects reached further
than its path suggested, refreshed the wrong screens or none. The database already knew which
tables each statement touched (the `org_changes` statement trigger), so SCALE-6's "every write
announces what it changed" was only as true as the rule table's guesses.

**What changed.**
- Every connection a web request uses is checked out for its scope (`requestLimits.checkout`).
  `server/shared/changedTables.js` wraps each pooled client's `query` once and notes, on the
  request's scope, the tables a write statement names (`INSERT INTO`, `UPDATE`, `DELETE FROM`,
  `MERGE INTO`, `TRUNCATE`). The database's own triggers write further (a thread's next step and
  a grant milestone are tasks, a task done writes the person's line, a grant touches its
  milestones); those are read once at boot from `pg_trigger`/`pg_proc` and closed over, so a
  thread write also names `tasks` and `interactions`.
- As the headers go out, every non-GET answer carries `X-Steward-Changed`: the topics of those
  tables, or `none`. The table → topic map is one file, `shared/changeTopics.cjs` (CommonJS
  because `shared/` is ES modules; Vite converts it for the browser), used by the header and by
  the bell's worker marks alike. A per-request collector was chosen over reading `org_changes`
  by transaction id because it costs no round trip and is known synchronously when the headers
  are written.
- `apiFetch` reads the header and announces its topics. The URL rules stay only as the
  fallback for an answer without the header. The ids a path or body names still scope the
  announcement.
- What a request writes after it answers (the after-change step, the queue) is not in its
  header; the bell's worker marks still announce those.

**Reproduced first (local production build, real clicks, main's build A/B'd against this one):**
- Donors → tick a person → More → Move to trash: the row left, the foot said "Trash (0)" until a
  reload showed "Trash (1)". `useTrashCount` listened for a `steward:trash-changed` event that
  nothing in the app ever sent. It now re-reads on any change to people.
- With a profile open, a household made by another door (Data health's Make a household, another
  tab, a meeting panel's chips, Atlas): the card said "Not in a household" 75 s later, past the
  bell's poll. The profile's refresh re-read gifts, thread and files on any change to its
  person, but the household (`refreshSoftCredit`) only on a money change. Now on any change that
  reaches the person. Creating it from the profile's own Household → Add always worked.
- Not reproduced: the profile's header after a gift save (moved at once on main), the list after
  a delete (moved at once). Both are covered by the header now naming exactly what was written.

**The guard.** The tenant matrix already sends every write in the live router's inventory.
`tests/lib/changedHeaderGuard.js` records each answer and fails on a 2xx write without the
header (pure-session and telemetry writes allowed), and on any `org_id` table the map neither
gives a topic nor names SILENT.
