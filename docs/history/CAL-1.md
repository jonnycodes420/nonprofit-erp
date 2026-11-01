## CAL-1 · One calendar for everything (2026-10-05)

- **One read** (`calendar.js`, `GET /calendar/items`): meetings (calendar_events in the org's zone, plus logged
  meetings), next steps (threads, timed or all day) and tasks, shifts with filled of needed, events, journey steps
  (cultivation_plan_steps), campaign sends, pledge instalments and birthdays (off by default). Conflicts are
  quiet markers: two of one person's meetings at once, a short shift, an event on top of a shift.
- **A drag is the item's own route** (`shared/calendarMoves.js`): a delta of days and minutes becomes
  `POST /calendar/events/:id/move` (Google or Outlook first, or "Nothing moved"), `PUT /threads/:id`,
  `PATCH /volunteer-hub/slots/:id` or the new narrow `PATCH /events/:id/schedule` (the full event PUT replaces
  every column). Undo is the same route with the old values. The shared Undo toast (`offerUndo`) only restored
  deletes; it now also takes `{ undoAction, message }`. `tests/cal1-moves.test.js` moves a meeting, a step and
  a shift, counts one audit row each, and puts each back exactly.
- **The shift form** is one form (title, when on one row, all day as 00:00 to 23:59, weekly repeat until a date
  creating one slot per week, venue and room, roles, places, colour, notes, published) from Volunteers and the
  calendar. **Ask** above the grid: the two week questions are answered from the calendar's own rows (with each
  meeting's person's last gift); the ASK-2 box is scoped to the visible dates.
- **Seed changed:** the week holding today gets six meetings, four next steps, two shifts (one short), a journey
  step due midweek and a Friday birthday, around tonight's Scholarship Supper. Harborlight's synced meetings
  cannot move on prod (the demo has no connected calendar, by design), and the calendar says so.
