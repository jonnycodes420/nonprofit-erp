## STALE-2 · events, volunteers and tasks update the moment you change them, and nothing leaves orphans (2026-11-07)

- **Where STALE-1 missed.** The QA fleet (W-1107-*) found figures that still waited for a reload. Each had its own cause:
  - Fundraising's lead event card heard gifts, but not a guest marked as come on the Tickets & sponsors desk, and the desk itself never re-read.
  - A next step on the Thread is a task (the database's `trg_thread_task_sync` writes it). Writes to `/threads` were announced as note and person, so snoozing one to "revisit later" left the Tasks badge and views as they were. A grant's deadlines are tasks the same way.
  - The volunteer panel on a profile listened only to its own window event.
  - A change from outside the screen (told(), the worker) forgot `kept` and `parked` but not the answer just `handed` over or one in flight, so a re-read within a second and a half got the old answer back.
  - The Files tab counted three different things.
  - The merge and household searches showed the previous query's rows.
- **An event's lines are the guest row now.** "Came to X." was written once and never looked at again, so Attended → No Show left it, and removing the guests and then the event left lines on three profiles. `server/events/attendanceLines.js` now handles it:
  - A status change rewrites the line or removes it.
  - Removing a guest takes its lines into the trash with it, through `TRASH_WITH` and the bulk Remove's `WITH`, and the Undo brings them back.
  - Deleting an event drops any line that names it.
  - `scripts/ops/stale2-event-line-orphans.js` clears what was left behind before (dry run first; Jonathan runs it).
- **Capacity and clashes ask first.** Adding past capacity says "This puts the event at 3 of 2" and needs a confirm. A staff shift sign-up that overlaps names the clash and needs a confirm. A conflict count includes only people who exist.
- **Not reproduced on main:**
  - The deleted group's card (W-1107-Volunteers-33): WALKB-1's fix is live, and `stale1` §3 drives it.
  - Profile totals after a gift (W-1107-Finance-04X): `stale1` §P1 drives it. The api.js change (a write forgets what is held again when it lands) and ByYear's re-read were made on the reading of the code, not on a failing check.
- **How it was built.** Three worktrees ran side by side and were merged by hand: items 1–2 here, items 3–4 and item 5 with the Files tab and profile totals in two forks. Only `tests/stale2.test.js` is new. The other checks extend `parity3-volunteers`, `sweep4-events-pledges` and `stale1` (through `tests/lib/stale2Profile.js`).
