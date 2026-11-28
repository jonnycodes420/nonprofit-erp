# HOME-7 · Home shows this week's five, and everything else in its place (2026-11-27)

Jonathan, looking at Home's four tiles (Keep 239, Grow 127, Major 5, Planned 183) and "1 of 239": "is it wise to have
this many hundreds just on the homepage ... or does it also show the system is not smart enough to find the best." The
ranking underneath was good; the page hid it. He approved mockup A2 ("This week's five, full Home") on 27 Nov.

Home now leads with five people a week, ranked by what is at stake (a major gift's ask, else the last 12 months of
giving), each with the reason and the draft, kept all week per user, with Not now and Doesn't fit bringing in the next.
The four-tab deck is See all, unchanged. Under the five: a tabbed panel (the Thread, Thank-yous, Recent gifts, Drift),
Major gifts beside Planned giving, then Recent gifts and Drift cards; the rail is Today, Year-end so far, Thank-yous,
Retention, Your givers and Connections, all from one read (`GET /home/cards`) in the rail's bundle.

Three choices made here:
- **The Planned sign sentence** is the deck's own rule. The mockup's ("10 or more years, a gift of stock, or a note about
  their estate") names rules Steward does not run, so the count would not have matched its sentence.
- **Done is found at read.** A GET writes nothing, so a gift in or a call logged since Monday is read each time and the
  row moves to the done strip without a write; the Done link and Doesn't fit write.
- **"Said yes this year"** is the Major Gifts page's committed tile, so the two agree by construction.

Retired: `tests/home6-layout.test.js` (HOME-6's tile and drift-list geometry, none of which is on Home now;
`docs/tests-retired.md`). The suites that drove the deck on Home open it at `/dashboard?moves=all`.
