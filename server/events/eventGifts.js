// server/events/eventGifts.js · GIFTS-1. A GIFT CAN BELONG TO AN EVENT.
//
// After a $250 gift at the spring dinner, the event said $0 raised and the
// giver "Came, didn't give": the gift form had no Event field, so nothing tied
// the money to the night. A gift now carries `gifts.event_id` from every door
// a person types one through (Add gift, Snap a check, a deposit line, the
// event page's own Record a gift), and the importer links a gift whose Event
// or Campaign column names an event exactly.
//
// Nothing here sums money. The event's Raised (numbers.eventsRaised), the
// attendee's row (figureSources.EVENT_GIVERS_SQL) and the person's profile
// all read the stamped gift through shared/numbers' EVENT_GIFT_MATCH.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };

// The event a gift names, in this org, or null. A foreign or unknown id is
// refused by the caller, never stored.
async function eventOf(query, orgId, id) {
  if (!id) return null;
  const [e] = await query("SELECT id, name FROM events WHERE id=? AND org_id=?", [String(id), orgId]);
  return e || null;
}

// The org's events by their exact name (trimmed, case kept), for the
// importer. A name two events share links nothing: which night it was is a
// question, and an import has nobody to ask.
async function eventIdsByName(query, orgId) {
  const rows = await query("SELECT id, TRIM(name) AS name FROM events WHERE org_id=? AND COALESCE(TRIM(name), '') <> ''", [orgId]);
  const out = new Map(), twice = new Set();
  for (const r of rows) { if (out.has(r.name)) twice.add(r.name); else out.set(r.name, r.id); }
  for (const n of twice) out.delete(n);
  return name => (name ? out.get(String(name).trim()) || null : null);
}

function mount(ctx) {
  const { query, requireAuth, wrap } = ctx;
  // GET /event-choices?q= — the Event field's choices: the org's events, the
  // most recent first (an upcoming one above a past one), matched on the name.
  routers.r1.get("/event-choices", requireAuth, wrap(async (req, res) => {
    const q = String(req.query.q || "").trim().slice(0, 80);
    const rows = await query(
      `SELECT id, name, CASE WHEN date_unknown THEN NULL ELSE LEFT(date::text, 10) END AS date
         FROM events WHERE org_id=? AND archived_at IS NULL AND (?::text = '' OR name ILIKE ?)   -- FLOWS-9: an archived event is offered nowhere
        ORDER BY date DESC NULLS LAST, created_at DESC, id LIMIT 25`,
      [req.user.orgId, q, `%${q.replace(/[\\%_]/g, m => "\\" + m)}%`]);
    res.json({ events: rows });
  }));
  return {};
}

module.exports = { routers, mount, eventOf, eventIdsByName };
