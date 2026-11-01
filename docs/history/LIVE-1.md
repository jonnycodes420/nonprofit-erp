## LIVE-1 · Every import and every action feeds the machine (2026-10-12)

`afterChange.js` is the one after-change step. Twelve doors call it once after they write, with the people
they touched and whether it was live or history (`DOORS`): the gift form (and every other recordGift caller),
Stripe, giving pages, both CSV imports, the donors-only CSV, the history import, the old-reports import (it
touches nobody and says so), giving-source reads, QuickBooks reads, check-in, volunteer hours, logged
touches, and mail and calendar sync. For those people only it recomputes totals (the batch recalc, moved
here from crm.js), this and last year's giving and the largest gift, the rhythm and expected next gift and
Drift's state (drift.js `assessDrift` and `computeDriftForDonors`, reused, never a second engine; it already
measured late against each donor's own cadence or seasonal window), group crossings for every group by rule
(`group_crossings`, on the journeys' own `group_sweep_seen`), and schedules the engagement recompute (a
percentile is org-wide by nature). Results land in `donor_rhythm`. A file is one call per chunk, not per row;
per-row doors use `afterChangeSoon`, which coalesces.

CSV gifts: both gift import routes send a gift from the last 30 days through recordGift with `history: true`
after the batch commits (four lanes in parallel, each donor's gifts in order, with `armed` hints so it skips
journey, sequence, instalment and membership checks that cannot fire: about 15 queries a gift, down from 24).
Older gifts stay in the batch writer, which is exactly recordGift's FIX-36 branch. Journeys an import starts
carry `cultivation_plans.started_import_id`; the undo deletes them. "Import + History" files (shape
`transaction`) now undo as a whole, with an Undo button on the result.

`readout.js` writes "what this told us" after an import is recorded, a giving-source read and a QuickBooks
read: came back, biggest ever, more than last year, new donors (and above the median), recurring started
and stopped, now late, crossed into a group, and Data health's new duplicates (read at show time). Each line
is a `readout-line` figure, a Why and one action through the audit write. `routes/readouts.js` serves What
changed under Agent, the Home Thread row, the dismiss rule (three running moves a kind down, one click
restores), What worked (a gift within 60 days after an action, "gave after", never "because"), the morning
email's "What yesterday told us", the Agent's context, and Ask ("who came back this month?"). Files map
themselves (`import_shape_mappings`, by header shape) and values do too (`import_value_mappings`, applied
server-side). Harborlight seeds one example readout and one learned mapping (`scripts/seed/live1-demo.js`).
The walk found that a readout's "Draft thank-yous" drafted for three-year-old first gifts; the action now
keeps FIX-36's 30 days and the button hides when nothing is recent. Guard: `tests/live1-alive.test.js`.
