## THREAD-2a — journeys, as an extension of Plans (2026-09-27)

**Two design directions first** (`docs/thread-2/directions/`), pushed inside the timebox so
Jonathan could pick while the engine was built. A · the spine: one horizontal line and the line
is time. B · the playbook: one plain sentence per step, edited in place. The real split is
whether a journey is a *schedule* or a *promise in words* — which is also what decides where it
lands on the donor profile.

**A journey is a Plan with a trigger, and that is the whole design.** BUILD-99 already built
ordered steps that each become a thread, one open at a time, with a partial unique index
enforcing it and a `cultivation_plans_one_active` index enforcing one plan per person. A journey
adds exactly two columns' worth of idea — the event that starts it, and which one wins when a
donor qualifies for two. No new tables, no parallel engine, and every screen that already reads
plans reads journeys for free. Old plans and sequences keep working because there is nothing new
for them to break against.

**One way in.** `maybeStartJourney` is called by all six triggers and by the by-hand apply, which
is what makes "a donor is in at most one journey" true rather than aspirational. It is registered
back to server.js at mount time, because `recordGift` lives there and is the only honest place to
know a gift was somebody's first — requiring crm.js from server.js would be a cycle. A null
engine is a no-op and never a throw: a broken journey must not be able to refuse a donation.

**The priority behaviour falls out rather than being special-cased.** A $25,000 first gift fires
`first_gift` and then `gift_over`; the first starts the welcome journey and the second replaces
it, because major donor (90) outranks the first-year welcome (50). The replaced plan is
*abandoned*, not deleted, and one sentence — written by the shape module, so the stored reason
and the displayed one are the same string — goes on the row and on the donor's timeline.

**THE ONE TEST, and it guards the line that is never crossed.** A journey is the most dangerous
thing in this product to get wrong: it fires on its own, writes seven steps against a real
person, with nobody watching. So the suite runs the whole path — arm two journeys, record a real
gift through `recordGift`, watch seven steps appear, mark one done, skip one, then land a $25,000
gift and watch the replacement — against a **live mail sink**, with the fixture org's mail
switched **ON**, and asserts the sink saw nothing at all. Mail on is the point: proving "nothing
was sent" against an org whose mail is off proves only that the gate works. Planted a send in the
engine and watched §3 and §5 go red.

**Two things the database caught that a test would not have.** `threads_close_honest` refused
`close_kind='done'`: a thread closes as an *outcome naming its interaction*, or a *dismissal with
a reason*, and nothing else. Mark-done is the most tempting place in the product to punch through
that, and the constraint was right — the line is now written as a real interaction first and the
thread closes onto it, which is also what makes a completed step count towards Last contact. And
`tenant-matrix` refused the three new `/journeys/:id` routes for having no cross-tenant probe;
`POST /journeys/:id/apply` reaching another org's journey could start seven steps against their
donors, so that refusal earned its keep.

**A fixture that did not clean up after itself** failed the suite's own second run on
`orgs_pkey`: every org is born with a ledger, and `accounts`/`fin_funds` hold a foreign key, so
the org row could not be deleted. It reads exactly like a product bug.

Battery: 39 suites, 0 failed.
