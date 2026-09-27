# FIX-2 A — every number opens, and dashboards a board can read

Workstream A's notes for the lead. Branch `fix-2-a`, worktree `~/steward-fix2-a`.

## What changed, by file

- `figureSources.js` (new, repo root, CommonJS) — the registry of named sources. One definition per figure:
  a `sql` source's value is SUM/COUNT/AVG over its own SELECT, a `js` source aggregates the array it pages,
  a `ratio` and a `difference` are computed from their two parts' values. `figure()` answers the endpoint,
  `figureValue()` the dashboards. 33 sources.
- `routes/crm.js` — `computeDashboard` computes every metric through `figureValue` and returns it with its
  `source` (and `blank`/`blankShort` for a blank), plus `answer` (the sentence at the top, whose numbers are
  figures), `asOfLabel`, `fiscalYear.label`, the Board's `givingByMonth` series, designation grouped
  restricted/unrestricted, retention's cohort (`also`), goal rows' target and percentage (`also`).
  `renderDashboardPdf` prints the answer, human dates, blanks' sentences, series rows; money sign-first.
  New route `GET /figures/:source/rows` just before `orgRow`.
- `server.js` — `const figureSources = require("./figureSources")` under the requires; `composeActivityReport`
  now reads the six activity figures through the same sources as the People dashboard's This week (the Week in
  Review email and `/reports/activity` and the dashboard are one computation). Same return shape.
- `shared/dashboards.js` — "Monthly gifts giving" → "Monthly givers" (it was typed, not composed by
  vocabulary); byStatus label "Monthly gifts, by where they stand"; the `givingByMonth` series metric;
  `ANSWER_FIGURES` + `answerFigure()`; retention's definition says **calendar** year (what
  `computeRetentionRate` computes — the rows made the old "fiscal" visibly wrong).
- `client/src/components/Figure.jsx` (new) — the one figure component (tile / inline / cell / point).
- `client/src/components/MetricBreakdownPanel.jsx` — extended into the one drill-through panel (source mode);
  Home's caller-supplied mode unchanged.
- `client/src/components/Dashboards.jsx` — rebuilt on `<Figure>`; the rail's active item is `T.bg2` with a 3px
  `T.greenDk` left rule, weight 700. App.jsx NOT touched (person rows use the existing
  `onNavigate("donors", {selectDonorId})`).
- `scripts/build97-number-census.js` — `FIGURE_SOURCE_SCOPE`, `FIGURE_COMPONENTS`, `figureSourceProblems()`,
  `figureTags()`, `--figures`; Figure.jsx added to SURFACES.
- `CLAUDE.md` — one bullet, "Every number opens" (122 lines). `docs/decisions/home-and-reports.md` — two rules,
  a gotcha and the section "Every number opens (FIX-2 A)".

## Tests

- `tests/fix2-a-dashboards.test.js` (Part 0 findings 1 and 2 + Part A acceptance; red first in `cc964e3`) —
  API, source, PDF and a browser leg at 1440 and 390 (SKIPs without Playwright/dist). 83 passed.
- `tests/fix2-a-footing.test.js` (guard two; red first in `cc964e3`) — every figure on all four dashboards
  foots, 79 figures over 30 sources; paging, tenancy, read-only, 404/400/401. 20 passed.
- `tests/build97-numbers.test.js` §6 (guard one) — +8 assertions.

How each guard was proven able to fail:
- Census guard: §6 plants a `<Figure>` with no source (fails at the planted file and line 3) and a bare
  `{fmtFull(total)}` (fails at line 2, "a number drawn outside <Figure>"); a correct `<Figure>` plus a comment
  mentioning `<Figure>` passes. The first run of the guard itself also went red on a comment in Dashboards.jsx
  ("each figure is drawn by <Figure> …", line 11), which is why comments are blanked before scanning.
- Footing guard: §3 moves a money figure by one cent, a count by one and a percentage by one point; each fails
  the footing function.
- Both new suites ran red against the unfixed code (`cc964e3`): 40+ FAILs in fix2-a-dashboards, a crash in
  fix2-a-footing on the missing `source`.

## Assertion / census changes (with the brief line)

- `build97-numbers` EXPECTED (the census is exact by design; Part A changes what the dashboards draw):
  Dashboards.jsx 2 → 0, MetricBreakdownPanel.jsx 1 → 6, Figure.jsx new at 1, total 408 → 412, claims 123
  unchanged. `audit/BUILD-97-NUMBER-CENSUS.md` table and a Dashboards paragraph updated to match.
- `tenant-matrix` — one `PARAM_EXEMPT` entry for `/figures/:source/rows` (a source NAME from a fixed registry;
  cross-org rows proven in fix2-a-footing §2). No assertion text.
- No existing assertion text changed. `presentation-wiring` asserts the dashboards say "Numbers a board can
  read" — the as-of line keeps that phrase.

## For the lead at merge

- `tests/run-all.sh` CORE: `fix2-a-dashboards` and `fix2-a-footing` appended after `fix2-codeql`.
- `audit/route-inventory.json` regenerated on a fresh database: 636 → 637 (`GET /figures/:source/rows`).
  Regenerate again after merging other workstreams' routes.
- Shared files others may touch: `CLAUDE.md` (one bullet), `docs/decisions/home-and-reports.md`,
  `scripts/build97-number-census.js` + `tests/build97-numbers.test.js` EXPECTED (other workstreams changing a
  census'd screen will conflict on the counts/total — sum the deltas), `audit/BUILD-97-NUMBER-CENSUS.md`,
  `tests/tenant-matrix.test.js` (PARAM_EXEMPT list), `server.js` (composeActivityReport + one require).
- Lint: 562 warnings, same as the branch point. The new components' JSX-only uses show as "unused" under
  today's config (workstream E's fix), so the helper components in Dashboards.jsx / MetricBreakdownPanel.jsx
  are exported rather than raising the count.
- Behaviour changes worth knowing:
  - The dashboards read the org's own fiscal start month (`vocabulary_json`); before, `orgTz()` passed only the
    timezone and every org got July.
  - "Pledged, not yet paid" clamps per pledge (an overpaid pledge no longer eats another's balance);
    "Pledged and paid" counts payments against any pledge, as its definition always said (it read open pledges
    only).
  - Monthly giving (mrr/change) rounds each commitment's monthly amount to cents before summing, so the rows
    foot exactly; a figure can move by a cent or two against the old float sum.
  - Designations group by fund id (two funds with one name are two rows); a gift with no fund reads "No fund
    named" under Unrestricted.
- The app sidebar's active item (App.jsx chrome, workstream C) is still a solid block; the dashboards' own
  rail follows the rule.

## Screenshots

`docs/fix-2/A/` — `<dashboard>-1440.png`, `<dashboard>-390.png` and `panel-*.png` from the suite's young
organisation (blanks, sentences that say when); `rich-*.png` from an organisation with two years of giving,
monthly gifts, pledges, a goal and a grant (retention as a rate with its cohort, the retention panel with its
numerator and denominator).

## Found by looking, fixed

- A tile's figure broke across lines at 1440 ("$1,575.7 / 5") in a three-across tile: tile figures are now sized
  to the tile (container query, `clamp(22px, 14cqi, 34px)`) and never wrap; the Giving card's tiles are two across.
- The long "appears on …" sentence stretched every tile in its row: a tile shows "Appears on Sep 7, 2027." and the
  panel (and the PDF) the whole sentence.
- The Board's right column was half empty under designation: People moved under it, Monthly giving runs full width.
- The retention panel's rows said "calendar year" under a definition that said "fiscal year": the definition now
  says what `computeRetentionRate` computes.
- `reserved-recovered` refused "Being recovered" as a status word (outcome language): it reads "Card being retried".

## Process note

One run meant as a SUITES selection went out with an empty list and started the full battery on this stack; it
was stopped after ~10 minutes (200 suites passed, `reserved-recovered` red — fixed above). No other battery ran.
