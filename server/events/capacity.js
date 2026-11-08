// server/events/capacity.js · STALE-2 (W-1107-Volunteers-23). AN EVENT'S
// CAPACITY IS A NUMBER THE GUEST LIST IS CHECKED AGAINST.
//
// The QA fleet added a third guest to a capacity-2 event and nothing was said.
// The rule (Bloomerang and NPSP do the same): adding past capacity is allowed,
// because a host may mean to overbook, but never silently. The add answers 409
// with the sentence "This puts the event at 3 of 2." and the person confirms
// (the same add again with overCapacity: true). The event header shows the
// seats left, from the same count.
//
// A place is a guest row on the list (each row's quantity, one by default)
// that has not declined or cancelled, whose person is not deleted (FIX-52).
// Invited counts: an invitation is a seat being held.
"use strict";
const { NOT_DELETED } = require("../../campaignMatch");

const PLACES_SQL = `SELECT COALESCE(SUM(COALESCE(a.quantity, 1)), 0)::int AS n
  FROM event_attendees a
 WHERE a.event_id = ? AND a.org_id = ? AND COALESCE(a.status, 'invited') NOT IN ('declined', 'cancelled', 'canceled')
   AND ${NOT_DELETED("a")}`;

async function placesTaken(query, orgId, eventId) {
  const [r] = await query(PLACES_SQL, [eventId, orgId]);
  return r ? Number(r.n) || 0 : 0;
}

const cap = c => (c == null || c === "" || !(Number(c) > 0) ? null : Math.floor(Number(c)));

// { capacity, taken, left, over, sentence } for the header; null with no capacity.
function seats(capacity, taken) {
  const c = cap(capacity);
  if (c == null) return null;
  const left = Math.max(0, c - taken), over = Math.max(0, taken - c);
  const sentence = over ? `${taken} of ${c} places taken: ${over} over capacity.`
    : left ? `${left} of ${c} ${c === 1 ? "seat" : "seats"} left.` : `Full: ${c} of ${c} places taken.`;
  return { capacity: c, taken, left, over, sentence };
}

// The warning for adding `adding` places, or null when it fits (or no cap).
function overBy(capacity, taken, adding) {
  const c = cap(capacity);
  if (c == null || !(adding > 0)) return null;
  const after = taken + adding;
  if (after <= c) return null;
  return { error: "over_capacity", capacity: c, taken, after,
    message: `This puts the event at ${after} of ${c}.` };
}

// The add-guest door's first step (server/events/routes.js, POST
// /events/:id/attendees): fits, or confirmed (overCapacity: true), it goes on
// to the add itself; past capacity unconfirmed, it answers 409 and adds nothing.
// How many places this add would take: the people named who exist and are not
// already on the list (a re-add changes nothing), or the one walk-in.
async function placesAdding(query, orgId, eventId, body) {
  const ids = Array.isArray(body.donorIds) ? [...new Set(body.donorIds.map(String))] : null;
  if (!ids) return body.name ? 1 : 0;
  if (!ids.length) return 0;
  const [r] = await query(
    `SELECT COUNT(*)::int AS n FROM donors d
      WHERE d.org_id = ? AND d.id = ANY(?::text[]) AND d.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = ? AND a.org_id = d.org_id AND a.donor_id = d.id)`,
    [orgId, ids, eventId]);
  return r ? Number(r.n) || 0 : 0;
}

function gate(query) {
  return (req, res, next) => (async () => {
    const body = req.body || {};
    if (body.overCapacity === true) return next();
    const [ev] = await query("SELECT capacity FROM events WHERE id = ? AND org_id = ?", [req.params.id, req.user.orgId]);
    if (!ev || cap(ev.capacity) == null) return next();
    const adding = await placesAdding(query, req.user.orgId, req.params.id, body);
    const over = overBy(ev.capacity, await placesTaken(query, req.user.orgId, req.params.id), adding);
    if (!over) return next();
    res.status(409).json(over);
  })().catch(next);
}

module.exports = { PLACES_SQL, placesTaken, seats, overBy, placesAdding, gate };
