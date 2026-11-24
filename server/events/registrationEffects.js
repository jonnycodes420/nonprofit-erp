// server/events/registrationEffects.js · UNDO-1 item 5. A REGISTRATION CONVERTS AN INVITE.
//
// "one registration, one $100 gift, ticket shows 2 of 5 taken, guest shows x2;
// deleting the gift does not fix it." (fleet, 22 Nov)
//
// registerForEvent upserted quantity = old + new, so a person on the list as
// invited (quantity 1, nobody paid) who then bought one ticket held two places.
// Now a row that is only an invite (or a decline or a cancel) is converted:
// registered, with the places bought. A row that is already a registration
// still adds, because that is a second real purchase.
//
// What the registration did to the attendee row is recorded against its gift
// (write_effects, kind attendee_quantity; before = the row as it was, or none
// when the registration made it). Deleting the gift reverses it in the same
// transaction (DELETE /gifts/:id): the invite is back as it was, and a row the
// registration made is cancelled.
"use strict";

const WE = require("../effects/writeEffects");

// The statuses a registration converts rather than adds to.
const CONVERTS_SQL = `COALESCE(event_attendees.status, 'invited') IN ('invited', 'declined', 'cancelled', 'canceled')`;

async function recordRegistration(db, { orgId, giftId, donorId, attendee, wasRow, who }) {
  await WE.record(db, { orgId, kind: "registration", id: giftId, donorId, who: who && who.id ? who : { id: "system:event-registration", name: "Event registration" } },
    { kind: "attendee_quantity", table: "event_attendees", rowId: attendee.id, before: wasRow || null,
      after: { status: attendee.status, quantity: attendee.quantity } });
}

// Inside DELETE /gifts/:id's transaction: the attendee change this gift's registration made goes back.
function reverseForGift(db, orgId, giftId, who) {
  return WE.reverse(db, orgId, { parentKind: "registration", parentId: giftId }, who, { reason: "the registration's gift was deleted" });
}

module.exports = { CONVERTS_SQL, recordRegistration, reverseForGift };
