## LIST-5 · The Donors list opens fast (2026-11-11)

**Measured first** (30 reads per view, p50/p95 ms of server time; laptop, `NODE_ENV=production`; staging Harborlight read only). Staging Harborlight read 37–62 ms (p95 ≤ 81) for every view, so the 1.3 s p95 is the list under load (SCALE-3's nightly, a saturated runner), not one read; the fixes were chosen to cut the work each read does.

| view (10k) | roles | page | drift | room | server before → after |
|---|---|---|---|---|---|
| default (Donors) | 11 | 80 | 29 | 14 | 141/145 → 92/94 |
| Everyone | 6 | 79 | 29 | 14 | 135/149 → 94/106 |
| search "smi" | 125 | 163 | 8 | 3 | 302/360 → 255/285 |
| sort by total | 6 | 80 | 29 | 14 | 134/145 → 93/94 |
| saved, two conditions | 77 | 116 | 29 | 14 | 256/343 → 186/192 |

**What was slow, and the fix.**
- *Role counts.* Everyone and Donors were two COUNTs, and the page counted a third time. A search's person match (personMatch.js) costs about 120 ms a pass at 10k, so a search made four passes. `groups.directoryRoles` now counts Everyone and Donors in one grouped statement (Donors is Everyone's own WHERE plus the donor predicate, the same SQL role=donor adds; Contacts is the difference, as before), and the page's total is read from it (`totalFromRoleCounts`); Everyone's page reuses the filter the counts built. Two passes now.
- *The default order is Lifetime.* Picking page 1 sums every person's gifts (one probe of gifts per person; 77 of the 80 ms). A set-wise sum was 25% faster but is new SQL for a total, and SPEED-3's guard forbids gifts by a sequential scan, so instead `gifts_person_money` (org_id, donor_id) INCLUDE the columns MONEY/GIFT/AFTER_IMPORT read: each probe is index-only. Same SQL, 70 → 49 ms. Built CONCURRENTLY in the background after boot (`server/db/list5Indexes.js`, lock_timeout 1 s with retry), never awaited.
- *Ruled out by the table:* the gift count is not per row in the org (Postgres evaluates it after the LIMIT, only for the page's rows); drift and Room to give already read only the page's ids. They ran one after another with the columns and Lifetime; the four now run side by side, each with its own Server-Timing entry, plus `rows` for the wait.

**Same answers.** Main's code and this branch booted side by side on one database (10k org; a 4k org with contacts, archived people, imported totals and a stale rollup): 21 views each, full JSON identical except the signed photo URL. No cache was added, so there is no after-write case.

**Test.** `tests/list5-fast-list.test.js` (the brief asked for both checks; one suite). §1: 16 views on a 10k org recomputed in-test with main's statements (separate counts, the flat SELECT, its own COUNT, giftCount.js, lifetime.js). Planted: the row's gift count from the stored rollup → 16 checks red. §2: default view median of 5 under 700 ms, and gift probes per read under 1.25 per person (clean 8,205; main the same). Planted: a per-person gift count in the WHERE → 16,105, red. The time budget alone could not catch that on a laptop (main is already ~140 ms here), which is why the probe count is there.
