## FIX-42 · Tests that don't care what time it is (2026-10-18)

fix33-sync-proof §3, §7 and §10 were red every night just after New York midnight: the reply that should close
Margaret's Reply step was placed "2.4 hours ago", which at 00:30 is yesterday, before the step opened, so the product
rightly refused to close it (§7 and §10 were knock-ons). `tests/clock.js` is the one test clock: `testNow()`,
`earlierToday()`, `civilDay()`, and `STEWARD_TEST_NOW`, which `tests/shard.sh` preloads into the server and every
suite and mirrors in the shard database's `now()`. A server clock behind Postgres revokes every fresh session, so a
pinned instant is never earlier than the real one. profile1 §6's 8 PM to midnight failure was the product bug
RECONCILE-1 already fixed (`orgStewardStart` in the org's zone). scale1-queue §4 asserted a 1500ms window across two
processes' clocks; it now asserts order. `docs/THESIS.md` is in the repo.
