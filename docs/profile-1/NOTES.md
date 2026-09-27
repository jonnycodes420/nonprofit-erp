# PROFILE-1 — the donor profile, as approved

The screen is `docs/profile-1/mockup.html`, committed here because it is the
thing this build was measured against. `walk/` holds the mockup and the built
screen side by side at 1440 and 390, captured by `scripts/profile1-capture.js`
(loopback only, and it asserts as it goes, so a screenshot cannot quietly show
the wrong thing).

## What shipped, against the six items

**1 · The layout.** Dark green sidebar, cream main column, and the right rail
is now INK (`T.ink`) with light text, framing the column the way the sidebar
frames it on the left. Emerald is still the one action colour (the active
stage); brass is still emphasis (the quick actions). Nothing new entered the
palette: the rail's two greys are cream at reduced opacity (`T.sage400/600`),
which is the design system's own answer for secondary text on ink — warm grey
scores about 2.0:1 there and the contrast guard would rightly refuse it. Both
grounds are declared explicitly on their own elements, because a contrast
between two inherited values is not one anybody can check. `tests/hotfix1-profile`
§1 now asserts the rail is the DARK side of the contrast and that its own text
clears AA on it, not merely that the two differ (the brief allowed this).

**2 · The header.** Back, avatar, name, stage chip, role chips, then exactly
three actions: **Log a conversation** (the one emerald), **Plan a follow-up**
(only when no thread is open — a second button that can only 409 teaches people
to distrust buttons), and **More ▾**. All three are `<button>`s. Request a gift,
Impact summary and Edit record moved into the menu, so the row lost nothing.
Before, the overflow existed at 390 and not at 1440, so one screen taught two
habits.

**3 · The four figures.** Lifetime, Last gift, Last contact, Open ask, above
the tabs because they are true of the person rather than of whichever tab is
open. Each is a `<Figure>` with a `source`, so clicking it opens the rows
behind it and those rows foot to the cent. Four new donor-scoped sources in
`figureSources.js` (`donor-lifetime`, `donor-last-gift`, `donor-contact-gap`,
`donor-open-ask`); the server hands the profile the value and the source
together (`donorProfileFigures` in routes/crm.js), so the number and its rows
are one computation. `profile1-figures` (48) walks every page of all four and
recomputes.

Two things worth knowing about that:

- **Lifetime foots to the TRUE lifetime, not the itemized gifts.** Pointing it
  at the gifts alone under-reported every donor whose history arrived as an
  imported aggregate total (BUILD-57 §2c) — `presentation-wiring` caught it at
  485,000 against 375,000. The remainder is now a ROW at the end of the drawer
  ("Giving before Steward"), so the gap is part of the total that foots and is
  visible to anyone who clicks the number, instead of a footnote that only
  appeared on the Overview. When the itemized gifts EXCEED the column the
  column is the stale one (it is a rollup; the gift rows are the record), so
  the figure falls back to the itemized sum and no negative row is drawn.
- **Last contact is measured in days**, so `MetricBreakdownPanel` gained a
  `days` unit beside the existing `months`. Only the most recent conversation
  carries the gap, and the earlier rows carry nothing, so the rows still add to
  the figure; a row with no amount renders blank, never `0`.

A figure with no value SAYS what will appear there and when, instead of an em
dash — the design system's own rule, and it also kept the profile's voice guard
green.

**4 · The tabs and the Overview.** The six tabs are unchanged and in order.
Overview reads: **What do I do next** (Mark done, Snooze — the thread's own
"revisit", moved seven days out and keeping the promise), **Suggested**,
**Proposals**, **Giving by year**, **Recent conversations**. Everything else on
the record kept its place below.

The chart was a LINE with one point per gift, so the demo record drew two
2023s and two 2025s side by side; it is one bar per calendar year now, empty
years drawn (the gap is what you came to see), and a bar opens that year's
gifts through the same `gifts` source every other number opens through.

**5 · The rail.** Owner, stage, quick actions, contact, then folded Sequences,
Custom fields, Cultivation plan and Events, then Brief me. The cultivation plan
and Brief me came off the reading column; the four draft buttons stayed but
what they write now appears in Suggested, on the Overview, beside the record it
came from. The Stage strip is ABSENT for Core rather than frosted (BUILD-88a
A.4 — a Core org has no pipeline); the quick actions are the one frosted
preview.

**6 · What HOTFIX-1 fixed is still fixed**, and `profile1-screen` §6 is the
guard: no lock flash (its own suite), nothing that says lines were left out,
and an open ask is never answered with "nothing is open".

That last one **broke during this build and the suite caught it**: the first
draft of the new empty state read only the open threads and tasks, so a donor
with an ask in flight and no thread was told nothing was open, with the
proposal four inches below. An open proposal is now named as the next step, with
what it asks for and when an answer is expected, and a second fixture donor who
has only a proposal pins it.

## Assertion changes, and why each was needed

- `hotfix1-profile` §1 — the rail's dark ground (the brief allowed this).
- `hotfix1-profile` §2 — the Suggested panels moved out of the rail; the
  property (a panel is drawn only when there is text) is asserted in its new
  shape.
- `locked-features` — three source greps follow the rail's new markup, and one
  follows the chart's rename. Every gate they protect is unchanged.
- `build99-proposals` §8 — locates the chart by testid rather than the words
  "Giving History". Same fact: the ask is above the evidence for it.
- `build100-score-names` — the days on Last contact are the server's figure
  now, but whether they are LATE is still `moveUrgency`, and it still colours
  the tile. The assertion says so.
- `build97-numbers` — Donors.jsx 117→118 and the total 411→412: the open ask's
  amount on the next-step row. Claims unchanged at 123.

## Traps hit

- **`adaptDonor` again.** The server set `figures` and the profile read
  `undefined`, so the whole row of numbers silently did not render. It is the
  documented BUILD-89 trap and it cost twenty minutes here too.
- **Uppercase `innerText`.** The tile labels are uppercased by CSS, so the
  label assertion has to fold case. Fourth suite to hit this.
- **A browser suite run while another worker rebuilds `client/dist` tells you
  nothing.** One red run was a half-written dist, not the app.
