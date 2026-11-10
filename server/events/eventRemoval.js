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
const express = require("express");

const routers = { r1: express.Router() };

// What an event holds that a delete would orphan. One query.
async function eventHolds(query, orgId, id) {
  const [h] = await query(
    `SELECT (SELECT COUNT(*)::int FROM gifts g WHERE g.org_id = e.org_id AND g.event_id = e.id) AS gifts,
            (SELECT COUNT(*)::int FROM pledges p WHERE p.org_id = e.org_id AND p.event_id = e.id) AS pledges,
            (SELECT COUNT(*)::int FROM event_attendees a WHERE a.org_id = e.org_id AND a.event_id = e.id) AS guests
       FROM events e WHERE e.id = ? AND e.org_id = ?`, [id, orgId]);
  return h || null;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function holdsWords(h) {
  return [h.gifts && plural(h.gifts, "gift"), h.pledges && plural(h.pledges, "pledge"), h.guests && plural(h.guests, "guest")].filter(Boolean).join(", ");
}

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap } = ctx;
  const app = routers.r1;

  // What the detail page needs to offer Delete or Archive.
  app.get("/events/:id/removal", requireAuth, wrap(async (req, res) => {
    const h = await eventHolds(query, req.user.orgId, req.params.id);
    if (!h) return res.status(404).json({ error: "Not found" });
    const held = h.gifts + h.pledges + h.guests > 0;
    res.json({ canDelete: !held, holds: h,
      sentence: held ? `This event has ${holdsWords(h)}, so it can be archived but not deleted. Archiving keeps every gift counted.`
                     : "This event has no gifts and no guests, so it can be deleted." });
  }));

  // BUILD-75 B: a foreign or unknown id answers 404, never a false success.
  app.delete("/events/:id", requireAuth, wrap(async (req, res) => {
    const h = await eventHolds(query, req.user.orgId, req.params.id);
    if (!h) return res.status(404).json({ error: "Not found" });
    if (h.gifts + h.pledges + h.guests > 0) {
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
