// server/volunteers/statusChanges.js · POLISH-11 item 2. A VOLUNTEER STATUS CHANGE IN RECENT CHANGES.
//
// "Mark as former… showed an Undo banner… after navigating to Volunteers to verify the count, the
// Undo banner was gone" (fleet, 25 Nov). The change she made is listed in Recent changes with its
// Undo for the day the record keeps it (volunteerRecord.js STATUS_UNDO_HOURS), as UNDO-1's rows are.
// A read; it writes nothing.
"use strict";
const VR = require("./volunteerRecord");

async function recentRows(query, orgId, userId) {
  const rows = await query(`SELECT r.person_id, r.status, r.prev_status, r.status_changed_at, d.name
                              FROM volunteer_records r JOIN donors d ON d.id = r.person_id AND d.org_id = r.org_id AND d.deleted_at IS NULL
                             WHERE r.org_id = ? AND r.status_by = ? AND r.prev_status IS NOT NULL
                               AND r.status_changed_at > NOW() - (? || ' hours')::interval
                             ORDER BY r.status_changed_at DESC LIMIT 50`, [orgId, userId, String(VR.STATUS_UNDO_HOURS)]).catch(e => {
    if (e && (e.code === "42703" || e.code === "42P01")) return [];
    throw e;
  });
  const word = { active: "active", paused: "paused", former: "a former volunteer" };
  return rows.map(r => ({
    id: "vstatus:" + r.person_id, kind: "volunteer_status",
    sentence: r.status === "former" ? `Marked ${r.name} as a former volunteer.` : `Marked ${r.name} ${word[r.status] || r.status}.`,
    at: r.status_changed_at,
    until: new Date(new Date(r.status_changed_at).getTime() + VR.STATUS_UNDO_HOURS * 3600e3).toISOString(),
    undo: { method: "POST", path: `/donors/${encodeURIComponent(r.person_id)}/volunteer-status/undo` },
  }));
}

module.exports = { recentRows };
