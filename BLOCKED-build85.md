# BLOCKED — BUILD-85 (the follow-up engine)

Everything in the five-part brief shipped. These need Jonathan, or a later
pass, and none of them blocks the build. Full report:
`audit/BUILD-85-FINDINGS.md`.

---

## 1 · Snooze still distorts the two urgency signals

`POST /threads/:id/dismiss {reason:"revisit"}` sets `snoozed_until` and
**leaves `due_date` where it was**. `opened_on` also stays put. So a thread
deliberately deferred for six months comes back reading *"overdue, day 180"*,
sorts to the top of the morning brief, and — because `composeThreadNudge`
orders by `opened_on ASC` and the subject is built from the oldest — **becomes
the headline of every morning email.**

After a season of real use the subject line is always a big number, and a
number that is always big stops being a signal.

**Why it is not fixed here.** It is a one-line change with a schema question
attached, and the question is Jonathan's:

- **(a)** On revisit, move `due_date` to the revisit date. Clean, and
  "overdue" goes back to meaning overdue. Cost: the original commitment date is
  lost, so "you said you'd do this on the 3rd" is no longer recoverable.
- **(b)** Add `original_due_date`, move `due_date`, keep the first one for the
  record. Honest and slightly more schema.
- **(c)** Leave it and change only the *display* — show "day N since last
  touch" rather than since opened. Smallest, but the sort order stays wrong.

**Recommended: (b).** The date somebody first committed to is exactly the kind
of fact this product does not throw away.

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
