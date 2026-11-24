# UNDO-1 · Every side effect records how to take it back

Six items from Jarvis's 22 Nov sweep (staging Harborlight, prod CREO Arts Demo, a2746ab). One PR, one new suite
(`tests/undo1-effects.test.js`). Wave 3, after TRASH-1 (both touch the gift delete path).

## What happened
- **The root cause.** Writes fired side effects that only went forward, and nothing recorded what each one did. Now one
  table, `write_effects`, holds each side effect with the row's value before it, and one helper reverses a write's
  effects newest first (`server/effects/writeEffects.js`). A write with an Undo writes a header line that Recent changes
  lists (refund, task tick, Home's Done, a touch that closed a step).
- **Refunds had no undo.** Reproduced on staging (dbe5f39, org_stagewalk): a $100 refund, no line in Recent changes, both
  guessed undo routes 404. Now POST /refunds/:id/undo (30 days, with her reason, never a Stripe card refund): the refund row
  goes through the same remover the gift-and-refund delete uses (`refundPairs.removeRefundRows`), the reissued receipt is
  voided and the voided one is live again, unless a receipt for the gift was sent since the refund (then both stay and
  the answer says so). The refund's and the Undo's audit rows are one sentence each, with the reason.
- **A tick finished a journey that its Undo didn't restore.** Reproduced on staging: the profile's Mark done
  (POST /threads/:id/done) took a one-step journey from In it to Completed; its Undo reopened the step and the journey
  stayed Completed; nothing in Recent changes. A plain task tick did not advance the journey at all until the next
  advance (any later log), which is how a reopened task could leave a completed journey behind. Now every close that
  advances a journey records each step and plan it moved, tagged with the step that closed (`planEffects.js`), and
  every reopen (task untick, Home's Done Undo, a touch's Undo) takes them back first, including the next step's Thread
  the advance opened. A task tick advances the journey at once.
- **A logged touch closed the open step silently.** Not a bug in the data (SENDS-1's rule: a touch with a next step
  closes the open one) but in what she was told. The dialog now says "This closes the next step: …" with Close it /
  Keep it open, and the close is a Recent changes line whose Undo reopens it, removes the touch's own new step and
  moves the touch to the trash (a touch that recorded a gift keeps its line).
- **Invite + register = 2.** Reproduced on staging: invited ×1, registered with one $100 ticket → status invited,
  quantity 2; deleting the gift → still 2. The upsert added old + new and only converted 'cancelled'. Now an invited,
  declined or cancelled row is converted (registered, the places bought); a row already registered still adds. The
  row as it was is recorded against the gift, and DELETE /gifts/:id reverses it in its transaction.
- **Rows already wrong.** `scripts/ops/undo1-reopen-journeys.js` (dry run by default) finds journey steps marked done
  whose own next step is open again, and reopens them with `--org --apply`. Run on staging's walk org it found and
  fixed the repro's row. Guest rows already at old + new are not repaired: nothing recorded which part was the invite.

## Left for later
- A reversed journey step leaves its "Journey step: …" timeline line and any draft it wrote.
- The toast's own Undo and the Recent changes line can both list the same tick for the 30 minutes the tab remembers it.
