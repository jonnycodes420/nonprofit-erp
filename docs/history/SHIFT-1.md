# SHIFT-1: Home's header never moves on a phone, at any hour (2026-11-03)

perf-app's "nothing on Home moves as it loads on a phone" read CLS 0.139 when CI
ran in the UTC morning and passed at night on the same tree. The date heading
and everything under it moved 27 px.

**The cause was not the one the brief guessed.** The org name does not arrive
late (it comes with Home's first render, App.jsx's boot reads), and it was not a
font swap (CI's warm run, fonts cached, moved too). The Edit button in
`homeHead` rendered only once `/me/home-layout` answered, about 170 ms after
first paint, and narrowed the greeting column from 326 to 292 px on a 412 px
phone. The greeting row (`flexWrap:"wrap"`) needed 282 px locally for "Perf App
Harbor Trust · Good morning, Load". CI's Linux text renders a few px wider, and
"Good morning" is 3 px wider than "Good evening", so only the morning crossed
292 and wrapped: row 19 → 46 px, everything under it +27 px. The same narrowing
re-wrapped the date heading on 74 dates of 2026 (Monday, March 2 among them).

**The fix, two halves, each proven needed.** The greeting row never wraps (the org
name ellipsizes; greeting and first name never shrink), and the Edit slot is in
the layout from first paint, hidden and disabled until the layout loads. Revert
both and perf-app reads 0.16; revert only the slot and March 2 reads 0.086;
revert only `nowrap` and it stays 0.004 (the column no longer changes width, so
a wrap is there from the first frame and nothing moves).

**perf-app sets its own clock.** Every context runs in UTC with Date shifted to a
pinned day and hour and still ticking (not Playwright's `clock.setFixedTime`: a
frozen Date slowed the warm visit 0.8 s and hid the network going quiet). Home
on a phone runs at 08:00, 14:00 and 20:00 and the worst CLS counts. The fixture
org is "Riverbend Food Collective" (312 px: fits 326, not 292). The day is
Wednesday, September 30: the first push pinned Monday, March 2 (where a late
Edit slot alone also fails), and CI's slow first phone runs went red on the
serif swap below (CLS 0.045 at 08:00 cold, first look 313 KB as the serif landed
before Home was ready). The longest date is two lines in either font, so the
swap cannot move it. A red CLS prints
what moved and by how much (NUMBERS-5's diagnostic, tidied).

**Left for the next brief.** The date heading's serif is not preloaded (PERF-3),
and its sized fallback wraps differently from DM Serif Display on some dates at
phone width (17 date strings at a 292 px column, e.g. "Monday, April 3"). On
those days a cold phone load moves Home when the serif arrives (CLS 0.04 pinned
to 2028-04-03). Preloading the serif costs 17.4 KB (first look 294 → ~311 KB,
over FIRST_KB 309); reserving two lines on phones changes the look. Either is a
decision, not a fix inside this brief. Also: on a 412 px phone "Monday, March 2"
breaks with "2" alone on the second line.
