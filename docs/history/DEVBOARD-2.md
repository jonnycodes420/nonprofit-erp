# DEVBOARD-2 · every part of Steward on one map, with a check you can run from /ops

**Why.** Jonathan wanted to see every part of Steward from /ops and spot-check any of it in two minutes, without waiting for the 5 AM walk.

**The map** is `ops/map.json`, in the repo next to the board: 18 areas (the 17 the brief names, plus Ops), each with its walk-id prefixes and 3 to 7 checks. Profile has seven checks, one per profile tab, because the brief asked for each tab. Map check ids are letters (`Gift-A`). A walk's ids are numbered (`Gift1`), and nobody had the walk's own checklist, so a map check is never merged with a walk check it may not mean. A walk check shows as its own row in the area its prefix names, and a prefix that no area holds lands in Unsorted, which is always shown.

**The walk's last result per check** is a new `results` object in `ops/board.json`, written by `applyWalk`. An older walk imported after a newer one never overwrites it.

**Jonathan's marks** are rows in `ops_checks`, made by `opsMapRoutes.js` at boot and before a write, never by a read. As with `ops_snapshots`, the table lives in its own module because db.js is at its size limit. The rows are append-only, and an item's state is worked out from them (`opsMap.itemsFromChecks`):
- A Fail opens `J-<MMDD>-<check>`.
- More Fails while it is open join that item.
- A Pass verifies it.
- A Fail after that opens a new item.

`seq` orders the rows, because two marks can land in the same millisecond. The board merges both sources (`mergeBoard`): an open walk item shows as verified once Jonathan passes its check on or after its last walk FAIL.

**Open in demo** is built only by `opsMap.demoHref`:
- It goes through `/login?next=`, so the tab signs in as the demo director.
- Its path must be on a short allowed list and must not name an org.
- A person is looked up by name in the demo org only (`demoPeople`: org id = the demo's, and `is_demo_org`).
- A name the demo does not have opens the Donors list. It never guesses.

A super-admin already signed in who opens one of these links is sent to /admin by the login page. So the page says to use a private window.
