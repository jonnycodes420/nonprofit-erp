## CLOCK-1 · Every test sets its own clock, and every day is the org's day (2026-11-02)

**Why.** 61 test files read the real clock (the `real-clock` ratchet), which is why the battery had a
weekend pin, why suites failed after 8 PM in New York and why CI went red across DST. And about 30 app
windows still cut the day at the database's midnight (UTC on prod), a day ahead of New York from 8 PM
(the ARCH-1 defect "Some windows still cut the day at the database's midnight").

**The tests.** Every read of `Date.now()` or a bare `new Date()` under `tests/` now goes through
`tests/clock.js`: 142 reads in the 61 ratchet files and 20 more in helpers under `tests/*/` that the
ratchet never looked at. A unique id or a timing reads `testNow()`; a "today" reads `civilDay()`, the
org's day, where it had mostly been `toISOString().slice(0, 10)`, which is the UTC day and was the 8 PM
failure itself; "n days ago" reads `dayOffset(n)`, counted on the calendar so it never slips a day across
a DST change; a year reads `civilYear()`. The week sums in mail-suppression, cal1-moves and tasks2-thread
start from the org's day at noon UTC instead of the UTC instant. `real-clock` is now a hard arch-check
over every `.js` under `tests/` (not `clock.js`, `lib/browserClock.js` or fixtures), proven red with a
planted read; `audit/test-clock-direct.json` is empty. The weekend pin is gone from ARCHITECTURE.md,
house.md and tests-and-ci.md (CLAUDE.md and run-all.sh never carried it; there is no THE-PROCESS file in
the repo).

**The windows.** Two companions joined `orgTime.orgDayWindowSql` in the seam: `orgTodaySql(tz)`, the org's
today from `NOW()` (a civil column against "today": `CURRENT_DATE` is the database's day and a keyword no
test clock moves), and `orgDateOfSql(col, tz)`, the org's day of an instant (where a window cast
`timestamptz::date`). Moved: the journey sweep's look-backs (`server/outreach/helpers.js`, the old crm.js
13635–13773), a journey trigger's look-back and a plan's late and on-time steps (`journeys.js`, the old
14725), the sent-mail window (`goingOut.js`), QuickBooks' and Xero's "sent since" (`qboSync.js`,
`routes/give.js`), the recovery year (`give.js`), Finance's undeposited, unfunded, report-due, deposit
day and unthanked windows (`routes/finance.js`), a survey's audience look-back, a volunteer's hours this
year, a group's no-shows, the suggested amounts' 24 months (`server.js`), the grant heads-up task trigger
(`db.js`), the Tasks done count (which used a different window from the Tasks list) and Admin metrics'
months, now cut at midnight in Steward's zone. The card-expiry counts in give.js stay on UTC on purpose:
they agree with the expiring-card email, which a separate build decides.

**The boundary suite.** `tests/clock-boundaries.test.js` asks the figures (this fiscal year, this month,
today, the task days' week, lapsing, the weekly email's week, overdue) at 11:30 PM ET on a month's last
day, 7:30 PM ET, the fiscal year's last day, both DST changes and Feb 29, against answers written out by
hand. It plants the database's `now()` in a rolled-back transaction with the session in UTC, as prod's
is, and checks the seam's three forms beside the old ones (which give the UTC answer at every instant),
then runs the sent-mail window and the heads-up trigger live, and checks every listed site goes through
the seam with no `CURRENT_DATE` left. The trigger's old `CURRENT_DATE` cannot be planted, so its live
check stayed green on main's code; the source check is what holds it.

**The proof.** The full battery ran with the clock planted at 10 AM ET on Tuesday 3 Nov and at 11:45 PM
ET on Saturday 7 Nov (04:45 UTC Sunday). Every suite gave the same pass count at both times, except
three. int-prod-1-guards was this build's own TDZ (a second, inner `require("./clock")` shadowed the new
one) and incident-mail-gate was a dropped socket; both match Saturday's counts when rerun at Tuesday's
pin. smoke-walk timed out loading one page on Saturday (a 45-second `goto`) and passed when rerun. perf-app
is over its phone budget at both times (3,852 and 3,844 ms against 3,640), as it is on main on this
machine. A first Saturday run stalled while another session ran the same two suites, which bind fixed
mock ports; both passed alone at the same pin.
