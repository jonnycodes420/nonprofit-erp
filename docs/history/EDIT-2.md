# EDIT-2 · Tasks in date order, the right next step on Major gifts, and one touch logged to many people

Three items from a customer, 18 Nov 2026, the afternoon of EDIT-1. One PR, one new suite (`tests/edit2.test.js`).

## What happened
- **Tasks out of order.** Reproduced on staging (read only): Meridian Foundation's Tasks tab listed Dec 15, Dec 1, then
  Nov 19. The Tasks tab is the profile timeline filtered to tasks, and the timeline sorts every row newest first, so an
  open task due later sits higher: a May 2027 task above a December 2026 one, as in her screenshot. Coming up sorted by
  due date on its own. Now one order, `shared/nextStep.js sortTasks`, read by Coming up and the timeline (open tasks lead,
  soonest first; the rest stay newest first).
- **The wrong next step.** Four surfaces chose "next" four ways: Home's Thread and the Top 100 took the earliest due date
  (so an overdue May beat December), the portfolio and the profile's "Next:" line took the person's one Thread step and
  ignored their other open tasks. `pickNextStep` is now the one rule (soonest due today or later, else most overdue,
  labelled), and `server/tasks/nextStep.js` reads every open step on a person once for all of them.
- **Log a touch to many people.** New: `server/donors/touchBatch.js`, a dialog on Donors' selection bar, and a picker that
  takes several people. A batch writes the same interaction a single Log a touch writes, in one transaction, with a
  `touch_batch_id` for its one Undo. It uses the single log's skip rule, so a bulk "invited to the awareness night" never
  closes 40 people's follow-ups. The title test behind the "already have it" warning is the Donors filter's.

## Choices
- A bulk touch's note is its title (plus her note). "Has had" also matches a touch logged by hand whose first line is the
  same words, so touches logged before the batch existed count.
- The kinds offered in the bulk dialog are the built-in ones she named (Email, Handwritten note for mail, Call, Meeting,
  Event invite, Other); there is no separate "Mail" kind.
- Undo deletes the batch's interactions outright (an undo of a creation) and voids its follow-up tasks.
