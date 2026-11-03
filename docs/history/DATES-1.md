## DATES-1 · Many people into a journey at once, journeys on a date every year, yearly tasks, and About them (2026-11-03)

A beta customer's four asks, built in one tab.

- **Add to a journey from the Donors list** (`client/src/components/BulkJourney.jsx`, `server/outreach/journeys.js`).
  The bulk bar, for checked rows and for "select all matching", opens a picker, then a preview that writes nothing:
  how many will start, the first step and its date, and who won't and why ("1 is already in a journey that comes
  first.", "2 are marked do not contact.", "1 has died."). The start runs each person through `maybeStartJourney`
  (by hand, the profile's path), inline up to 2,000 people with the counts in the answer, and as a `journeyBatch` job
  on the queue above that, with progress. One `journey_batches` row per batch; plans carry `batch_id`. Undo, for 30
  days: unstarted steps, their open threads and review drafts are removed, a journey with no step done is taken back
  out, one with a step done is stopped (`abandoned`) and the done step stays done; moved and replaced steps are put back.
- **A date every year** (`yearly_date`, `shared/journeyShape.js`): a month and day and an audience (everyone, a group,
  a stage, an open pledge), started by the morning look in the org's own date through the one start path, event key
  `yearly:<year>` so it runs once a year per person. Feb 29 runs on Feb 28 in other years. Priority is exactly the
  other triggers' rule; who did not start is written to `journey_start_skips` and shown as "Skipped on the date" with
  the reason on each row. The builder lists "A date on the calendar" (this, birthday, first-gift anniversary) first and
  says "First runs Dec 1, 2026." A birthday journey may start up to 60 days before. Two starters, off until turned on:
  Year-end impact report (Dec 1) and Birthday card (7 days before). `/journeys/run-sweep` takes `now` under TEST_MODE.
- **Tasks every year**: `recur.every = "year"` with the month and day it keeps (`taskShape.nextDue`, `yearlyOn`); the
  profile's task form offers "Every year, on their birthday", which sets the day to the next birthday.
- **About them**: `donors.about_them` (500 at most, by the route and a CHECK), `PATCH /donors/:id/about-them`, edited in
  place at the top of About; in the person's export (and erased with them), in Brief me's rows and as background in
  Atlas's drafts; importable as "About them". Schema in `server/shared/dates1Schema.js`, called from initSchema (db.js
  was at its size ratchet).
- **Found on the walk:** the result said "Who won't start" after the start (now "Who didn't start"); tied reasons came
  back in a different order from the preview (now one order); a yearly journey's live preview counted from the latest
  gift (now from its next date). The first planted undo defect was not caught, because removing the steps let the
  engine close the plans as completed; the test now requires "stopped, not completed".
