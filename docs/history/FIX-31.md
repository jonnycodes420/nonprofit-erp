## FIX-31 · Grant deadlines and next steps are one record everywhere (2026-10-07)

Jonathan's Meridian grant on prod showed three done deadlines, none on the Calendar, none in Tasks, a box saying
"None yet" above them, and no funder linked. On a fresh local seed the funder IS linked and the deadlines are
there: the missing funder and the "Awarded" stage were a prod demo not re-seeded since GRANTS-1. The rest was code:
done deadlines were filtered off the Calendar, no deadline or next step was ever a task, and the copy ignored done
ones. Database triggers now keep one task per thread and per deadline (with a heads-up 14 days before a proposal,
LOI or report); a tick, a move or an Undo in any view goes through the record. Volunteers' first tile read 0 for
a just-added volunteer because "active" meant an hour in twelve months; it is now "On the roster". The backfill
made 22 tasks on a pre-FIX-31 copy of the demo, and 0 on its second run. Test: `tests/fix31-one-record.test.js`.
