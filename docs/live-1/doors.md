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
