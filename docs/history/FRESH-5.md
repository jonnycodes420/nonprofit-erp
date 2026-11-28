# FRESH-5 · The writes FRESH-4 didn't reach (28 Nov 2026)

**Why.** With FRESH-4 live the fleet still saw stale screens after a task, a gift or pledge delete, a file, a note, a call delete, hours and a shift delete, and "Epsilon's Donors list row stayed Lapsed after his profile returned to Current".

**Measured first (staging dca9e01, the walker, org_stagewalk, real clicks; for each write: the answer's X-Steward-Changed, what was announced, every GET in the next 1.6 s, and the screen).**

| Write | Seen in | Class | What it was |
|---|---|---|---|
| Task (Add a task → Create Task) | 343 ms | none | fresh on c03e332+FRESH-4 |
| Note (Add a note → Save) | 150 ms | none | fresh |
| File (Files → upload) | 76 ms | none | fresh |
| Call delete (⋯ → Delete) | 339 ms | none (d checked) | fresh; the optimistic copy now yields to the server's list |
| Gift delete | 165–254 ms | none on the profile; **c** on the list | profile's Lifetime fresh. The list's Stage is stored (`donors.stage`): it says Ongoing care while the profile says Lapsed until the nightly sweep |
| Gift edited into this month, for a Lapsed person | — | **c** | the stage stayed Lapsed for good: only a *new* gift un-lapsed (autoUnlapseOnGift). This is "Epsilon" |
| Pledge for a Lapsed person | — | **c** | the un-lapse ran on the queue: Lapsed at the answer, Ongoing care ~4 s later |
| Pledge delete | not in 4 s | **c** | "Suggested one-time ask: $1,875" stayed: `/donors/:id/status` and `/scores` served the stored scores for >1.5 s (fresh by 7.5 s). The delete ran no after-change step, so FRESH-4's bypass saw nothing landing |
| Hours (profile; Volunteers → Log shift) | 82 / 112 ms | none | fresh; header and counts card re-read |
| Shift remove (Volunteers → Records) | 191 ms | none | fresh |
| Printed letters, letter PDFs, BrandKit letter, Word preview, screening file | — | **a** | five POSTs with a bare `fetch()`, outside api.js: "mark these as printed" announced nothing |

**What changed.**
- **The stage settles inside the write** (`afterChange()`, before the answer): `unlapseHeldByPledge(orgId, ids)` runs for the people touched, and it has a third branch: somebody Steward placed in Lapsed whose own giving is no longer lapsed by the one rule (`lapse.lapsedSql`) goes back to Ongoing care, with the automatic move. The nightly sweep runs the same branch for the whole org, so the rows already stuck move tonight. `scripts/ops/fresh5-stuck-lapsed.js` counts them first (read-only).
- **A row taken off a person runs the after-change step** (`server/shared/trash.js` trashRow, and Undo in `server/donors/records.js`), and so does a pledge's edit. That is what makes the scores bypass see the change.
- **Every write goes through api.js.** `apiWriteFile` is apiFetch's write path answered with the Response; the five raw POSTs use it. `scripts/ci/raw-write-scan.js` (CI's guards job, with a self-test) fails on a `fetch()` with a non-GET method anywhere else, the signed-out and public pages aside, each with its reason.
- **The read census** (`tests/lib/surfaceCensus.js` readsProblems): a component that reads with apiFetch and listens for no change fails unless allowed with a reason, or on `tests/lib/readsOutsideLive.json` (182 files when the rule came in; it only shrinks).
- **Optimistic copies yield.** A call deleted reads the record again after the answer and puts the old list back at once on a failure; Home's setup card puts itself back with the reason when the save is refused.

**Not done here (next build).**
- After a gift delete the list's Stage still says Ongoing care until the nightly sweep moves the person to Lapsed. Doing it in the write would put an automatic move line on the timeline, and THANKS-1's rule is that a gift delete writes nothing there. The two rules need Jonathan's word.
- The read census's baseline is 182 files. Many of the profile's hooks are on it only because the profile's one refresh (`useProfileFiles.jsx`, useProfileRefresh) re-runs their loaders from another file; a "re-read by" marker the census checks would take them off.

**The guard.** `tests/stale2.test.js` §E2 (the two static rules and their plants) and §N (`tests/lib/fresh5Walk.js`: each write with real clicks, on screen within 1.5 s, no reload, on the profile, the Donors list and Volunteers).
