# SWEEP-2 · the walk: Donors, Data health and imports

Walked 31 Oct 2026 on the scratch stack (main at 37a702b), as Allie would, on two orgs:

- **the walk org**: a fresh org with the three real-shaped files imported in order (gift history 287,
  the dinner workbook 106 linked to its event, contacts 656), built by `scripts/sweep2-walk-org.js`.
  315 donors, 571 contacts, 341 gifts, $616,469.93.
- **the empty org**: a brand-new org with nothing in it.

Each screen at 1440 and 390: Directory (filters, sort, paging, search, Edit columns, saved views,
Add filter, Export CSV, Add, Log a call, Import & tools), Team, Re-engage (and its plan), Data health
(every line, every review panel, Compare and merge, Undo), Settings → Imports, the import reader with
each real-shaped file (and the combined Finding Joy workbook) and each of the twelve fake system
exports (`tests/fixtures/import/systems/`), and ⌘K for a person, a gift and nothing. Screenshots in
the scratchpad (not committed): `walk-before/` and `walk-after/`. Severity: **P1** wrong number, data
loss, sends or breaks; **P2** reads or looks wrong; **P3** polish. Status after the fixes is at the
end of each line.

No P1. Every number checked agrees: Re-engage 120 = the Lapsed count (`/donors/counts` lapsed and
reengage) = the list's rows; 315 donors with 571 contacts on file (contacts are not donors on the
Directory, the badge or Home); Settings → Imports matches each receipt (63 gifts · "$45,340 given ·
$104,050 pledged" for the dinner; "656 = 571 added + 79 already here + 6 rows for someone named on
another row" for contacts); the export has 315 rows. A merge moved the gift and the pledge and Undo
put both records back.

Timings (local, warm server): the app with the Directory 0.9–1.1 s from a cold load; each Donors view
0.6 s after that; Data health 0.6 s; ⌘K answers under 0.3 s. Phone at 390 on the local stack 0.6–1.0 s
per view; slow 4G was not throttled in this walk.

## Directory

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 1 | Stage column | Reads in plain case now ("Ongoing care", not "ONGOING CARE"), but 269 of 315 share it and nothing says what a stage is or what "Ongoing care" means. | P2 || fixed (the Stage header has a definition: what a stage is, and that an import puts givers in Ongoing care) |
| 2 | Engagement, Giving strength headers | At 1440 they are cut to "Engagement…" and "Giving str…", and the "?" that holds each one's definition is clipped out of sight, so neither number has a sentence anyone can reach. | P2 || fixed (wider columns; each "?" sits inside its header; each Giving strength number's hover says what it is made of) |
| 3 | Engagement cell | "Nothing in 24 months" beside a donor who gave last month: Engagement counts calls, meetings and events, not gifts. | P2 || fixed ("Nothing logged in 24 months") |
| 4 | Engagement, Giving strength cells | "Not set" for the 79 donors whose only giving is a pledge (and in the phone card). | P2 || fixed ("No gifts yet", "Not scored yet") |
| 5 | Tag filter | "New" is listed twice (the ladder's New and the closeness New). | P2 || fixed (the closeness one reads "New, no pattern yet") |
| 6 | Sort | "Sort: generosity" sorts the column headed "Giving strength": two names for one number. | P2 || fixed ("Sort: giving strength") |
| 7 | Phone | The toolbar (two chips, search, four tabs, Log a call, + Add, Import, five selects, three buttons) fills the first screen before any donor; "Re-engage" breaks as "Re- / engage". | P3 || left: defects.md |
| 8 | Filters, paging, search, Edit columns, Add filter, Export CSV (315 rows), Add, Log a call, Import & tools | Meet the bar. | | |
| 9 | Empty org | "No donors yet." with Add a donor and Import. Meets the bar. | | |

## Team

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 10 | Team, nobody assigned (both orgs) | "0 donors · $0" and "No assigned donors yet", with nothing that says how to assign anyone; two thirds of the page empty. | P2 || fixed ("Nobody owns a donor yet", how to assign, Open the Directory) |

## Re-engage

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 11 | Rows | "Critical" and "At Risk" (title case, alarm words) under the day count; FIX-58 made them brass but kept the words. | P2 || fixed ("Over 2 years", "Over a year") |
| 12 | Tiles | "Avg days lapsed 684d" is drawn in terracotta, outside the four colours. | P2 || fixed (ink) |
| 13 | Column and tile | "Days lapsed" is the days since the last gift (438 for an Aug 2025 gift), not how long they have been lapsed. | P2 || fixed ("Since last gift", "Avg days since last gift", "438 days") |
| 14 | Re-engage Plan | Offered with drafting unavailable; pressing it shows "Thinking…" and then throws "Steward couldn't reach drafting just now." (Call List beside it is already hidden when drafting is off.) | P2 || fixed (offered only when drafting is on, as Call List is) |
| 15 | Empty org | "No lapsed donors. All your donors are active, great work!" on an org with no donors at all. | P2 || fixed ("No givers yet" and how to bring them in) |
| 16 | Phone | "+ Log" and "View →" overlap the day count. | P3 || fixed |

## Data health

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 17 | Lines at zero | "0 Emails to look at · 0 emails that bounce…" stays on the walk org; on the empty org every line reads 0 ("0 addresses can be written the standard US way", "0 people with no email…"). A check at zero hides; an org with nothing to tidy gets one line saying so. | P2 || fixed (a line at zero hides; People who moved draws no 0; one sentence when there is nothing to tidy or nothing on file) |
| 18 | Possible duplicates | A pair's reason says the same thing twice: "Same address, names differ by a letter or two; same household, names differ by a letter or two." (also in Compare and merge) | P2 || fixed ("Same address and household, names differ by a letter or two.") |
| 19 | After Undo | The line above says 2 possible duplicates; the open list under it still says "1 possible duplicate" and shows one pair until it is closed and opened again. | P2 || fixed (the list re-reads after any change below it) |
| 20 | After Undo | "Checked 5:41 PM, after a merge." after an undo. | P3 || fixed (the line is re-read after the server's re-check) |
| 21 | Pledges due the day of the event | Known miss: a line at zero. Already fixed (FIX-58 draws it only above zero). | | already fixed |
| 22 | Possible duplicates | `/data-health/duplicates` returns every pair in one answer; the rule is paging. | P3 || fixed (50 a page, Show more) |
| 23 | Possible families | 131 pairs drawn at once. | P3 || fixed (50 a page, Show more) |
| 24 | Addresses, Unreachable, People who moved, Compare and merge, Merge, Recent merges, Undo | Meet the bar (merge says what moved and that it can be undone for 30 days; Undo puts both back). | | |

## Imports and the reader

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 25 | Settings → Imports | Known miss "Gifts created 100 beside $124,290 given". Already fixed: the dinner reads 63 · "$45,340 given · $104,050 pledged", as its receipt does. | | already fixed |
| 26 | Settings → Imports | The Who column falls back to "Not set" for an import with no name on it. | P2 || fixed ("Not recorded") |
| 27 | Reader, Raiser's Edge export | "3 people, 1 organization" above "Import 3 people (3 donors)": the organization is one of the three, and the line reads as four. | P2 || fixed ("3 people (1 of them an organization)") |
| 28 | Reader, event files | "When was the Finding Joy?" and "Your file names the Finding Joy but gives no date". | P2 || fixed ("When was Finding Joy?"; "the Dinner" keeps its article) |
| 29 | Reader, every CSV | "A gifts file: Sheet1, 3 rows from row 1.": a CSV has no Sheet1. | P3 || fixed ("3 rows under the headings on row 1", no Sheet1) |
| 30 | Reader, every one-sheet file | "Sheets that list the same people are read as one list, by ID first, then email, then name." on a file with one sheet. | P3 || fixed (said only for a file with two or more sheets) |
| 31 | Reader, the combined Finding Joy workbook | 558 people against the key's 443 (a couple's row is two). Known, decided in FIX-60, already in defects.md for EVENTS-3. | | defects.md |
| 32 | Reader, the other eleven system exports, gift history, dinner, contacts | Meet the bar: each says which system it read, asks only the deposit question (and the event date and pledge dates for the dinner), and its button names what it will write. | | |

## Search (⌘K)

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 33 | A gift | "$25,000 from Ulis & Verin Cranville Family Foundation · Sep 4, 2026 · Needs you": "Needs you" does not say what it needs (a thank-you). | P3 || fixed (no method is no word) |
| 34 | A person, nothing found | Meet the bar ("No matches for "zzqx""). | | |
| 35 | A gift with a check number | Found while fixing #33: the result says "cheque 1042", where Steward says "check" everywhere else. | P2 | fixed |

## Found by this PR's CI (outside the area, fixed because they turned CI red)

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 36 | Reports › Bookkeeper, Three-year, Lapsed lists, a year's summary | A count drawn as a figure with the noun after its "?": "9 ? gifts between", "8 ? donors". FIX-60's `unit` was missing at four call sites; smoke-walk §fix60 caught it on CI, where the figures arrive before the read. | P2 | fixed |
| 37 | Finance › Month close | "Last month" came from the browser's clock, not the org's day: a browser in another zone than the org (CI's UTC, or someone travelling) opened October on the evening of 31 Oct and the banner was empty. Red on main in polish1-trust with the browser in UTC; green after. | P2 | fixed |

## After the fixes

Walked again on the same two orgs at 1440 and 390 (`walk-after/`), side by side with the before:
every Donors view, Data health, Settings → Imports and Home say nothing the bar names and log no
console error or API 4xx/5xx; each line above marked fixed reads as described. Timings did not
move (Directory 0.95–1.05 s from a cold load, each other view 0.57–0.75 s). One change of my own
needed a second pass: the first widening of the score columns trimmed long names at 1440, so the
two score headings wrap to two lines instead and the names have their room back (only the longest,
"Ulis & Verin Cranville Family Foundation", still trims by a few letters, as it nearly did before).
