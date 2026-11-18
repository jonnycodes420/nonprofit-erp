# For the fleet · EDIT-1

A task on a person's profile now opens the same edit sheet as the Tasks page. Harborlight is read
only; every step that saves, ticks or reopens runs in **org_stagewalk**.

## Surfaces changed
- Person profile → **Coming up** (main column): a task's title is a button.
- Person profile → **Activity** timeline (cards and list view): a task's title is a button.
- Person profile → **Tasks** tab: the same.
- The task sheet ("Task", with Day, Time, Kind, Priority, Owner, Repeats, Notes, Checklist), now one
  shared component on the Tasks page and the profile. New: **Reopen** on a done task, a "This task is
  done" line, and read-only shows the fields disabled with **Close** and no Save.

## Clicks to try for the next three nights
| # | Where | Clicks | Right when |
|---|---|---|---|
| 1 | Harborlight (read) | Open a person with a task in Coming up → click the task's title | The "Task" sheet opens with that title, its day and notes. Escape closes it; nothing changed. |
| 2 | Harborlight (read) | Same person → Tab to the title, press Enter | The sheet opens. Escape closes it and focus returns to the title. |
| 3 | org_stagewalk (**write**) | Tasks → quick add "Call <a walk person> about the spring visit" with a day two weeks out → Save task → open that person → Coming up → click its title → change the day to one day later, add a note → Save | The sheet closes; Coming up and the Activity card show the new day at once, no reload. Tasks page (Upcoming) shows the same task with the new day; opening it there shows the note. |
| 4 | org_stagewalk (**write**) | Same person → Tasks tab → tick the task's box → click its title | The sheet opens on the done task: "This task is done…", **Reopen**, no Mark done. Add a note → Save: it stays done and the note is kept. |
| 5 | org_stagewalk (**write**, off the happy path) | Open the done task again → **Reopen** | The box beside it reads open again, Coming up lists it again, no reload. Then tick it and press **Undo** in the toast: it is open again. |
| 6 | org_stagewalk (**write**) | Record a gift for a person → their "Send thank-you note" task → click its title | The sheet opens with the Thread's line ("This is a next step on the Thread…"); the title is not editable, the notes are. |
| 7 | org_stagewalk (**write**, off the happy path) | Open a task from the profile, clear its title, Save | The sheet stays open and says why inside it (the title is needed); nothing changes on the profile. |

## What could have broken nearby
- **Tasks page**: its sheet is now the shared one. Open a task, Save, Mark done, Delete (with Undo), a
  link to one task (`/app/tasks?task=<id>` from the morning email) still opens it.
- **Calendar**: imports `FinishSheet` from the Tasks page (unchanged), worth one open.
- The profile timeline's card still expands on a click outside the title (emails, meetings, gifts).
- FLOWS-17's tick box beside a profile task: one click still ticks it, with Undo.
