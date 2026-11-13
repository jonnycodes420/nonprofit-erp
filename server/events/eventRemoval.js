// server/events/eventRemoval.js · WALKB-2 item 5. AN EVENT YOU CAN TAKE AWAY.
//
// Muse's Walk B: there was no way to delete an event anywhere. The old
// DELETE /events/:id existed with no button, and it would have deleted an
// event with gifts on it (its guests cascaded with it). Now:
//   - an event with no gifts, no pledges and no guests can be deleted (the
//     detail page asks first);
//   - an event with any of them is archived instead: it leaves the Events
//     list (Archived shows it), and its gifts stay exactly where they are, so
//     Raised, lifetime, campaigns and every report count them as before.
// Mounted above server/events/routes.js, so this DELETE is the one that answers.
"use strict";
const PLANT = process.env.TEST_MODE === "1" ? String(process.env.FLOWS10_PLANT || "") : "";   // FLOWS-10: tests/flows10.test.js plants defects; never set outside tests
const express = require("express");
const EV = require("../../shared/numbers/events");
const GUEST_LISTED = (a = "a") => PLANT === "allrows" ? "TRUE" : `(${EV.EVENT_GUEST_LIVE(a)} AND ${EV.EVENT_INVITED(a)})`;

const routers = { r1: express.Router() };

// What an event holds that a delete would orphan. One query.
async function eventHolds(query, orgId, id) {
  const [h] = await query(
    `SELECT (SELECT COUNT(*)::int FROM gifts g WHERE g.org_id = e.org_id AND g.event_id = e.id) AS gifts,
            (SELECT COUNT(*)::int FROM pledges p WHERE p.org_id = e.org_id AND p.event_id = e.id) AS pledges,
            (SELECT COUNT(*)::int FROM event_attendees a WHERE a.org_id = e.org_id AND a.event_id = e.id AND ${GUEST_LISTED("a")}) AS guests,
            (SELECT COUNT(*)::int FROM event_attendees a WHERE a.org_id = e.org_id AND a.event_id = e.id AND NOT ${GUEST_LISTED("a")}) AS cancelled
       FROM events e WHERE e.id = ? AND e.org_id = ?`, [id, orgId]);
  return h || null;
}
// FLOWS-10 item 3 (W-1112-Volunteers-01X): "guests" is the guest list's own rule (shared/numbers/events.js).
// A guest removed on the Events screen is marked cancelled, not deleted, so this counted every row and
// the archive button said "1 guest" after every guest was removed, after a reload too. A cancelled or
// deleted person's row is still a record, so it still means Archive, not Delete, and says what it is.
const { countLabel } = require("../../shared/countWords.js");
const plural = (n, w) => countLabel(n, w);
function holdsWords(h) {
  return [h.gifts && plural(h.gifts, "gift"), h.pledges && plural(h.pledges, "pledge"), h.guests && plural(h.guests, "guest"),
    h.cancelled && countLabel(h.cancelled, "cancelled or removed registration")].filter(Boolean).join(", ");
}
const held = h => h.gifts + h.pledges + h.guests + (h.cancelled || 0) > 0;

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap } = ctx;
  const app = routers.r1;

  // What the detail page needs to offer Delete or Archive.
  app.get("/events/:id/removal", requireAuth, wrap(async (req, res) => {
    const h = await eventHolds(query, req.user.orgId, req.params.id);
    if (!h) return res.status(404).json({ error: "Not found" });
    const isHeld = held(h);
    res.json({ canDelete: !isHeld, holds: h,
      sentence: isHeld ? `This event has ${holdsWords(h)}, so it can be archived but not deleted. Archiving keeps every gift counted.`
                     : "This event has no gifts and no guests, so it can be deleted." });
  }));

  // BUILD-75 B: a foreign or unknown id answers 404, never a false success.
  app.delete("/events/:id", requireAuth, wrap(async (req, res) => {
    const h = await eventHolds(query, req.user.orgId, req.params.id);
    if (!h) return res.status(404).json({ error: "Not found" });
    if (held(h)) {
      return res.status(409).json({ error: "event_has_activity", holds: h,
        message: `This event has ${holdsWords(h)}, so it can't be deleted. Archive it instead: its gifts stay counted.` });
    }
    const { changes } = await run("DELETE FROM events WHERE id=? AND org_id=?", [req.params.id, req.user.orgId]);
    if (!changes) return res.status(404).json({ error: "Not found" });
    // STALE-2: a line that still names the event goes with it.
    await require("./attendanceLines").dropEventLines(req.user.orgId, req.params.id);
    res.json({ ok: true });
  }));

  for (const [path, on] of [["/events/:id/archive", true], ["/events/:id/unarchive", false]]) {
    app.post(path, requireAuth, checkWriteAccess, wrap(async (req, res) => {
      const rows = await query(`UPDATE events SET archived_at = ${on ? "COALESCE(archived_at, NOW())" : "NULL"} WHERE id = ? AND org_id = ? RETURNING id, name, archived_at`,
        [req.params.id, req.user.orgId]);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      // FLOWS-4 (W-1109-Volunteers-01X): an archived event's waiting drafts and open tasks are retired, "event archived".
      const retired = on ? await require("./missedYou").retireForArchive(req.user.orgId, rows[0].id) : { drafts: 0, tasks: 0 };
      const tail = retired.drafts || retired.tasks ? ` Its ${[retired.drafts && plural(retired.drafts, "waiting draft"), retired.tasks && plural(retired.tasks, "open task")].filter(Boolean).join(" and ")} ${retired.drafts + retired.tasks === 1 ? "is" : "are"} closed, noted "event archived".` : "";
      res.json({ ok: true, archivedAt: rows[0].archived_at, retired,
        message: on ? `${rows[0].name} is archived. Its gifts stay counted, and Archived on the Events list shows it.${tail}` : `${rows[0].name} is back on the Events list.` });
    }));
  }
  return {};
}

module.exports = { routers, mount, eventHolds };
