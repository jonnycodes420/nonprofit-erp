## REPORTS-4 · Every number opens its rows (2026-10-07)

WIRE-1 rule 6 was still partly wired on Reports. The list came first (`docs/reports-4/figures.md`, 39 bare figures).
Every Reports tab number except Solicitations and Week in review, the household figures, giving-page raised and the
membership counts now open: 21 of the 39. New sources: `bunt`, `top-lifetime`, `household-giving` (only/except),
`linked-household-giving`, `page-raised`, `members`, `retention-dollars`, `retention-first`; `gifts` gained online,
page, bookkeeper and the mean and median measures; `givers` gained fund, campaign, first (new/returning) and top.
**The report shows the source's value**: `reportFigures` (routes/crm.js) computes each figure through its source and
the report hands the screen THAT number, so the number and its rows are one computation. **One footing rule**:
`figureSources.footCheck` (sum to the cent, count to the row, mean = total / count, median = the middle row, a
percentage by its halves) over `allRows`, which also backs `GET /figures/:source/export.csv` and
`/figures/:source/people` (the drawer's Download CSV and Save as a group; the Group is made through the Groups
routes, so it is audited and the shared Undo takes it back). Every tile and inline figure has a "?" with its one
sentence (its own definition, or its source's). Wrong, not only bare: the profile's household total counted a
deleted spouse; Reports' retention counted a refund as giving and showed one decimal against the Board's whole
percent; membership counts included deleted people. `LAPSED_MEMBER_SQL` and `BOOKKEEPER_EXCLUDED_TYPES` moved into
figureSources.js so each has one definition. Test: `reports4-foot` (195 checks on its own fixture; 203 on Harborlight
via FOOT_EMAIL, run by hand because no suite logs in to the demo). The walk found one more: a dollar ratio's footer
printed its halves without dollars or cents.
