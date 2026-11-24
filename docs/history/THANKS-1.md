# THANKS-1 · A receipt is not a thank-you, and the donor's timeline tells the truth (2026-11-23)

Five items from Jarvis's 23 Nov re-run (staging Harborlight, prod CREO Arts Demo, 5c922c6). One PR, one new suite
(`tests/thanks1-receipt-vs-thanks.test.js`), plus `pledges2` extended for item 4.

## What happened
- **The root cause.** `gifts.acknowledgement_sent` meant two things: "a written acknowledgment exists" to the receipt
  writer (set the moment a PDF is made, for the IRS rule) and "this donor was thanked" to every screen. So generating a
  receipt printed ✓ Thanked while the thank-you task and draft, which read a different rule, stayed open. Reproduced on a
  local production build of main with real clicks (org_stagewalk has receipts off and opens no thank-you task, so
  staging could not show it without changing the walk org): "Send receipt" on a $300 row, the Ack cell went to ✓, the
  task stayed open.
- **One rule.** `shared/numbers/thanks.js` THANKED / AWAITING / THANKED_AT: `thanked_at` (written only by the thank-you
  paths), or a legacy mark with no receipt ever made for the gift (a thank-you from before the clock, or an import).
  The profile's Giving list and timeline (`thankState`, now with "Receipt issued, not thanked yet" and
  `receiptWords`), the Report builder's Thanked column, Ask, Home's lead, the dashboard's lists, the starters, Atlas,
  the thank-you task, Finance's donor brief, why.js and the weekly "thank-yous" figure all read it. The receipt keeps
  its mark. The gift form's box is "Thanked" and writes the clock; un-ticking it (and every thank-you Undo) uses
  `UNTHANK_SET`, which puts the mark back to what the receipts say. `scripts/ci/ack-read-scan.js` fails CI on a new
  read of the mark (red on main: 46 lines). The tax-receipt bucket and the data export read the mark as itself.
- **Existing rows.** `scripts/ops/thanks1-receipt-not-thanked.js` (read only) counts gifts marked acknowledged with no
  thank-you clock, split by whether a receipt was made. Staging Harborlight: 0 receipt-only, 4,020 legacy marks (still
  Thanked). Nothing needs repair; prod CREO's count is Jonathan's to run.
- **A removed gift wrote on the timeline.** Jonathan's call: a removed gift is a change to the record. DELETE
  /gifts/:id now writes one Recent changes line (write_effects `gift_delete`, with a snapshot of the gift, its ledger
  line and every row a cascading key took) and the same sentence on the audit row; POST /gifts/:id/restore (30 days)
  puts it back, with the tasks, next step and journey the delete stopped. Old notes:
  `scripts/ops/thanks1-gift-removed-notes.js` (dry run; `--org --apply` moves them off the timeline, one audit row keeps
  them). Reproduced on the main build: Delete on a $25 row, timeline 2 → 3 lines, nothing in Recent changes.
- **A second gift left no next move.** Reproduced on staging (org_stagewalk): after a $25 second gift
  `/insights/donor` answered `move: null` and the panel said only "Nothing due". The second gift moves the giver to the
  retain rung and no card speaks until they go quiet. `server/insights/afterMove.js` now gives the step the rules
  still give: thank them for the newest gift if it waits (AWAITING), or "Nothing due" with why.
- **Small.** The quick gift form has the tribute fields (`TributeFields.jsx`, one component with the full form).
  Delete asks once, with the receipt's real state ("generated but never sent" / "sent to the donor"); the 409 carries
  `receiptSent`. The Record a gift form and Finance's waiting definition say a gift recorded by hand posts at once and
  imports wait. The code posts every form gift at once whatever its method, so the words say "by hand", not "cash".

## Learned
- One column, two facts, again (DEFINE-1's lapsed counts had the same shape). The scan holds the line by naming the
  column; a reader that truly needs the IRS fact says so on the line.
- The truth check (`tests/lib/flows14Checks.js`) had its own copy of the thank-you rule, which is right (it must be
  independent), so it had to learn the new definition in words, not by import.

## Left for the next brief
- The truth check disagrees on a gift refunded in full: "gifts this fiscal year" counts it in the rows (hard credit
  above $0) but Fundraising's Gifts tile does not (seen in this build's fixture; not touched here).
- A portfolio user's Undo of a removed gift: the route is under /gifts/:id, whose portfolio check reads a gift that is
  gone, so it is refused for them. Admins and staff are fine.
