## NUMBERS-7 · One answer to "is this person lapsed?" (2026-11-18)

Justin's Place read 4 problems on /ops three nights running after the NUMBERS-6 recompute: 2 `lapse`, 2
`quiet`, two people. Nothing about Lapsed is stored, so it was code: two paths answering the same question
two ways. `tests/numbers7-lapse.test.js` builds ~5,000 made-up histories from a fixed seed in two orgs whose
today is minutes from midnight (Los Angeles at 23:50, Auckland at 00:10) and holds the tag (statusSql), the
segment (quietIds) and the nightly check (checkOrg) to lapseRule.lapseState over the history itself.

Three shapes disagreed. The guess (a time zone, or the pledge hold read one way in SQL and another in JS)
was wrong: the tags passed today the org's day and read the pledge hold the same way in both. Instead:
1. **The check counted a gift refunded in full as a last gift.** FLOWS-11 made the tags' last gift KEPT
   (not refunded in full); the check's FIX-49 block still read `amount > 0`. It now reads money.js `isGift`.
2. **The check judged a person alone.** POLISH-4 and PEOPLE-1 made a person and their spouse, partner,
   owner or workplace one giving unit: a gift or a pledge from either holds both. The SQL did; the check
   read only the person's own gifts, and `lapse.pledgesFor`'s whole-org map dropped the unit (its
   one-person form kept it). The check now reads the rule's inputs through `lapse.inputsFor` (unitSetsSql's
   linked last gift, the unit's pledges, ON_TIME_THROUGH) and `lapse.stateOf`, one function.
3. **The tags let a linked person's gift dated after today hold their partner.** The SQL read the linked
   person's stored last gift, which includes a gift dated ahead (not scheduled). A person's own last gift is
   on or before today. `lapse.js LINK_LAST` now reads the stored date when it is today or before, and their
   latest gift on or before today when it is not. This one the check had right and the tags had wrong.

Shapes 1 and 2 made the check say Lapsed where the tags (correctly) did not; Justin's Place's two are most
likely these. `scripts/ops/numbers7-lapse-why.js` (read only) names which, by id. Nothing needs a rewrite.
Seen in a browser on a local production build: Dov Pike (shape 3) read Current on main, Lapsed on the branch.

Found and left for the next brief: the profile's "Next move · Lapsing donors" card and Home's "Keep ·
Lapsing" read a third rule (own gifts only, and Lapsing for someone 14 months out); LAST_ON_RECORD (Re-engage,
Lost) still reads a person's own stored last gift, which can be dated after today.
