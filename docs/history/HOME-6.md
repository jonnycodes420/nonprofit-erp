# HOME-6 · Home looks calm, even and finished, and every card opens what it says (2026-11-05)

Jonathan, 5 Nov, on a real 6,393-person org: "home needs to look nice, everything needs to be
symmetrical and right now it's jumbled." Two additions arrived mid-build: take the "Automatic
email" pill out of the top bar, and every number on Home opens the list it counts, every name the
person ("13 follow-ups" and a donor's name did nothing).

**Found first, shipped first (#333).** INSIGHTS-2 answers an org with no stored Insights with
`deck: { tabs: [], preparing: true }`, and the moves deck read `tabs[0].left`: Home was the error
screen for every org before its first build. The deck now says "Insights are being prepared" and
reads again every 4 s.

- **The grid** (`client/src/components/home/homeGrid.js`). At 1100 px and up the work and the rail
  are 7 : 3 (the rail at least 300 px); below, one column. One spacing scale, 8 · 12 · 16 · 24 ·
  32 · 40 px; one card radius (14) and padding (20, a rail card 12 × 16). The header is one row
  (logo, org, greeting, Edit in SHIFT-1's reserved slot) with the date under it on the same edge.
  On a phone the header block and the work column share a 16 px edge (it was 24 against 16).
- **The tiles.** One grid row of equal tiles, two by two when the deck's column is under 560 px
  (a container query, so it follows the column, not the window). Each is "name · count" over one
  figure in whole dollars (`lib/money.js` `fmtWhole`, rounded). Grow's split moved to its title.
  Planned reads "246 with a signal" (it was cut off at 1440).
- **Drifting** (`home/DriftList.jsx`, `server/insights/driftPeople.js`). The deck's answer carries
  Drift's own people (GET /drift's list, less the drift moves she has acted on), sorted by the
  usual gift (BUILD-83's at-stake figure; Jonathan asked for it to lead each row so the amounts read
  top-down), with the stored last gift and date as the line under it; the first read carries 5, every move's read all of
  them, so Show all opens in place. It replaces the Drift chip (its count is the list's).
- **Setup.** One line and the next step; the steps fold behind "Show the steps", remembered per
  person (`steward.setupRail.open.<user id>`). This reverses POLISH-4's open-by-default, on
  Jonathan's word. The first-run card folds too once donors are in; with none it stays open.
- **What opens what.** The readout row opens that readout (`home/ReadoutPanel.jsx`, WhatChanged
  with `only`), not Recent changes. "N follow-ups" opens all N (`/threads?cap=200`), not the
  Thread's first 12. A name in the Thread, a stopped card, the follow-ups, birthdays and failed
  cards opens the profile; the rest of a Thread row still opens the rail beside it.
- **The pill.** `MailStatusChip` is gone from the top bar and the phone header. Settings, Automatic
  email is unchanged and is the one place; nothing about sending changed.

**Guard.** `tests/home6-layout.test.js`: on main 27 failed, here 37 passed. Planted: tiles that
wrap, red at 1440, 1280 and 390; the readout row back on Recent changes, red.

**Left for the next brief.** Home opened at `/app` redirects to `/dashboard` and remounts, which
reads CLS 0.42 on a phone (none at `/dashboard`, which is what perf-app measures). The readout
panel shows what the readout says; a year-over-year "giving history" view, as the brief imagined
it, does not exist yet. A move card's own sentences keep their cents ("Last gave $2,833.59"): what
a move says was out of scope.
