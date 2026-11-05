## COUNTS-1 · Every count matches the list it counts, "last contact" means the last contact, and counts are fast (2026-11-05)

Two strict walks on a demo org (4–5 Nov) found counts that disagreed with the lists they label. Each cause:

- **Tasks badge 13 vs Today 1 / Overdue 12.** The badge was worked out in the browser from a copy of the task
  list taken at boot, refreshed only when the Tasks page loaded, with UTC date sums. It is now the server's
  `/tasks/counts` (today + overdue), says "due today or overdue", re-reads after every write, and the Tasks
  page shows the same line.
- **A call's follow-up in the rail only.** The follow-up opened a thread owned by the person's officer, so its
  task was the officer's; the director who set it never saw it in her Tasks or Thread. It is now hers.
- **"Last contact: none yet" after a call.** The header was the newer of Last met and Last email; Engagement
  used the score pass's widest "touch"; About a third rule. Now one rule (`meetings.js conversationsWith`):
  call, meeting, email, ask, stewardship touch, a note marked as a conversation, an event they came to.
- **Profile tab counts stale (Tasks 8, Notes empty).** Their reads ran once when the record opened. The profile
  now re-reads after any write touching the person (`client/src/lib/profileRefresh.js`; api.js tells write
  hooks the path).
- **Event Invited 0 / Came 0.** The server was right; After the event, Tables and the door read the guests once.
  They re-read on any guest write (`client/src/lib/eventRows.js`).
- **Volunteers card 1 vs roster 2.** The card re-read only on an approval; the roster reload now re-reads it.
- **Sequences running 2 while paused.** It counted `status='active'` among the five newest; running is now on,
  timezone chosen and email on, across all sequences (`server/outreach/sequenceCounts.js`).
- **Campaign audience 13 vs 1.** The rail counted everyone with an email; it is now the builder's reach
  (`server/outreach/audienceReach.js`).
- **SYBUNT 243 vs 552.** The starter left out last year's givers (LYBUNT) and people who may not be asked; it
  now shows the report's count with a sentence for the gap (`server/groups/starterReport.js`).
- **Re-engage 330 vs "Lapsed over 24 months" 95.** Two rules. Now Lapsed is 12–24 months and Lost is over 24
  months, one rule (`lapseRule.LOST_MONTHS`, `shared/numbers/lapse.js lostSql`); Re-engage has a
  "Lost & Found: over 24 months" tab and the report ("Lost: over 24 months") counts the same people.

Tests: `tests/counts1.test.js` (with a browser leg) and a `counts` pass in TRUTH-1's truth check
(`tests/lib/countsKey.js`, `tests/lib/counts1Item3.js`).
