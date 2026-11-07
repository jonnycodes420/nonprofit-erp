## FLAKE-2 · The import timing tests stop failing builds, and tests can pin their own hour (2026-11-06)

On 6 Nov about half the builds lost a CI rerun to the same few suites, none of which they touched.
TRUTH-2 also could not test a 9 PM Eastern case, because the clock was set per run.

**fix37 §5 raced the import job.** CI's payloads (runs 42146022377, 42159755860, 42228899286) show
it. The second 5,000-gift import's work was already `done` when the suite first looked. Then the
undo counted 6,000 rows (1,000 people and 5,000 gifts), more than the 5,000 it does inline, so it
was queued ("waiting for its turn"), not answered. Locally the job was slower, so it never lost.
Now a TEST_MODE-only hold keeps the job at its first batch: `server/imports/testHold.js`, an
advisory lock the suite takes from its own session (`tests/lib/importHold.js`). The suite reads the
work part way through, presses Undo, and lets the job go only once the undo has stopped it.
Production returns before touching the database. Planted: with the hold switched off and a 20 s
"slow runner" delay, §5 goes red with CI's own body (`queued: true`, "waiting for its turn").
With the hold on and the same delay, it is green.

**import7 §4: the undo's sentence could lose its count.** This is a product bug. The undo set
`reversed_at` before its after-change step and wrote its sentence only after it. A screen polling
in between read "done" with the stand-in "Undone. The whole import was removed." The longer the
undo, the wider that window. Now `reversed_at` and the sentence are written in one statement, and
undo-status never reads "done" while the undo's own state says it is running. Red before:
§4's planted in-between row read `done` with the stand-in sentence.

**journeys3-triggers: duplicate key on `cultivation_plans_one_active_per_journey`.** Seen in run
42259122245: the hourly `runJourneySweep` job (first run 90 s after boot) ran beside the suite's
own sweep. Both found the failed-card person due. One insert hit the unique index, and the replaced
card journey's step kept the Thread, so the monthly-gift step sat pending with none. The sweep
now takes `journey-sweep:<org>` for each org, and the enrolment insert is
`ON CONFLICT DO NOTHING`. Red before: with neither, the two-sweeps-at-once check left the step
`pending` with no Thread.

**fundraising2-screens.** Run 42110734392 was the $20,400 pledge, which MONEY-3 fixed. Run
42251251531 had "Zelda Rainierson: the profile does not say On track, the Directory's On track
filter lists them". The truth check reads the Directory first and each profile afterwards, and
the scores pass for §7's writes was still on the queue. Two moments were being compared, not two
surfaces. Each truth check in the suite now drains the org's queue first, scores included, as
surfaces-agree does. Not reproduced locally: a burst of gifts just before the check stayed green
twice.

**A suite pins its own hour.** `runPinnedOrContinue(__filename, { at: () => nextNyHour(21) })` gives
one suite its own server and database at that instant. It keeps that instant even in a pinned run,
and the run's clock, and every other suite's, is untouched. `tests/flake2-journey-9pm.test.js`
runs TRUTH-2's case at 9 PM in New York, when UTC is on the next day. With TRUTH-2's old ordering
planted, the profile named Nov 10 against the Calendar's Nov 8 (2 of 2 runs red).
