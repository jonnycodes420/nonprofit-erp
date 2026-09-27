# FIX-3 E — Reports: findings 12 and 13 (notes for the lead)

Branch `fix-3-e`, worktree `~/steward-fix3-e`. Red at `e7853e4`, fix at `064bc47`.

## 12. The rail, regrouped

`client/src/lib/reportsRail.js` `RAIL_GROUPS`, in this order, the brief's names word for word:

| Group | Reports |
|---|---|
| Your saved reports | the org's own (from `/saved-reports`) |
| Who stopped giving | LYBUNT · SYBUNT · Lapsed over 24 months · Retention · Monthly givers and status |
| Who gives the most | Top donors · 3-year comparison · Board giving · Solicitations |
| The year | Giving summary · Gifts by month vs last year · Gifts by fund · Annual report · Week in review · First-time donors this year |
| Money in | Pledges outstanding · Acknowledgment backlog · Gifts by link source · Gifts for the bookkeeper |
| Grants | Grants pipeline · Grants by funder · Awarded vs requested by year · Grant deadlines, next 90 days · Restricted balances by grant |
| Volunteers and members | Volunteers who give · Members by level · Memberships expiring in 60 days · Lapsed members · New and renewed members by month · Membership and donation revenue |

Every existing report is named by the brief, so none needed a "closest group". The five
folded standard ids (`std:lybunt`, `std:sybunt`, `std:retention`, `std:top-50`, `std:by-fund`)
still resolve to their tab twins, so they sit in their twin's group.

- **Collapse.** Each group header is a button (`data-testid="rail-group-toggle"`, `aria-expanded`).
  The folded set is kept per viewer in `localStorage["steward_reports_rail_collapsed:<user id>"]`;
  every read and write is in try/catch, so storage that throws only means every group starts open.
  Default: every group open (so nothing that clicks a rail item by id breaks). Opening a report
  opens its group (`groupOfReport`, through the resolver, so an alias opens its twin's group) and
  keeps it open in the stored set.
- **Search.** `data-testid="reports-search"` at the top of the rail, under Build a report.
  `filterRail(groups, text)` matches report names in any case across every group, folded or not.
  Groups with no match drop out; no match at all says "No report has "…" in its name." Escape clears.
  It is a plain text input (a `type="search"` box drew the browser's blue clear button, which is
  outside the four colours; the screenshots caught it).
- **Below 760px** the picker is still the one `<select>`, now with the seven optgroups; the same
  search narrows its options, and while a search is typed the matches are also listed under the box
  so a phone can tap one. With no search the list folds back into the picker.
- `resolveReportId` is untouched; every old id still lands (see tests).

## 13. The giving summary and the Board, one figure

- `orgTime.samePointLastYear(from, to, today)` is the one window: a running period is cut at today
  and compared from the same first day a year back for the same number of days (the Board's rule,
  unchanged); a finished period compares with the same dates a year earlier; the earlier stretch
  never reaches into the window; a period not yet begun has no comparison.
- `samePointLastYearSource(from, to, today, {fund, campaign})` (routes/crm.js) turns it into the
  `gifts` figure source. The Board's `revenueLastYear` and the giving summary's `comparison` both
  call it; their `source` objects are identical, so the drill-through is the same rows.
- The summary sentence: "You've raised $X from N gifts this period — up/down from $Y at the same
  point last year." Both $X and $Y are `<Figure>`s (inline) and open onto their gifts, footing to the
  cent. $Y's definition is the Board's own sentence for a fiscal-year period ("Gifts received in the
  equivalent stretch of your previous fiscal year, so the comparison is like for like."), and "Gifts
  received in the same stretch a year earlier, so the comparison is like for like." for a calendar
  or custom period.
- The old equal-length "prior period" stays in the payload as `prior` with `basis: "full-period"`
  and `label: "The whole period before this one"`: the low-volume default (Reports opens on Last FY
  while this year is nearly empty) reads it. It is **not shown** anywhere, so there is no full-year
  option on screen to label.
- **Same fiscal start month as the Board.** The Board reads the org's `fiscal_year_start_month`; the
  reports did not (`reportYearBounds` was hardcoded July). `reportYearBounds(year, mode, startMonth)`
  now takes the org's month (default 7 gives the same strings as before, so a July org's reports do
  not move); `parseReportParams` gets the org with its vocabulary (`orgForYears`), and every
  year-based handler (LYBUNT/SYBUNT, retention, 3-year, annual, by-month, members-by-level,
  membership-revenue) passes it. The client learns the month from the giving summary it already
  fetches on open (`fiscalStartMonth`), so This FY / Last FY, the year dropdown and the "Fiscal
  (Jul–Jun)" label follow the org; tab reports wait for that answer before their first fetch.
- Same inclusion rules: the summary and the source both exclude soft-deleted people and include
  sample rows (proved with one of each in the fixture). The `gifts` source gained a `campaign`
  filter so a campaign-filtered summary compares like for like.
- **Exports.** The giving summary's CSV is the monthly table and its TOTAL row; it never carried the
  comparison and is unchanged. There is no giving-summary PDF. The Board PDF prints the same
  `revenueLastYear`, now drawn through the shared function (same value).

## Tests

`tests/fix3-e-reports.test.js` (CORE, appended): red at `e7853e4` (15 passed, 42 failed), green at
`064bc47` (63 passed).
- §1 pure: the seven groups and their exact membership, one group per report, every tab and
  standard report placed, `filterRail`, `groupOfReport`.
- §2 API, on two fixture orgs (`org_fx3e_mid`, fiscal year starting five months before today, so
  today is mid-year; `org_fx3e_jul`, July): the Board's same point last year is the hand count
  ($512.99: $400 + $99.99 + $10 + a $3 sample row; a deleted person's $50 and the $5,000 the day after
  are out); the summary's This FY starts on the Board's first day; its comparison equals the Board's
  in cents, through the identical source, over the same window, with the Board's sentence; the
  comparison's rows (`/figures/gifts/rows`) foot to it; the full period is kept apart and named;
  Last FY compares with the finished year before it; the CSV is unchanged in shape.
- §3 browser 1440: seven groups in order with their reports; a group folds; the fold survives a
  fresh load, under a key naming the viewer; a deep link into a folded group opens it; search
  "month" finds reports in four groups (Lapsed over 24 months included) and hides the rest; Escape
  restores the rail with its folds; no match says so; a found report opens. 390: the picker's
  optgroups are the seven; the search narrows it and lists its matches; picking lands; no sideways
  scroll.
- §4 browser: the sentence says "at the same point last year" and not "the prior period"; its
  comparison figure is $512.99 and opens onto rows whose total is $512.99.
- **Deep links** (the brief: extend, don't copy): `tests/fix2-b-reports.test.js` §5 now folds every
  group before each of the 37 ids (12 old tab ids, 24 standard, one saved) and counts them.

Planted defects, each red then restored:
1. `std:grants-pipeline` moved back under The year: 4 fails (§1 membership ×2, grants-not-under-the-year, groupOfReport).
2. The Board's window drawn from tomorrow (`addDays(today, 1)` into `samePointLastYearSource`):
   6 fails, e.g. "…in cents, the Board's figure — {summary: 512.99, board: 5512.99}".
3. The summary comparing the whole period again (`today` = the period's end): 10 fails, including
   the browser's "$512.99" and footing lines (it showed $6,289.99).
4. Opening a report no longer opens its group (client, dist rebuilt): fix3-e 1 fail; fix2-b §5
   folded walk: 37 of 37 ids missed, plus the active-item lines (5 fails).

## Assertion and census changes (each called for by finding 12 or by what the summary now draws)

- `tests/fix2-b-reports.test.js`: `GROUPS` is now the FIX-3 seven; the assertion "the groups are the
  brief's five questions, in order" reads "…the FIX-3 brief's seven, in order"; "the saved group
  holds no fixed item" finds the group by id instead of index 4 (it moved to the top). §5: fixture
  change (fold every group before each deep link) and one added line. PASS 64 → 65.
- `tests/build97-numbers.test.js` EXPECTED: Reports.jsx 42 → 40 (the summary's total and comparison
  are `<Figure>`s, not `{fmtFull(…)}`), total 413 → 411, claims 121 → 123 (the figures' `label` props
  mark the median gift beside them; the org's presets now sit within three lines of `pctStr`).
  `audit/BUILD-97-NUMBER-CENSUS.md` row updated to match.
- No other assertion text changed.

## Suites run (my stack, after the fix)

48 affected suites via `SUITES=…`: all PASS except build97-numbers (fixed by the census update
above, then 72/72) and fix3-e-reports (one 390 line the stale dist could not have; 63/63 after the
rebuild). Re-run on the rebuilt stack: fix3-e-reports 63, build97-numbers 72, fix2-b-reports 65,
fix2-e-no-iso 4, all PASS, no SKIP. PASS counts equal the branch-point baseline for every suite
except fix2-b-reports (+1, the line added).
SKIP grep: `build89s-surfaces` "§7 no fixture org on this stack (run build89s-sources first)",
a pre-existing order dependency in a SUITES selection; it does not read anything this branch changed.

Lint: 105 warnings, 0 errors (same as the branch point). TDZ: 0 self-references in every file touched.

## For the lead at merge

- `tests/run-all.sh` CORE: `fix3-e-reports` appended after `fix2-c-cream`.
- Shared files: `routes/crm.js` (computeDashboard's first lines, the report params and handlers,
  `/reports/:key`), `server.js` (`reportYearBounds`), `orgTime.js` (one new export),
  `figureSources.js` (the `gifts` source's `campaign` param), `docs/decisions/home-and-reports.md`
  (two rules), `tests/build97-numbers.test.js` EXPECTED (sum the deltas if another workstream moved
  a census'd screen), `audit/BUILD-97-NUMBER-CENSUS.md`.
- No routes added or removed.
- Left July-bound, deliberately: the report builder's date words (`rbTokens` in server.js: a saved
  report's "this fiscal year", which First-time donors this year uses). A non-July org's builder
  reports still use July. Fixing it is a two-line change (read the vocabulary like `orgForYears`)
  but it changes saved-report results, so it is not in this section.
- Prod walk: on Harborlight (July fiscal year) the summary's comparison should read the Board's
  "Same point last year" figure (the walk saw $574,959 there), with "at the same point last year".

## Screenshots (`docs/fix-3/E/`, a fixture org, looked at)

`rail-1440-collapsed.png` (three groups folded, Giving summary open), `rail-1440-search.png`
("month" across four groups), `rail-390.png`, `rail-390-search.png` ("grant": the Grants matches
listed under the box), `giving-summary-1440.png`, `giving-summary-390.png`,
`giving-summary-panel-1440.png` (the comparison opened: six gifts, total $3,555, "the number on
screen"), `board-1440.png` (Same point last year $3,555 on the same org).
Found by looking and fixed: the browser's blue clear button on a `type="search"` box; a phone
search that changed nothing visible (the closed `<select>`), now listed under the box.
