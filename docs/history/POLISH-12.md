# POLISH-12 · The giving chart's years are readable, and two sentences stop lying by a hair (26 Nov 2026)

From Jonathan on prod, 25 Nov, on a pilot's donor profile with 11 fiscal years ("the fiscal year thing mainly"), and
on Major Gifts ("I don't like the top 100 thing for every org"). Each item was reproduced before it was fixed: on
staging in org_stagewalk (a made-up "Fenwick Holdings, Inc." with 11 fiscal years, $24,000 and $50 alternating) for
items 1, 2 and 4, and on a local production boot for item 3 (an organization's kind is set by import, which the
walker's API cannot do).

1. **The year labels never run into each other.** `YearBars` printed the whole `chartLabel` at 10 units under every
   bar, and the chart scales with its box, so 11 labels collided and drew 7px tall at 1024. `shared/yearAxis.js`
   now takes the first that fits the slot: full names, short ones ("FY17", "2016" for a calendar fiscal year), then
   every other (then every third…) keeping the first, the last and the year running. The labels draw at 11px at
   least. Every bar's hover title carries the full name. Reports' Year over year uses the same `YearBars`.
2. **"Down 100%" only when it fell to nothing.** `changeWords` rounded to a whole percent. `changePct`: under 1% is
   "less than 1%", 99% to 100% takes one decimal (99.8%, at most 99.9%); a fall to $0 is already worded "no gifts".
3. **No double period after a name.** `shared/endOnName.js` is the one helper: the rail's "Nothing is open for …",
   Atlas's "Here's what Steward knows about …" and "Start with …", the Why sentence, the peer-to-peer Undo line and
   the sales customers line.
4. **Top 100 is a setting, off unless an org turns it on.** `orgs.top100_enabled` (default false,
   `server/db/ddl/builds/2026-11-26-polish12.js`). `server/org/menu.js` leaves Top 100 out of the tabs shown when
   off (the saved list keeps it) and Major Gifts opens on Pipeline (`mgViewIn`). Off also hides the profile's rank
   and "Add to Top 100", the Donors bulk "Add to Top 100", Home's "Next on your Top 100", Atlas's Top 100 answers
   (`server/majorGifts/top100Switch.js`) and the group plan's List line. The switch is in Settings → Major gifts
   and super admin → the org's Menu and Major Gifts. The list, its places and plans of care are never deleted and
   the /top100 routes still answer. `scripts/ops/polish12-top100-keep.js` (dry run first) turns it on for every org
   with anyone on its Top 100 or with Top 100 chosen as a tab, so no list disappears.

Guard: `tests/history1-by-year.test.js` §6 (red on main: "(100%)", "(0%)", no `top100` on /org/menu; the label
check proves main's full labels overlap). Fixture orgs in the suites that use the Top 100 turn it on.

Not done here, for a next brief: the chart's y-axis amounts still draw at 10 units (small on a phone); a rise
reads its whole percent ("up $23,950 (47900%)"), true but loud.
