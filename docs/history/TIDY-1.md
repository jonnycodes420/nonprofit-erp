# TIDY-1 · The morning email can be previewed and tested, Atlas groups don't pile up, MONEY-3's loose ends

Brief of 6 Nov 2026. Report: `.claude/reports/TIDY-1.md` (main checkout).

## Why
- **The morning email could not be seen.** Muse's walks had no preview, no history and no test send, so
  nothing on screen could be checked against what went out. What one person's email carries and says was
  inline in `runMorningBriefForOrg`; it is now `server/mail/morningBrief.js` (`composeFor`, `renderFor`),
  the one builder the tick, the preview (`GET /me/morning-email`) and the test send
  (`POST /me/morning-email/test`, `server/org/morningEmail.js`) all call. The preview returns the email
  as it lands (the org header plus the body), byte for byte what the sink captured from a real run. The
  test goes to the signed-in person's own address read from her row (never a body field), subject
  `[Test] …`, at most 3 a day through the digest ledger (`morning_test`, slots `day:<date>#1..3`), and
  reserves no morning ledger. "Last sent" reads the `thread_nudge` / `daily_tasks` ledger rows.
- **Atlas's groups piled up.** Every "Open list" saved a group forever. They are marked
  (`audiences.made_by='atlas'`), listed apart under "From Atlas", and a daily sweep
  (`server/groups/atlasExpiry.js`) deletes them after 30 days unless renamed (`renamed_at`), kept
  (`pinned_at`, the Keep button) or named by a campaign's segment. Groups made before this build carry no
  mark and are never swept.
- **MONEY-3's loose ends.** `tests/lib/drainQueue.js` now waits for `importRecent` too. Home's "also"
  lines are keyed by `alsoKey` (pledge id, else kind and place). The after-change rhythm write
  (`server/donors/rhythmGuard.js`) carries an md5 of the person's gift rows read before the gifts, and the
  upsert lands only while the gifts still print the same, in the same statement; a skipped person is
  rewritten by whichever call changed the gifts.
