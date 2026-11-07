## RACE-1 · Two things at once never lose or double a step, a gift or a task (2026-11-07)

FLAKE-2 left one race open: with two journey sweeps serialised, a person's first journey step
still sometimes sat `pending` with no Thread (2 of 30 loaded runs).

**The cause.** Journey starts for one person were not serialised. Only two sweeps of an org were.
The JOURNEYS-4 nudge, which a staff write sets off 1.2 s later, ran `runLifecycleTriggers` without
the sweep's lock. In journeys3 the suite's own `run-sweep` POSTs are those staff writes.

The steps, for a person due both a card-expiring journey (lower, exclusive) and a monthly-gift
journey (higher, exclusive):
1. Start A (card) wrote its plan and read the person's plans for the advance.
2. Start B (monthly) found A's plan active with its step still pending, so it had no Thread to
   hand on. B replaced A and wrote its own plan.
3. A's advance, working from what it had already read, opened the card step's Thread.
4. B's advance found the person's one open Thread taken and left the monthly step pending.

**Replayed, not waited for.** `server/shared/raceHold.js` (TEST_MODE only) stops the advance at
`journey-open:<donor>:<journey>`, after the plans are read and before the Thread opens. The suite
holds both journeys' points. It starts A, then starts B, releases A, then releases B. With the
per-person lock taken off: 0 of 10 rounds right, every one ending in the shape above. With the
lock: 100 of 100.

**The fix.**
- Every journey write for a person (start and advance, from any door) runs under
  `withPersonLock("journey", org, donor)` (`server/shared/personLock.js`). It is re-entrant, so the
  start's own advance runs straight through.
- The nudge now takes `journey-sweep:<org>`, like the sweep.

**Write-once paths, each fired 10 times at once on main, then here:**
- Mixed exclusive journeys: two active on main; one, the higher, here.
- A next step (`POST /donors/:id/threads`): one Thread on main, but seven presses answered 201
  (six with no thread); one 201 and nine 409 here.
- A yearly birthday task done 10 times: two next-year tasks on main; one here.
  `tasks_one_repeat_per_parent` and a per-task lock.
- A receipt for one gift: one receipt on main, nine 500s, and numbers 2 to 10 burned. Here: one
  receipt, nine 409s, one number.
- Year-end statements: nine 500s on main, with numbers skipped. They now take turns:
  one active statement, ten numbers in a row.
- Receipt numbers: `receipts_number_once` (org, number); never repeated, never skipped.
- One gift with one idempotency key: one gift on main, but nine 500s. The cause was not the gift:
  ten first gifts of a new org waited on `ensureOrgLedger`'s advisory lock. Each waiter held one
  of the pool's 10 connections inside `pg_advisory_lock`, and the holder could not get one, so
  the waiters hit the statement timeout. `withAdvisoryLock` now waits with a 150 ms
  lock_timeout and hands its connection back between tries.
- Already right on main, now tested: journey enrolment of one journey (two unique indexes),
  thank-you drafts (`UNIQUE (org_id, gift_id)`), and the rhythm row (primary key, TIDY-1's print
  guard; ten gifts at once leave this year's figure counting all of them).

**Indexes** are built after the schema by `server/db/race1Indexes.js`: CONCURRENTLY, outside a
transaction, with lock_timeout. An index whose rows already break its rule is not built and no
row is changed; the boot log names it.

**Planted:** the Thread opener's `ON CONFLICT` removed → ten next steps at once give eight 500s
(§2b red).

**Handed on:** a conversation logged twice by a double submit (`POST /donors/:id/conversations`)
writes two interactions and can close the first one's Thread. Telling a double press from two
real logs is a product decision. Also two send paths that can send twice when pressed at once:
`POST /tasks/:id/thank` with `mode=send`, and `POST /milestone-drafts/:id/send`. They touch the
mail rules, so they belong to a mail brief. The rhythm write's remaining window is narrow (an
upsert onto a row a newer write committed during the statement); it was not reproducible and was
left as it is.
