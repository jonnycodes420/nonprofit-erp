## PARITY-4 · Keep the money that slips, and lists in plain words (2026-10-04)

Muse's side-by-side put four things on the "theirs does, ours doesn't" list; each was built on what was there.
**Cards the bank updated:** the `payment_method.automatically_updated` handler (2026-09-11) stored the card and
showed nothing; it now writes a timeline note and Recurring counts them through `cards-auto-updated`. The live
endpoint still does not subscribe the event (NEEDS-JONATHAN). **Gifts started, not finished:** new `gift_starts`,
written by the three-step form's email step and every gift Checkout session, marked by `checkout.session.expired`
(also unsubscribed on live); "finished" is read from the gifts every time (`giftStartOpenSql`), dated from the day
before the start so an import of old gifts cannot close a row. Notes are drafts an admin sends, once per person
per form (Test 1, `parity4-started`). **Show me:** a list question inside `POST /why/ask` becomes a filter spec
over `groups.RULE_KEYS`, checked once (`shared/showMe.js`); seven keys were added to the one shared filter because
three of the four example questions had none (Test 2, `parity4-show-me`). **Seating and check-in:** FIX-11's
tables gained shape, chair numbers and VIP (`seatPlaces`, one function for screen, print and server); the kiosk
gained a BarcodeDetector camera scan, an "already in" answer that writes nothing, walk-ins and a count that opens.
