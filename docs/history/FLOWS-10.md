# FLOWS-10 · the first screen after an action, dead clicks, and two FLOWS-8 repeats (13 Nov 2026)

Tier 2, 3 and 5 items from the 13 Nov lead, plus late Area 5 notes. Every item was reproduced
before it was fixed: on staging (Harborlight, read-only, every write aborted in the browser) where
a read showed it, otherwise on a local production build of Harborlight.

## Why the FLOWS-8 repeats missed
- **Add meeting (Volunteers-17).** FLOWS-1 kept a meeting in Steward when no calendar is connected,
  "every demo org" among them. The Harborlight seed later gave Dana a connected calendar, so the demo
  took the connected path, where every demo org is refused with the mailbox sentence ("In the demo,
  connecting is turned off…"). FLOWS-8 re-checked in org_stagewalk, which has no calendar, and it
  passed there. The same refusal stopped a meeting's drag (Volunteers-18). A demo org's meetings are
  now kept in Steward for booking, moving and cancelling (server/tasks/stewardMeetings.js).
- **The guest picker (Volunteers-20).** The search answered 200 on staging; the picker could not
  tell a failed search from an empty one (lib/latestSearch.js landed [] on an error). It now says
  the search did not answer.
- **The first screen after an action (Volunteers-01X).** FLOWS-8's latest-wins read reached After
  the event only. Tables and seating, the door's count, the seats line, the officer portfolio and
  the Groups list each read on their own; the archive count was a stored count of every attendee
  row, cancelled ones too. `useLatestLoad` (lib/eventRows.js) is the rule for a panel that keeps its
  own data, and a waiting panel says "Updating…".

## What was learned
- A fix checked in the walk org is not checked in the demo org: the demo has a seeded calendar, a
  seeded journey, seeded media. Re-check a repeat in the org the fleet used.
- "Done" can be said by a table nobody touched: a closed Thread is a done task. Stopping a journey
  removes the open step's task, as the batch Undo already did.

## After merge: the staging re-check
Billing's line footed locally and not on staging (1,124 + 66 − 1 = 1,189 against the Donors tab's
1,188). Records counts every person with a gift who is not deleted, erased people too; the Donors tab
leaves erased people out, so an erased giver was a record that no part of the line named. The second
set is now "a gift on file, not on the Donors tab (not marked Donor, or erased)", and the suite has an
erased giver (red on the first rule, green on this one).
