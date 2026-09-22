# BLOCKED — BUILD-94

Things that need a decision from Jonathan. Nothing here is guessed at, and
nothing here reaches a donor.

## 1. The word on the Donors tab (Part 2)

**The question.** The brief says "the word 'donor' on any screen that now
includes non-donors becomes 'people' or the org's word." The nav tab itself,
and the page title under it, still read **Donors**.

**What was done instead, and why.** The directory's own count line now reads
"40 people" the moment a non-donor is on the page, and "40 donors" while every
row is one — so the number and the noun can never contradict each other. That
is the surface where a miscount would actually mislead. The TAB is a different
kind of decision: it is the most-seen string in the product, it appears in
every screenshot and every piece of onboarding copy, and BUILD-86 already
bought an org the right to call its givers something else. Renaming it to
"People" for every org would override that answer for orgs that have no
volunteers at all, which breaks the BUILD-86 rule that an org which never
answered a question sees exactly what it saw before.

**The three options.**
- (a) Leave it "Donors" everywhere. Allie's volunteers live under a tab that
  does not name them.
- (b) "People" for every org. One word, no conditionals; overrides the
  vocabulary an org already chose.
- (c) The org's `giver_plural` while the org has only donors, "People" once it
  has any non-donor. Correct, and conditional UI that changes under you.

**Recommendation: (c)**, because it is the same rule the count line already
follows and it keeps the no-op path byte-identical. It needs your word because
it changes what every existing customer sees the day they import a volunteer.

## 2. Are opens tracked at all? (Part 4)

Recorded here because the brief hands it to you explicitly. This build counts
opens PER CAMPAIGN and shows nothing per person. Per-person opens on the
profile would be a data-handling change and a line in the customer agreement.
No per-person open data is stored by this build. See
`steward-data-handling.md`.

## 3. Justin's Place and the founding rate

Founding closes 30 September; Allie is an October close on your own read.
Decide whether Justin's Place gets $199 anyway and say so in the login email
rather than at the second meeting. Nothing in the code depends on this —
`closeLink.js` will mint whichever price you name.
