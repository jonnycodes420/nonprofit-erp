// server/volunteers/eventTeam.js · VOL-3 item 5. AN EVENT HAS A VOLUNTEER TEAM.
//
// A shift (volunteer_slots) can belong to an event (volunteer_slots.event_id, vol3.js); it is
// made from the event page through the one shift write (POST /volunteer-hub/slots with eventId).
// This read is what the event page shows: each of its shifts, when, how many it needs, and who is
// on it (confirmed, then the waiting list in order). A coordinator sees names only: nothing here
// carries giving.
"use strict";
const { query } = require("../../db");

async function eventTeam(orgId, eventId) {
  const [ev] = await query("SELECT id, name, to_char(date, 'YYYY-MM-DD') AS date FROM events WHERE id=? AND org_id=?", [eventId, orgId]);
  if (!ev) return null;
  const slots = await query(
    `SELECT s.id, s.date, s.start_time, s.end_time, s.capacity, s.name, s.published, o.id AS opportunity_id, o.name AS opportunity_name,
            (SELECT COALESCE(SUM(r.needed), 0) FROM volunteer_slot_roles r WHERE r.slot_id = s.id)::int AS role_needed,
            (SELECT COUNT(*) FROM volunteer_slot_roles r WHERE r.slot_id = s.id)::int AS role_count
       FROM volunteer_slots s JOIN volunteer_opportunities o ON o.id = s.opportunity_id
      WHERE s.org_id = ? AND s.event_id = ? AND s.cancelled_at IS NULL
      ORDER BY s.date, s.start_time, s.id`, [orgId, ev.id]);
  const ids = slots.map(s => s.id);
  const people = ids.length ? await query(
    `SELECT su.slot_id, su.status, su.position, d.id AS person_id, d.name, r.name AS role
       FROM volunteer_signups su JOIN donors d ON d.id = su.person_id AND d.org_id = su.org_id AND d.deleted_at IS NULL
       LEFT JOIN volunteer_slot_roles r ON r.id = su.role_id
      WHERE su.org_id = ? AND su.slot_id = ANY(?::text[]) AND su.cancelled_at IS NULL AND su.status IN ('confirmed','completed','waitlisted')
      ORDER BY (su.status = 'waitlisted'), su.position NULLS FIRST, lower(d.name), d.id`, [orgId, ids]) : [];
  const shifts = slots.map(s => {
    const on = people.filter(p => p.slot_id === s.id);
    const confirmed = on.filter(p => p.status !== "waitlisted");
    const waiting = on.filter(p => p.status === "waitlisted");
    const needed = s.role_count ? s.role_needed : (s.capacity == null ? null : Number(s.capacity));
    return {
      id: s.id, date: String(s.date).slice(0, 10), startTime: s.start_time, endTime: s.end_time,
      name: s.name || s.opportunity_name, opportunityId: s.opportunity_id, published: s.published !== false,
      needed, filled: confirmed.length,
      people: confirmed.map(p => ({ id: p.person_id, name: p.name, role: p.role || null })),
      waiting: waiting.map(p => ({ id: p.person_id, name: p.name, position: p.position, role: p.role || null })),
      sentence: needed == null
        ? `${confirmed.length} on this shift, no limit set.`
        : `${confirmed.length} of ${needed} filled${confirmed.length < needed ? `, ${needed - confirmed.length} more needed` : ""}.`,
    };
  });
  const filled = shifts.reduce((a, s) => a + s.filled, 0);
  return {
    event: { id: ev.id, name: ev.name, date: ev.date || null },
    shifts,
    sentence: shifts.length
      ? `${shifts.length} ${shifts.length === 1 ? "shift" : "shifts"} for this event, ${filled} ${filled === 1 ? "person" : "people"} on them.`
      : "No volunteer shifts for this event yet. Add one and it shows here and on the Volunteers schedule.",
  };
}

module.exports = { eventTeam };
