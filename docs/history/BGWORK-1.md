# BGWORK-1 · The mailbox alarm reads the live orgs, and a test org can be made live on purpose

Jonathan, 24 Nov: SCALE-5's live-orgs filter stopped the mailbox read for internal_test orgs (TEST
STEWARD last read 18 Nov 19:45 UTC), but `refreshMailboxSyncHealth` still checked every connection
and logged `[mailbox-stale]` every five minutes for a mailbox nobody was meant to read.

- The stale check moved to `server/mail/staleMailboxes.js` and reads `liveOrgIds`, the same set
  `routes/jobs.js` reads mail for. `/health`'s mailbox counts follow it.
- `orgs.run_background_work` (additive, `server/db/ddl/builds/2026-11-24-bgwork1.js`) and `orgKind.isLiveOrg`: on keeps the org live whatever its
  kind, so every SCALE-5 sweep, the mail read and the alarm treat it as live.
- The switch is on the admin console's org panel (Admin → an org, beside Kind), labelled "Run
  background work for this test org", shown for an Internal test or Fixture org.
  POST `/admin/orgs/:id/background-work` sits behind `/ops`'s door (mounted from `server/admin/opsRoutes.js`; 404 to anyone else). `/ops` has no per-org screen; the
  org panel is behind the same super-admin door.
- `tests/scale5.test.js` §5: silent for a test org, loud for a live one, loud again with the switch
  on, silent with it off. Planted red: the old unfiltered query, and isLiveOrg ignoring the switch.
