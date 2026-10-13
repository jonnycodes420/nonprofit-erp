# LIVE-1 · The door map

Every path that adds or changes donor data, and what it triggered after it wrote, read from the code at `90be61c` (12 Oct 2026).
RG means the gift went through `recordGift`, which already drafted the thank-you, fired the gift journeys and sequences, compared groups by rule for that person and scheduled the engagement recompute. MW means only the score middleware (any non-GET on /donors, /gifts, /interactions … schedules a recompute). Drift was never stored: it is computed on read from gifts, so every door "updated" it on the next read and nothing could say who had just become late.

## Before

| door | where | gift path | totals | thank-you | journeys | groups | engagement | Thread |
|---|---|---|---|---|---|---|---|---|
| Donor CSV import | crm.js `/donors/import`, `/donors/import-combined` | bulk INSERT | batch recalc | no | no | no | MW | no |
| Gift CSV import | `/donors/import-combined` (linkToExisting), `/gifts/import-history` | bulk INSERT | batch recalc | no | no | no | MW | no |
| History import (IMPORT-2) | historyImport.js `/history-import/commit` | no gifts | none | no | no | no | org recompute | tasks only |
| REPORTS-5 import | oldReports.js | no gifts, no people | none | no | no | no | no | no |
| Giving-source reads | server.js `syncSource` | RG (`history` on first read) | RG | last 30 days | last 30 days | RG | RG | missed-recurring threads |
| QBO-IN | qboRead.js `saveRun` | RG `history: true` | RG + per-donor recalc loop | last 30 days | last 30 days | RG | RG | no |
| Gift form | crm.js `POST /donors/:id/gifts` | RG | RG | yes | yes | RG | RG + MW | gift thread |
| Stripe webhook | webhooks.js `payment_intent.succeeded` | RG | RG | yes | yes | RG | RG | gift thread (one-time) |
| Giving pages | give.js (gift arrives through the webhook) | via webhook | via webhook | via webhook | via webhook | via webhook | via webhook | via webhook |
| Events and check-in | `registerForEvent`, `logEventAttendance` | RG when paid | RG when paid | paid only | attended/first event | no | MW | no |
| Volunteer hours | volunteer.js, `insertShift` | none | person type only | no | via hourly sweep | no | MW (none for public log) | no |
| Logged touches | `POST /donors/:id/interactions`, `/conversations` | RG if a gift is attached | none | gift only | gift only | no | MW | conversations close/open the step |
| Email and calendar sync | `syncMailbox`, calendar sync + meetingEffects | none | none | no | meetings move steps | no | none / scheduleScores | closes a step / opens a meeting step |

Imported gifts still reached journeys indirectly through the hourly sweep (`runJourneySweep` → `dynamicJoins`, anniversaries, lifecycle rows).
The import undo removed gifts, drafts, ledger rows and tagged interactions, but not journey starts.

## After (LIVE-1)

Every door calls the one after-change step (`afterChange.js`) once after it writes. `tests/live1-alive.test.js` §4 asserts it for each: six doors are driven and read back from the step's own log, six are read from the code that runs them.

| door | step called as | gift path now | thank-you / journeys for a CSV gift |
|---|---|---|---|
| Donor CSV import | `csv_import`, once per request, `recalc: false` (file-stated totals) | no gifts | n/a |
| Gift CSV import | `csv_import`, once per chunk, history | recordGift for the last 30 days, batch for older | yes for the last 30 days, never older |
| History import | `history_import`, once | no gifts | n/a |
| REPORTS-5 import | `old_reports_import`, with nobody (it touches no person) | no gifts | n/a |
| Giving-source reads | `giving_source_read`, once per read | recordGift (unchanged) | unchanged (FIX-36) |
| QBO-IN | `qbo_read`, once per save (replaces a per-donor recalc loop) | recordGift (unchanged) | unchanged (FIX-36) |
| Gift form | `gift_form`, inside recordGift | recordGift | unchanged |
| Stripe webhook | `stripe_webhook`, inside recordGift | recordGift | unchanged |
| Giving pages | `giving_page`, inside recordGift (the webhook names it) | recordGift | unchanged |
| Events and check-in | `event_checkin` (registration's gift, and coalesced on check-in) | recordGift when paid | unchanged |
| Volunteer hours | `volunteer_hours`, coalesced per org | none | n/a |
| Logged touches | `logged_touch` | recordGift if a gift is attached | unchanged |
| Email and calendar sync | `mail_calendar_sync`, coalesced | none | n/a |

What the step recomputes, for the people it is given only: lifetime, count and last gift; this and last year's giving and the largest gift; rhythm (monthly, quarterly, yearly, year-end or no pattern yet) and expected next gift; Drift's state; who crossed into a group by rule; and it schedules the engagement recompute (a percentile compares a person with the whole org, so that one is org-wide by nature).

**What Drift already did about rhythm.** Everything that matters. `drift.assessDrift` takes each donor's own gifts, uses the median interval between giving events as their cadence (or a month or quarter they give in across three or more years, the seasonal case), and calls them drifting past 1.25 times their own cadence (and at least 30 days past it) or 30 days after their seasonal window closes; lapsed beyond 2.5 times or two years. It also computed `expectedNext`. It was computed on read and never stored, so nothing could say who had just become late. LIVE-1 reuses it unchanged, names the rhythm from its output (`drift.rhythmOf`), and stores the answer per person in `donor_rhythm`, with `state_changed_at`, so a readout can say "now late".

## How long a 10,000-row import takes

The same generated file (10,000 gift rows, 4,000 new donors), posted the way the client posts it (500 donors a request), on the local scratch stack. Main is `90be61c`.

| file | main | LIVE-1 | of which the after-change step | thank-you drafts |
|---|--:|--:|--:|--:|
| three years of history, 3% from the last 30 days | 1.5s | 2.7s to 3.0s | 0.66s to 1.0s across 8 requests | 0 on main, 302 |
| last month's file, every gift from the last 30 days | 1.7s | 8.8s | 0.61s | 0 on main, 9,644 |

The step itself is a fixed number of statements per request (about a dozen, plus three per group by rule), so on production's ~65ms round trip it adds roughly a second per 500 donors. The real cost is the recent gifts going through recordGift: about 15 round trips each (24 before the import passed recordGift what could not fire), in four parallel lanes. On production that is roughly 0.25s per recent gift: about 75 seconds for a month of 300 gifts, and minutes for a file with thousands of gifts from the last 30 days. Next build: run the recent-gift decisions after the response, with a progress line, if real files are that large.

## A sample readout (the test file)

From the walk, a fresh org importing `steward-test-1000-donors-messy.csv` through Import + History: "Your October import: 51 lapsed donors came back, 17 gave their biggest gift ever", then 36 who have given more this year than all of last year, 1,001 new donors ($919,752.07 between them) and 454 of them with a first gift above the median gift of $100. Its second month's file (`make-second-month.js`, same headers): "Your October import: 4 lapsed donors came back, 6 gave their biggest gift ever". Harborlight's seeded example: "Your September import: 23 lapsed donors came back, 16 gave their biggest gift ever", plus 39 who have given more this year than all of last year, 11 new donors ($3,304 between them) and 8 of them above the median gift of $197.50.
