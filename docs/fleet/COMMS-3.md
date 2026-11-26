# COMMS-3 · For the fleet

**Surfaces changed:** Communications → Drafts to review (the one-line lead; "Select several", shown only with two
or more drafts; each thank-you row shows the draft's first line; an opened draft has Open in my email, Copy, I sent
it, and Not sending this, each removing the row with Undo; the × and Skip are gone from thank-you rows). The same
thank-you list on a donor's Emails tab and Money in. Communications → Audience (rebuilt: "Who you can reach", the
reach bar, Biggest gap with Send them a printed letter, six audience cards with counts, dollars and a brass reason at
0, search, sort, status pills, select rows → "N selected · $X given between them", Email these N, Add to a group).
Major Gifts → Pipeline (a "Set stages for your top donors" panel when arriving from an Audience card).
Communications → Printed letters (a third choice: Your mail-only donors).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Drafts to review → Read the draft on the first row, wait 2 s, then on the
   second, third (slowly), then the fourth, fifth, sixth quickly. Each opens at once and stays open; the list never
   empties or flickers; no other row closes it.
2. **(Needs a write.)** On an open draft press **I sent it**: the row leaves at once; wait 5 s, it does not come
   back. Press **Undo** in the toast: it is back, waiting. Press Undo again: nothing (the toast is gone).
3. **(Needs a write.)** Open a draft → **Not sending this**: no confirm, the row leaves, Undo brings it back.
   "Dismissed (n)" at the foot lists it until then.
4. **(Read only.)** Open a draft whose donor has an email: **Open in my email** is a mailto to that address with the
   subject "Thank you for your gift" and the draft's words. A donor with no email: the draft says so in brass and
   offers Copy only.
5. **(Read only, Harborlight.)** Audience: the three reach counts (have an email, mail only, no way to reach) add to
   "Your N donors"; click each count and the drawer lists that many people. Click the Biggest gap dollars: the
   drawer's rows foot to it.
6. **(Read only.)** Click the Lapsing or lapsed card: the primary button reads "Start a campaign to Lapsing or
   lapsed", the pills read "Lapsed N mo" / "Lapsing N mo" in brass. Type a name that matches nobody in the search:
   no rows, "Showing 0 of 0 that match". Tick three rows: "3 selected · $X given between them".
7. **(Read only.)** A card at 0 says why in brass. In an org with no stages, Major donors says "…and no one has a
   major-gift stage yet. Set stages for your top 40"; the link opens Major Gifts → Pipeline with up to 40 people
   and a stage to pick for each. Do not press Set (writes).
8. **(Read only.)** Biggest gap → **Send them a printed letter**: Printed letters opens with "Your mail-only donors"
   chosen, From a year ago, and a preview sentence "N letters, one for each of your mail-only donors who gave…".
   Do not press Mark these as sent.
9. **(Read only.)** Audience at 390 wide: no sideways scroll on the page; the list scrolls inside its card.

**What could have broken nearby:** Home's thank-you card and "Mark all as sent" (both read GET /thank-yous; opening
a draft no longer moves the draft count). The donor profile's Emails tab and Money in (same thank-you list). Atlas's
drafts row in Drafts to review (its count now feeds Select several). The campaign editor's audience when started from
Audience (byStage, manual and donors segments). Any figure drawer (the module sources moved to
server/reports/sourceModules.js: By year, Year over year, the ledger, Brought in, households, records gap, onboarding
totals, volunteers, Gives through). Printed letters for an event or a campaign.
