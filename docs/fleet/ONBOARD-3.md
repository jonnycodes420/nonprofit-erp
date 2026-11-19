# For the fleet · ONBOARD-3

ONBOARD-3 adds the end of onboarding: a totals check after a new org's first donor file, "Your first 30 minutes" on Home, a day-30 readout, and a printable list of this week's notes. Harborlight and org_stagewalk already had donor files, so the totals check is never due for them on its own; open it by address. Every write goes in org_stagewalk.

**Surfaces changed:** "Does this match your old system?" (`/onboard/totals`); Home → "Your first 30 minutes" (and its one-line "Open" strip after Not now); Home → "Your first N days" (day 30); /ops → Onboarding → "Day 30"; Tasks and Home header → "Print this week's notes" (`/print/notes`); Import → Check your file → "These match, make it live" now goes on to the totals check.

| Check | Clicks | Expect now |
|---|---|---|
| Totals by year (read only, Harborlight) | Go to `/onboard/totals`. | Three years in Harborlight's fiscal years (Jul to Jun), the current one "(so far)". Each total equals Reports → By year for that year, to the cent. Click a total: the rows open and foot to it. "Back to Home" at the bottom. |
| Matches and a difference (org_stagewalk; typing only compares, nothing is stored) | In org_stagewalk, on `/onboard/totals`, type the middle year's total rounded to the dollar, click away. Then type $1,000 more than the oldest year, click away. | Middle year reads **Matches ✓**. Oldest year reads "Your old system says $X, $1,000 more than Steward." with "What usually explains a difference:" listing any refunds, soft credits or unpaid pledges in that year, each a figure that opens its rows. |
| Off the happy path: a bad figure (org_stagewalk) | Type "about twelve grand" in a box, click away. | "Type a dollar amount for …, like 12,400 or 12,400.50." Nothing saved. |
| Looks right, then the first 30 minutes (needs a write, org_stagewalk) | In org_stagewalk, `/onboard/totals` → Ask Jonathan on any year → Looks right. | Lands on Home with "Your first 30 minutes": up to 10 people by name, each with Home's own reason, in the same order as Home's moves; Stripe and QuickBooks in their real state; "1 of 3 done". /ops → Onboarding → org_stagewalk's row shows "Waiting on: Totals …". |
| Off the happy path: Not now (needs a write) | On that card press Not now, reload Home. | A one-line "Your first 30 minutes · N of 3 done · Open". Open brings the card back. |
| Log a touch ticks step 3 (needs a write) | Log a touch beside the first name (Call, Reached). | Step 3 ticks; "2 of 3 done" or more. When all three are done the card says "That's your first 30 minutes done." once; after Back to Home and a reload it is gone. |
| Print this week's notes (read only) | Harborlight → Tasks → Print this week's notes (a new tab opens the print dialog; cancel it). | One page: "Notes to write this week", Monday to Sunday. Each row: a box, the name, the step and its day, address or "No mailing address on file.", last gift, About them (when written), and "A first line". Nobody marked do not contact. If nobody is due: "Nobody has a thank-you or note due this week (…). Nothing to print." |
| /ops Day 30 (read only) | /ops → Onboarding, scroll to Day 30. | Each org that pressed Looks right, "day N since data in", its headline ("gave again since you started", never "recovered") and what was done. |

**What could have broken nearby:** Home's first frame (the new card loads lazily only for an org in this state), Home's "Getting set up" (still shown under the new card for an org in onboarding), the ONBOARD-2 kickoff list ("Who to call tomorrow", now the same picker), Import → Check your file → make it live (no longer sets Data in by itself; the /ops board's Data in now waits for Looks right), the spreadsheet import's finish (one extra step after Data health), and Reports → By year (the totals check reads the same function).

**Needs a write:** rows 4 to 6 (org_stagewalk only).
