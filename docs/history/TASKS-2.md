## TASKS-2 · Tasks a director runs her week from (2026-10-07)

Jonathan logged a conversation with Christine Stewart (next step: send the impact report, today) and Home read "Christine Stewart she
asked for the impact report today.", said "1 Follow-ups, 0 Due today", showed an empty Thread and told him his file had not arrived after
he imported 1,000 donors. Causes: First thing glued the full name to the lowered logged line; Home's Thread list began at row 1 because
First thing took row 0, so one thread meant an empty list; Due today and Follow-ups were counted from different rules; the sample line
read only "has sample data". Fixed with `shared/firstThing.js`, the Thread list including row 0 (plus anything logged today), one task
view rule (`shared/taskShape.js` + `taskViewSql`, `GET /tasks/counts`) that Home reads, and `realDonorCount`. The grant card's "Report due"
was a day early because `new Date("YYYY-MM-DD")` is UTC midnight; `daysUntil` had the same mistake for every date-only field and now counts
civil days. Tasks gained views with counts, chips, quick add (`POST /tasks/parse`, rules only, the person confirms), kinds, notes,
checklists, owner with a reassign note, repeats, snooze with a reason, bulk with Undo, and "How did it go? What's next?" for calls and
meetings. Not built: the opt-in morning email (the existing brief is opt-out; changing that is a mail decision), AI help for quick add,
Google/Outlook push of plain tasks, and the Calendar's own tick of a call step still closes without asking. Suite `tasks2-thread`.
