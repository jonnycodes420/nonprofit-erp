## EVENTS-4 · Free events work without Stripe, and every event screen says what it will do (2026-11-24)

The fleet (22 and 23 Nov) could make no ticket on staging: ticket types sat behind the payments gate as a whole. A $0
price was refused twice over (`validateLevel` and a `CHECK (price > 0)`), the public page and its register form were
"Not open yet" for any org without Stripe, and the ticket card lived only under Fundraising > Tickets & sponsors. Now a
ticket may be $0 (a sponsorship may not); `registerForEvent` writes no gift or pledge for a $0 registration; the page
opens when payments are connected or the event has a current free ticket, and a paid ticket on it says "Tickets go on
sale once payments are connected" on its own card (`server/events/freeTickets.js`). The ticket card is one component
(`events/EventTicketTypes.jsx`) on the Events page and on Fundraising.

The other five were screens whose button said one thing and did another. The event's Archive/Delete button now carries
a line under it ("Has 1 guest and 1 volunteer shift, so it's archived, not deleted"), counts shifts as holdings, asks
the server again on the press, and `DELETE /events/:id` has `checkWriteAccess`. The door's search reads invited and
waiting-list people by name and email (`server/events/doorSearch.js`) before offering Add, and Add carries an email so
the person on file is matched first. The shift mislabel: Volunteers > Check-in named every
shift by its opportunity, never by its own label (`shapeSlot` did not carry `name`). A shift named "Coat check" on the
E4 repro event read "UNDO-1 gala mwtryoxs", because the repro put it under an opportunity named for another event (the
event page's Add a shift names a new opportunity after the event, so this is a real shape). It is now named by its own
label, with the opportunity beside it. A shift of any kind is removed through removal.js:
empty, deleted in one step; with people, the confirm names them, their sign-ups are cancelled with it and Undo restores
them exactly (`SOFT_WITH` in routes/removal.js). A one-day event is one date, and an auction item takes one recorded
winner until Remove winner (or the save's Undo) takes it off.

Deep links: the canonical `/app/events?event=<id>` loaded 20 of 20 cold on staging, no hang. The brief's `/app/events/<id>`
was not a route and landed on Home 20 of 20; it now opens the event and canonicalises.

Lesson: a gate put in front of a whole page ("no payments, not open") also shuts the parts that never needed it. Gate
the thing that needs the precondition (the paid ticket), and say so on that thing.
