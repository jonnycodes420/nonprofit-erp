# POLISH-14 · numbers say their period, viewers don't export by default, reports stay readable (27 Nov 2026)

**Why.** Duet's production stress test (26 to 27 Nov, the internal TEST STEWARD org, all mail off) found six things,
and Jonathan added a seventh mid-build.

1. **Leaving Home threw.** `/dashboard/today` fanned out fourteen reads in one `Promise.all`, and its array held an
   `await` (`thanksSince`). The reads already started had no handler while it waited, so a request the browser
   abandoned then turned each of them into an `unhandledRejection` (Sentry NODE-34, NODE-35; dashboard.js 708, 715,
   735). `/groups/starters/:key` had the same shape. Both now read first and never await inside the array; an
   abandoned read is said once, `[499] GET <route> … abandoned`. The same night Jonathan got "Steward is returning
   server errors" at 04:27 UTC with 0 real 5xx: `noteServerError` counted every route error, a 499 too. It now counts
   only an answer that will be a 5xx (not `request_abandoned`, not a refusal with its own 4xx). Proved by
   `tests/load1-no-jam.test.js` §3: 48 abandoned Home reads, 16 unhandled rejections and 1 burst alert on main, 0 and 0
   after. Staging clicks (eight times leaving Home part way) did not reproduce it: org_stagewalk is small and Home
   answers before the click lands; staging's web log has no unhandledRejection in three hours.
2. **Dates were the browser's.** Home's heading used the browser's clock; the import list and receipt read the UTC
   day of a moment (the undo sentence fell back to UTC); Add to calls named its list on the browser's day; The Thread's
   rows judged "this year" on the browser's Date and its opened day was UTC's; the recurring plan's sentence printed
   ISO ("expected 2026-11-26"); the pledge schedule preview only added a year past a full year, so "Dec 1, Jan 1" had
   none. Each now reads the org's day, in words, the year only when it isn't the org's year. Reproduced on staging
   with the browser on UTC−11: Home read "Thursday, November 26" on the org's Friday, November 27.
3. **Undated gifts counted in Finance, not Reports.** Finance's gifts on file were every money row; Reports' All
   time was the gifts figure from 1900 to today, which an undated gift is never in. One rule now,
   `shared/numbers/allGifts.js`, with the undated part said under each figure. Staging has no undated gift in
   Harborlight or org_stagewalk (read-only SQL), so it was reproduced on the TRUTH-6 fixture with two undated $250
   gifts: Reports was $500 and 2 gifts short on main.
4. **"Retention 23%" with no period.** The board pack's tiles and text, and Home's retention tile, now say "so far
   this fiscal year" with last fiscal year's whole year beside it. Reproduced on staging: the pack read
   "Retention (fiscal year)" and "YTD Revenue".
5. **Viewers exported out of the box.** The column defaulted false. A new org now starts off (a catalog default, no
   row written); Settings → Team has a table of what each role can do. Staging: 6 of 6 orgs keep the old default,
   for Jonathan to decide (docs/needs-jonathan/POLISH-14.md, `scripts/ops/polish14-viewer-exports.js`).
6. **The Acknowledgment backlog was one page of everything.** A builder filter, Thanked = No, any date. Now the one
   backlog rule over Home's window, with a count, a total, a date range and pages of 50. Staging showed 128 rows on
   one page, no count or pager.

**Left for the next brief.** Atlas's "all time" is a date span and still leaves undated gifts out. Fundraising's
`allTime` (not shown on a screen) counts rows, not gifts.

**Existing rows.** None carry a bad state for items 1 to 4 and 6 (they were reads). Item 5's existing orgs keep
their setting by design until Jonathan decides.
