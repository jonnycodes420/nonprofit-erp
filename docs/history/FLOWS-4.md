## FLOWS-4 · Volunteers, events, search, merge and journeys do the right thing (2026-11-09)

The QA fleet (lead-2026-11-09) hit eleven wrong answers. Each was reproduced on main with real clicks on a production build before it was fixed.

- **Search** ranked every name containing the words together, with the larger giver winning, so "Jonathan A" opened Jonathan Atkinson. Now one order (`personMatch.RANK_ORDER_SQL`): exact, whole-word prefix, starts-with, contains, then other matches, with ties broken by recent activity. Same-name people carry a type chip.
- **Journey days:** "Day N" was the offset, so Day 2 fell on start + 2. Day N is now start + (N-1), from one helper (`journeyShape.dayWord` / `dayOfJourney`).
- **Re-engage** ignored the Directory's server filters. It now asks `/donors/ids` with the same filter and shows "Filtered: n filters · Clear".
- **Merge** kept the record with more gifts. A merge started from a record now keeps that record (`/data-health/pair?keep=`).
- **Giving levels:** the stored Insights fingerprint didn't cover the org's cut points, so a save left Atlas and the Major rung on the old level. The fingerprint now includes them, and a save queues a rebuild.
- **Notes banner:** a stored "hasn't given yet" was shown as today's fact. The banner's first line now comes from current giving, and the note is dated (`donors.notes_at`, stamped by a trigger).
- **Trash** is now its own Settings section with a count, with links from the Donors list, Your Data and Imports, and search finds it.
- **Volunteer hours** were summed per sign-up row and a double click logged a shift twice. Now there is one report source (`server/volunteers/hoursReport.js`) and a per-entry key.
- **"Missed you" drafts** were fixed at the moment someone was marked No Show. They now follow the guest list as it changes, and archiving an event retires its drafts and tasks ("event archived").
- **Archived events** no longer appear on the Calendar or in Coming up.
- **Meeting moves:** two requests for one drag wrote two notes. A move now claims its old day and carries an action key.
