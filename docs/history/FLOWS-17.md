# FLOWS-17 · Justin's Place: one thank-you per gift, and tasks you can finish where you see them (16 Nov 2026)

Two items from a paying customer (Justin's Place, by email on 16 Nov). Both reproduced first on a
local production build (NODE_ENV=production, the built client) with a fixture shaped like her org: a
fresh signup through `/auth/register-org`, gifts entered by hand on the profile, with and without the
"New donor, first year" journey running and receipts on or off. Prod data was never read.

## What was found
- **Two thank-you tasks per gift.** Every new org has "Gift received → notify the team"
  (`instant_gift_thanks`) on from signup (BUILD-36). Its `notify_gift` action wrote
  "Thank <name> · $<amount> just came in" straight into `tasks`, in the request, beside the gift's
  own "Send thank-you note" step (or the journey's "Call to say thank you"), which the queue opens a
  moment later. SENDS-1's `thankYouOnce.js` made one writer for the Stripe webhook only, and FLOWS-5's
  dry run listed only pairs that both carried the gift's id (a journey's step carries none), so this
  writer was never routed through it. A second gift while the first's step was open added another.
- **A checkbox that does nothing.** FLOWS-6 drew an open task on the profile's timeline (Activity and
  the Tasks tab) as an empty box so that only a done one carried a check. It was a picture: a click
  only opened the card. Coming up's "Mark done" wrote the whole row back with `PUT /tasks/:id`, with no
  Undo. Only the Tasks page used the complete call.

## What changed
- `notify_gift` writes through `thankYouTaskOnce` (keyed by the gift, stamped `thanks_gift_id` and
  `source_gift_id`, given its owner); `settleThankYous` takes the same person lock, so a task written
  while the step opens is voided (`one_thank_you`), never left beside it.
- `server/tasks/dupThanks.js` is the repair's rule and `scripts/ops/flows17-dup-thanks.js` lists the
  rows the old writer left; `--org … --apply` voids them with one audit row.
- `client/src/lib/completeTask.js` is the one way to tick a task (`POST /tasks/:id/complete`, with
  Undo). The Tasks page, the profile's Coming up and the profile's timeline box (`TaskTick.jsx`) use
  it; Home's task rows already did. Read-only, an open task shows a list mark, not a box.

## What was learned
- A rule given one writer (SENDS-1) has to name every writer, or the next one walks around it. The
  suite now reads every `INSERT INTO tasks` that stamps a gift and thank-you words.
- A picture of a control is a claim that it works. If a spot can't act, it draws no box.
- Moving a journey on the moment its step is ticked opens the next step at once, and Undo is then
  refused ("a newer next step is already open"). The complete call was left as it was.
