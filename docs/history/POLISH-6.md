# POLISH-6 · One name for each period, sentences that finish, dates that type right (2026-11-07)

From the QA fleet's 7 Nov synthesis (W-1107-*), run in CREO Arts (Demo) on prod.

1. **Period labels (Fundraising-05).** The server built FY labels by hand in two places (`majorGifts/routes.js`
   said "FY 2026–27" for a calendar-year org; the budget goal said "FY2027"). Both go through
   `server/shared/periodLabel.js`, which reads `shared/fiscalPeriod.js`. The Fundraising pledges tile says
   "due in FY 2026–27" (the overview's pledges carry `yearLabel`), not "due this fiscal year".
   The brief asked for "2026" for a calendar-year org; ARCHITECTURE.md and fiscalPeriod say "FY 2026". The
   documented form is kept and the difference is left for Jonathan.
2. **Sentences.** Brief me: `briefComplete.unfinishedWhy` rejects a line ending on a preposition or
   conjunction, on "as (…)", or on a bare "cannot."; completeBrief leaves such a line out, and the footer
   was rewritten. Atlas's `CANT_LINE` quoted the request cut at 80 characters; it is one plain sentence
   now, naming the fact ("I don't have Renee's favorite color in Steward."). JourneyBuilder showed
   `max(1, weeks)` but chose the plural from the unrounded count ("1 weeks"); both journey sentences use
   countWords. Audit text goes through `auditTrail.actionText`: a/an, a noun said once, "Undid", "atlas"
   kept whole by `singular`, values cut at a word with "…". The glued-text check (now `tests/lib/glued.js`)
   catches a colon glued to a word. The "Not sent:pledge reminders" screen was not found by reading; the
   check is there for the sweep.
3. **Order and dates.** Gift lists sort by date, then entered time (`created_at`), newest first: the
   profile, a household, soft credits, Finance, Fundraising, giving pages, the export
   (`shared/giftOrder.js` in the browser). Every date box is `client/src/components/inputs/DateInput.jsx`
   (109 of them; `shared/dateEntry.js` reads MM/DD/YYYY, M/D/YY, eight digits, a pasted ISO date): an
   unreadable date shows a sentence and passes up nothing, and a cancelled form takes its draft with it.
   Reports' "Custom" period was already there for every period report; it is "Custom range" now, with
   labelled start and end.
4. **Imports (Finance-40X).** Not reproduced locally: on a 1,905-person org, a 5,000-row combined import
   (12–18 s) left Home, a profile, its rail and Settings under 140 ms. The recent-gift work already runs
   in batches of 50 under the import's per-org lock, on the queue (the worker on prod). A 100 ms pause
   between batches was added (`IMPORT_BATCH_PAUSE_MS`). The row save itself still runs in the import
   request; moving it to the worker with a load test is the next build.
5. **Atlas two-donor time (Atlas-23).** Not done: a local server has no model to time, and timing prod
   is a prod read.

Perf: the date box loads when first shown (`inputs/LazyDateInput.jsx`), so Home's first look carries only
its 0.4 KB loader. Measured on one runner, main's Home first look is 239 KB of JavaScript (the bar) and this
build's 241, so perf-app's two byte bars rise by 2 KB (JS 241, all 311), the reason beside them.

Tests: `tests/polish6.test.js`, red on main (23 failed).
