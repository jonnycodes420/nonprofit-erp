// server/events/doorSearch.js · EVENTS-4 item 3. THE DOOR FINDS EVERY GUEST.
//
// "check-in search cannot find invited-only guests and offers to create a
// duplicate person" (fleet, 22 Nov). The door's list (GET /events/:id/kiosk)
// is the people expected: registered or came. Somebody only invited who turns
// up was "Nobody by that name on the list", and the walk-in Add beside it made
// a second person with the same name.
//
// The count and the folded list are unchanged (expected is still Registered).
// The SEARCH also reads these, by name and by email, before it offers Add:
//   - invited: on the list, not registered (no reply, or declined), person live;
//   - waiting: on the event's waiting list (event_waitlist), not yet taken or
//     removed, and not already on the guest list by email.
// Checking an invited guest in is the same check-in (they came). A waiting
// person is added by email first (POST /events/:id/attendees matches the
// person on file, WIRE-1), then checked in.
"use strict";
const EV = require("../../shared/numbers/events");

async function doorOthers(query, orgId, eventId) {
  const invited = await query(
    `SELECT a.id, a.name, a.email, a.status, a.quantity, a.table_label, a.checked_in_at, a.dietary, a.vip, a.donor_id,
            l.name AS level_name, l.kind AS level_kind
       FROM event_attendees a LEFT JOIN event_levels l ON l.id = a.level_id
      WHERE a.org_id = ? AND a.event_id = ? AND ${EV.EVENT_INVITED("a")} AND NOT ${EV.EVENT_REGISTERED("a")}
        AND ${EV.EVENT_GUEST_LIVE("a")}
      ORDER BY a.name`, [orgId, eventId]);
  const waiting = await query(
    `SELECT w.id, w.name, w.email, l.name AS level_name
       FROM event_waitlist w LEFT JOIN event_levels l ON l.id = w.level_id
      WHERE w.org_id = ? AND w.event_id = ? AND w.removed_at IS NULL AND w.taken_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM event_attendees a WHERE a.org_id = w.org_id AND a.event_id = w.event_id
                         AND LOWER(COALESCE(a.email, '')) = LOWER(w.email) AND ${EV.EVENT_INVITED("a")})
      ORDER BY w.position, w.created_at`, [orgId, eventId]).catch(() => []);
  return {
    invited: invited.map(g => ({ ...g, onList: g.status === "declined" ? "declined" : "invited" })),
    waiting: waiting.map(w => ({ id: w.id, name: w.name, email: w.email, level_name: w.level_name, onList: "waiting" })),
  };
}

module.exports = { doorOthers };
