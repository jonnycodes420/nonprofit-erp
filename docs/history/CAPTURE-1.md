## CAPTURE-1 Home tile · Gift to thank-you on Home (2026-10-18)

Approved from the mockup in `docs/capture-1/home-mockup/`. `HomeThankClock.jsx` sits first in the Today rail's
resting view: the clock line (the exact mean, so it foots with its rows), a bar per org day for 30 days, and the money
cards waiting in To confirm. `/thank-yous/clock` gained `trend` and `waiting`. Two defects in CAPTURE-1 found by looking:
the clock dated rows in the database's zone (a thank-you at 11:30pm New York landed on tomorrow on a UTC database), and
its drawer showed days as dollars (the source had no `amountKind`); days now show to two decimals so the rows foot.

## CAPTURE-1 · Zero-day thank-you, part one: nobody types a gift (2026-10-18)

Before: a check reached Steward only by someone typing it on a donor's record or pasting a deposit slip (BUILD-88b),
with BUILD-95's photo read helping on the sheet; a pledge form, a donor-advised fund letter or a matching-gift letter
was typed by hand days later, and INT-4 counted email attachments without keeping any. After: one "To confirm" part
under Money in. A check photo, a scanned PDF, a matched person's email attachment or anything forwarded to the org's
capture address becomes a card: the document beside what Steward read, one primary button. Money is recorded only by
the confirm tap, through `recordGift`, with the image attached and a thank-you draft; low-stakes changes (an address)
apply at once under "Done for you" with Undo for 30 days. The two-amount rule from BUILD-95 decides a check's amount.
A routing or account number is never stored: the read schema has no field for one and every stored string is
scrubbed. `gifts.received_at` and `gifts.thanked_at` give the thank-yous screen one clock line. Seed changed
(`scripts/seed/capture1-inbox.js`); the fixtures are `tests/fixtures/capture1/`, written by
`scripts/capture1-make-fixtures.js`. The inventory is `docs/capture-1/inventory.md`.
