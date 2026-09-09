# FIX (2026-09-09) — the Thread's next step: decisions taken, and what you may want to overturn

Nothing in this fix was blocked; three calls were made where the spec's table
did not reach. Each is one line to change if you disagree.

## 1. "Call · no answer" was not collapsed into "Call"
The spec's table has one Call row → "Follow up", +5. Steward has two call touch
types. `call_reached` took the spec's row. **`call_no_answer` kept "Try again",
+2** — an unanswered call leads to another call, not to a follow-up on a
conversation that never happened, and dating it +5 buries the callback.
*To collapse it:* one line in `NEXT_STEP_DEFAULTS` (shared/threadShape.js);
`tests/threads.test.js` §1 and `thread-next-step` §4 assert the current row.

## 2. "Visit" follows "Meeting"
The spec names Meeting; Steward also has Visit, which BUILD-81 made a sibling.
It stays one: **Follow up on \<subject\>, +5.**

## 3. The BUILD-81 meeting/visit follow-on chain is retired
It existed to walk a meeting from its thank-you (+2) to the real follow-up
(+14). With Meeting now proposing the follow-up itself, keeping the chain
would mean closing "Follow up on the gala" auto-proposes another "Follow up" —
noise. **The mechanism still reads on both sides** (`followon_*` columns,
`thread.followon` prefill) so threads created before today still walk their
chain; no default plants a new one. *To bring it back:* add `followon` to a row
in `NEXT_STEP_DEFAULTS`; nothing else needs changing.

## Also worth your eye
- **New touch types** "Ask or proposal made" and "Note (no touch)" write
  `interactions.type` of `ask` and `note`. `note` is an existing type; **`ask`
  is new** (the column is free text and already carries `other`/`in_kind`; the
  timeline renders it as "Ask made" in gold). Say the word if you would rather
  an ask logged as `meeting` or `stewardship`.
- **The step label is now free text** (prefilled, editable, ≤120 chars, one
  line) instead of a four-item select. The type still comes from the fixed
  vocabulary — derived from the label's own verb — so timelines and filters are
  unchanged. Old threads keep the `thank` type; nothing writes it any more.
- **The note extractor is deliberately literal**: it matches phrasings, not
  meaning, and shows the phrase it matched so a wrong read is visible on the
  screen before it is saved. It will miss asks written in shapes it does not
  know — those fall through to the touch default, which is the safe direction.
