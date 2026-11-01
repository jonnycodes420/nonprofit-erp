## EVENTS-1 — the events hub (2026-09-28)

An ED runs a gala or a 5K from Steward, and every guest leaves with a next
step. Much of the spine already existed and was unreachable: the model, the
levels with fair-market value, the guest list, tables, attendance, and the
money path. `registerForEvent` already wrote every payment as a gift through
`recordGift` with the quid-pro-quo split, so the receipt already stated the
deductible part. What was missing was a door, a goal, and the night itself.

**1. Events is its own room.** It was commented out of the nav. It is in the
rail beside Journeys now, for the same reason Journeys is: an organisation
lives inside a gala for six weeks and it does not belong behind a More menu
during them. Each card shows date, GOAL, RAISED and REGISTERED, and every one
of those numbers opens its rows.

**2. A goal, and a raised that is not typed.** `events.goal_amount` is what
the night is measured against. Raised is summed from gifts stamped with
`gifts.event_id`, which registration now sets: the only link before was the
campaign NAME, so a renamed event lost its money.

**4. Tables, and the people without one.** Drag a guest onto a table. The
unseated keep their own column rather than being hidden, because the people
without a seat are the ones the chart exists to find. Printing gives the
seating chart with dietary notes and the name tags, and a name tag carries a
name and a table and nothing else: a badge that prints somebody's giving level
tells the room what they gave.

**5. The door.** VOL-1's kiosk shape for a guest list: one big search box, one
big list, 16px type, because it is used standing up holding a pen.

**6. The morning after.** Raised against goal, came against registered,
first-time givers, sponsors. Every figure opens its rows and the raised rows
foot to the figure to the cent. The caveat is in the payload, not a caption:
an event is not the reason anybody gave. Attendance already fired the
"attended an event" journey trigger, so each guest already got a next step on
the Thread. A thank-you per sponsor is DRAFTED into the queue FIX-6 gave an
Approve button, so it goes out the same way every other one does.

**3. The public page, and the line it does not cross.** `/e/:slug` on the
org's own band, framing like a donation form, working on a phone: 16px inputs
so nothing zooms, a 48px button, the deductible part stated before the button.
It takes tickets with the names of everybody coming, sponsorships, and sends
somebody who cannot come to the giving page.

**It does not take a card, and it says so on the page.** A registration
arrives as a request the office confirms, and confirming runs the same
`registerForEvent` every other registration runs, so there is no second money
path. Taking the card inline means a Connect checkout session AND a webhook
branch that completes the registration, and half of that is worse than none: a
page that takes a card and does not reliably finish the registration charges
somebody for a seat they do not get. That is EVENTS-1b.

**One shell, two public surfaces.** The volunteer page's renderer moved to
`shared/publicPage.js` so the registration page wears the same band, cards and
inputs. A second copy is how two public surfaces end up on different versions
of one brand. The move exposed a race worth keeping: the shell arrives by
dynamic import, and the routes awaited only `VS_READY`, so a request landing
between boot and resolution would have read it as null. They await both now.

**What the walk caught.** Counting registrations as `Number(quantity) || 1`
turns a zero into a one, and a named guest carries quantity 0 on purpose — a
seat and a name tag, not a second place. Three places and two guests reported
as five. And the public page printed "Sat Dec 05 2026 00:00:00 GMT-0500
(Eastern Standard Time)" as its date, because `events.date` is a DATE column
that pg hands back as a Date OBJECT and ten characters of that is "Sat Dec 0".

**A note on the battery run.** `pledge-math` took 1,035 seconds in the final
run and one second on its own straight afterwards. It was starved by this
session's own parallel seeds and walks against the same scratch Postgres, not
a regression. Worth knowing before somebody chases it.
