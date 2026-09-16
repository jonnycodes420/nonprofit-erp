# BLOCKED — BUILD-85 (the follow-up engine)

Everything in the five-part brief shipped. These need Jonathan, or a later
pass, and none of them blocks the build. Full report:
`audit/BUILD-85-FINDINGS.md`.

---

## 1 · ~~Snooze distorts the two urgency signals~~ — **RESOLVED 2026-09-15**

Fixed with **option (b)**, as recommended. `threads.original_due_date` (nullable,
nothing to backfill: NULL means never deferred). A `revisit` dismissal now
**moves `due_date` to the chosen date** and stores the day first promised,
`COALESCE`d so a thread deferred twice still remembers the *first* one. The row
says "moved from Sep 3" rather than the product quietly editing somebody's
commitment.

The second half of the same finding went with it: **the morning subject named
the OLDEST thread**, so a deferred thread carried a huge `daysOpen` and owned
the headline for as long as it stayed open. It names the thread the queue says
to do first now (`threads[0]` arrives rank-ordered), with its day count, which
is the part of BUILD-81's line that did the work. Picking the oldest was right
when nothing was ranked and stopped being right the moment a thread could be
deliberately deferred.

Pinned by `tests/build85.test.js` §8.

## 2 · `tests/affected.sh` still omits two landing suites

Carried from the BUILD-85-adjacent pass and still true: `CLIENT_SUITES` omits
**`landing-field`** and **`donor-field`**, so a change touching only
`client/src/pages/Landing.jsx` does not run the landing golden in the pre-push
hook. CI runs the full battery, so this is a local speed gap rather than a hole
in verification. `legal-entity` and `build85` were both added to that list in
their own passes; the other two were left alone rather than widening scope.

## 3 · No escalation policy, deliberately

The admin roll-up tells an ED the *shape* of the team's follow-up (counts and
overdue per officer). It does **not** email anyone when an officer's threads go
late, because that requires a policy nobody has set: how late is late, who
hears about it, and whether the officer is told they were reported.

That is a product decision with a culture attached, not a fill. It is the
obvious next thing if you want this to feel like Salesforce, and it is exactly
the kind of thing that is worse than useless if the threshold is guessed.

## 4 · The ranking weights are a first draft, on purpose

Every signal in `shared/threadRank.js` is bounded, named, and unit-tested, so
the *shape* is right and safe to tune. The **numbers** (34 for a failing
monthly gift, 26 for an open ask, 22 for a first gift) are a considered guess
made without a single day of real usage data behind them.

They should be revisited once a real shop has run on this for a month, against
one question: **did the top of the list turn out to be the right top of the
list?** `thread_continuation_rate` is now snapshotted daily and is the closest
thing to an answer.

Nothing about the weights is load-bearing for correctness — a bad weight
reorders a list, it never loses a commitment.

---

**Not blocked:** the suite, the battery, the push, or the deploy.
