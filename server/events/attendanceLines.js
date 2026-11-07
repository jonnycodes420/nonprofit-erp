// server/events/attendanceLines.js · STALE-2 item 2. A GUEST'S TIMELINE LINES
// ARE THE GUEST ROW, AS IT STANDS NOW.
//
// W-1107-Volunteers-21 (QA fleet, 7 Nov): changing a guest from Attended to
// No Show left "Came to X." on their profile, and removing the guests and
// then the event left "Registered for" and "Came to" on three profiles. The
// lines were written once (WIRE-1's logEventRegistered and
// logEventAttendance) and never looked at again.
//
// The rule, the way established CRMs keep an event's history (the
// attendance record is the source; the activity follows it):
//   · a status change rewrites the attendance line to say what is true now,
//     or takes it away when the guest is no longer marked as come or not come
//     (and clears the claim stamp, so marking them again writes it afresh);
//   · removing a guest takes their lines with them into the trash, and the
//     guest's Undo puts both back (TRASH_WITH / RESTORE_WITH, and the bulk
//     Remove's WITH in routes/removal.js);
//   · deleting an event takes any line still naming it.
// A line is the event's when its metadata says via event_registration or
// event_attendance and names the attendee (and the event).
"use strict";
const { query, run, queryTx, runTx } = require("../db/query");

const VIAS = ["event_registration", "event_attendance"];
const NOTE = { attended: name => `Came to ${name}.`, no_show: name => `Registered for ${name} and did not come.` };

// The lines a guest row wrote, taken out inside the caller's transaction.
// Returns what the Undo needs (the whole rows), or null when there were none.
async function takeLines(client, attendeeId, orgId) {
  const rows = await queryTx(client,
    `DELETE FROM interactions WHERE org_id = ? AND metadata->>'attendee_id' = ? AND metadata->>'via' = ANY(?::text[]) RETURNING *`,
    [orgId, String(attendeeId), VIAS]);
  return rows.length ? { interactions: rows } : null;
}
async function giveLines(client, w) {
  if (!w || !Array.isArray(w.interactions) || !w.interactions.length) return;
  await runTx(client, `INSERT INTO interactions SELECT * FROM jsonb_populate_recordset(NULL::interactions, ?::jsonb) ON CONFLICT DO NOTHING`,
    [JSON.stringify(w.interactions)]);
}

// After a guest's status changed: the attendance line says the status now.
async function syncAttendanceLine(orgId, attendeeId) {
  const [a] = await query(`SELECT a.id, a.status, e.name AS event_name FROM event_attendees a JOIN events e ON e.id = a.event_id AND e.org_id = a.org_id
                            WHERE a.id = ? AND a.org_id = ?`, [attendeeId, orgId]);
  if (!a) return;
  const status = String(a.status || "").toLowerCase();
  if (NOTE[status]) {
    await run(`UPDATE interactions SET note = ?, metadata = jsonb_set(metadata, '{status}', to_jsonb(?::text))
                WHERE org_id = ? AND metadata->>'attendee_id' = ? AND metadata->>'via' = 'event_attendance'
                  AND (note IS DISTINCT FROM ? OR metadata->>'status' IS DISTINCT FROM ?)`,
      [NOTE[status](a.event_name), status, orgId, String(a.id), NOTE[status](a.event_name), status]);
    return;
  }
  await run(`DELETE FROM interactions WHERE org_id = ? AND metadata->>'attendee_id' = ? AND metadata->>'via' = 'event_attendance'`, [orgId, String(a.id)]);
  await run(`UPDATE event_attendees SET attendance_logged_at = NULL WHERE id = ? AND org_id = ?`, [a.id, orgId]);
}

// An event deleted: whatever line still names it goes too.
async function dropEventLines(orgId, eventId) {
  return run(`DELETE FROM interactions WHERE org_id = ? AND metadata->>'event_id' = ? AND metadata->>'via' = ANY(?::text[])`,
    [orgId, String(eventId), VIAS]);
}

// THE ORPHANS: an event line whose guest row is gone (not in the table, and
// not waiting in the trash to come back). scripts/ops/event-line-orphans.js
// counts them per org and, with --apply, removes them.
const ORPHANS_WHERE = `i.metadata->>'via' = ANY(ARRAY['event_registration','event_attendance'])
  AND NOT EXISTS (SELECT 1 FROM event_attendees a WHERE a.id = i.metadata->>'attendee_id' AND a.org_id = i.org_id)
  AND NOT EXISTS (SELECT 1 FROM deleted_records r WHERE r.org_id = i.org_id AND r.table_name = 'event_attendees' AND r.record_id = i.metadata->>'attendee_id')`;

module.exports = { VIAS, takeLines, giveLines, syncAttendanceLine, dropEventLines, ORPHANS_WHERE };
