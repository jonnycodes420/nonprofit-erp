## FIX-10 — a new customer's first hour tells the truth (2026-09-30)

From Muse's walk of a fresh org: Bluegrass Literacy Project, 14 donors, 23
gifts, $19,750, imported an hour earlier. Every finding was rechecked on main
after TRANS-1 first. TRANS-1 had fixed none of them.

**Home said "No donors drifting" while five donors were drifting.** They were
medium confidence, and the product had no way to show them: "See all" sent
`?all=1`, which lifts the cap on the HIGH-confidence list and never asks for the
medium ones. Three surfaces each had their own answer because each had its own
words. `shared/driftWords.js` is now the one place drift is counted and named.
The rule that came out of it: the headline dollars stay high-confidence only,
because a number that includes guesses is not a number a director repeats, and
no surface says "no donors drifting" while anyone is drifting at any confidence.
A medium row may not label its dollars "at risk" either, because that money is
not in the number above it.

**"$0 RAISED · FY 2026-27" over a file holding $19,750.** True, and useless. The
fiscal year had turned in July and every imported gift predated it. Finance had
already solved exactly this, and the fix was to copy Finance rather than invent
a second answer. Two implementations of a fiscal-year LABEL was the deeper bug:
Reports built one from the browser clock, the server built another, and Reports
quietly defaults to LAST year when the current one is thin, under a chip reading
"Last FY" with no year on it. A total for a year the reader never chose and was
never told. Every chip carries its year now, from `shared/fiscalPeriod.js`.

**A deleted gift left its own thank-you standing.** The fix is an explicit link,
`tasks.source_gift_id`, not a heuristic: the rule "a task a person wrote by hand
is never touched" is then true by CONSTRUCTION, because a hand-written task has
no source gift for the void to reach. A predicate on `donor_id` would have been
one character shorter and would have voided her own task; that is the first of
the three defects planted to prove the new suite can fail.

**The test that ran nowhere.** The first full battery was 52 suites green with
the new suite absent: `tests/run-all.sh` takes an explicit CORE list, not a
glob, and CI runs that same list. A test that never runs guards nothing, and a
battery green WITHOUT it says nothing about the thing it guards. Check that a
new suite appears in the run, by name, before believing the green.

**Only the browser caught three of them.** The API assertions were 31 of 31 and
grep was clean while Home printed "5 early signs" twice on one card, once as the
new quiet line and once in the empty state, because both render when there are
no high-confidence drifters. Also: `/fundraising` and `/reports` are NOT routes
(only `/dashboard` and `/donors/:id` are), so the first walk fell through the
catch-all and read Home three times while reporting nothing wrong, which is the
exact trap `smoke-walk` documents in its own header. Navigate by clicking the
nav, and assert the nav moved.

**Shipped incomplete, and said so.** Part D's em dash class was censused and NOT
fixed: about 800 remain in customer-facing copy. Seven were fixed, in strings
this build touched. Rewriting 800 strings mid-build is how a suite goes red for
a reason nobody can find. It wants its own brief.
