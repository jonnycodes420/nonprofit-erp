// server/events/typedGuest.js · FLOWS-3 (W-1108-Volunteers-20). A GUEST TYPED
// ONTO AN EVENT IS A PERSON.
//
// "Add Guest" on an event, and a walk-in typed at the door, wrote a guest row
// with no person behind it: the guest was on that event's list and nowhere
// else. Search could not find them and Everyone did not move.
//
// Now the name (and email, if given) is matched the way every door matches
// (personMatch.findPersonId: the email first, then a name only one person
// has). Nobody matches: they are added by + Add's own path
// (server/donors/addPerson.js), typed "guest", so they are a contact (never a
// donor) whom search finds and Everyone counts. The guest row then points at
// them like any other guest from the directory.
"use strict";
const PM = require("../../personMatch");

async function typedGuestPerson(ctx, req, { name, email }) {
  const orgId = req.user.orgId;
  const known = await PM.findPersonId(orgId, { name, email });
  if (known) return { id: known, added: false };
  const r = await require("../donors/addPerson").addPerson(ctx, req, { name, email: email || "", personTypes: ["guest"] });
  if (r.status !== 201) return { refused: r };
  return { id: r.body.id, added: true };
}

module.exports = { typedGuestPerson };
