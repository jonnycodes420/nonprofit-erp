## INT-BUILD-1 · inbox and calendar, built in (2026-10-01)

Nobody could find inbox connect because there was nowhere to find it: one
Gmail-only card halfway down Integrations, no Outlook button at all, a "profile
menu" that did not exist, and nothing on Connections. Part 0 put one card in
four doors. It also found the 15-minute sync reading `gmail_connections`, a
table nothing has written since INT-4, so new mailboxes only synced on the
button and Outlook never synced.

The calendar rides the same consent (`calendar.events` on Google,
`Calendars.ReadWrite` on Microsoft) under the inbox's rule, tightened: an event
with nobody on file leaves no row, no count and no log line, and a matched one
keeps six fields (`shared/calendarLog.js`, guarded by intb1-calendar-store).
The profile follows docs/int-build-1/Profile.html: Last met and Last email in
the header, the meeting card with its four-line brief, one timeline, and the
rail's rhythm strip. "How did it go" records nothing until save, and then only
through the ordinary gift, pledge and thread routes.

Margaret Chen in the demo is now the mockup's major donor. She could not also
be the drift example (silent for 14 months), so that story is Eleanor
Whitcombe's, with the same numbers. The tenant matrix never deleted the
webhook rows it inserts, so it passed once per fresh database; it does now.
