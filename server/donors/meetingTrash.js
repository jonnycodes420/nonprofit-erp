// server/donors/meetingTrash.js · INTEGRITY-2 (W-1108-Volunteers-17X). WHAT
// GOES WITH A DELETED MEETING, AND WHAT STAYS AS HISTORY.
//
// Deleting a meeting from a timeline left its notes, its Done tasks and the
// "How did it go" prompt behind, as if it still happened. Now, when the line
// deleted is a meeting (a logged calendar meeting, or a line of type meeting),
// in the delete's own transaction:
//   GOES  (derived from the meeting, nothing anyone did):
//     · its open tasks (prep, "How did it go with …?") are voided,
//     · the next step it opened is closed,
//     · the calendar meeting stops asking "How did it go" (dismissed).
//   STAYS (history: somebody did these):
//     · its Done tasks and the other notes about it, each labelled
//       "(from a deleted meeting)".
// All of it is kept on the trash row (row_data.__with.meeting), and Undo or
// Restore puts every piece back exactly as it was.
"use strict";

const LABEL = " (from a deleted meeting)";
const MEETING_TYPES = new Set(["meeting", "visit"]);

async function takeMeeting(db, c, interactionId, orgId) {
  const [ix] = await db.queryTx(c, `SELECT id, type, metadata FROM interactions WHERE id = ? AND org_id = ?`, [interactionId, orgId]);
  if (!ix) return null;
  const meta = typeof ix.metadata === "string" ? (() => { try { return JSON.parse(ix.metadata); } catch { return {}; } })() : (ix.metadata || {});
  const evIds = new Set();
  if (meta.calendar_event_id) evIds.add(String(meta.calendar_event_id));
  for (const e of await db.queryTx(c, `SELECT id FROM calendar_events WHERE interaction_id = ? AND org_id = ?`, [interactionId, orgId])) evIds.add(e.id);
  if (!evIds.size && !MEETING_TYPES.has(String(ix.type || ""))) return null;
  const ev = [...evIds];
  const out = { events: [], voided: [], threads: [], doneTasks: [], notes: [] };
  if (ev.length) {
    out.voided = (await db.queryTx(c, `UPDATE tasks SET voided_at = NOW(), voided_reason = 'meeting_deleted', updated_at = NOW()
                                        WHERE org_id = ? AND calendar_event_id = ANY(?) AND COALESCE(done, 0)::int = 0 AND voided_at IS NULL RETURNING id`, [orgId, ev])).map(r => r.id);
    out.events = (await db.queryTx(c, `UPDATE calendar_events SET dismissed_at = NOW(), updated_at = NOW()
                                        WHERE org_id = ? AND id = ANY(?) AND dismissed_at IS NULL RETURNING id`, [orgId, ev])).map(r => r.id);
    const done = await db.queryTx(c, `SELECT id, title FROM tasks WHERE org_id = ? AND calendar_event_id = ANY(?) AND COALESCE(done, 0)::int = 1 AND voided_at IS NULL`, [orgId, ev]);
    for (const t of done) {
      if (String(t.title || "").endsWith(LABEL)) continue;
      await db.runTx(c, `UPDATE tasks SET title = ?, updated_at = NOW() WHERE id = ? AND org_id = ?`, [String(t.title || "") + LABEL, t.id, orgId]);
      out.doneTasks.push({ id: t.id, title: t.title });
    }
    const notes = await db.queryTx(c, `SELECT id, note FROM interactions WHERE org_id = ? AND id <> ? AND metadata ->> 'calendar_event_id' = ANY(?)`, [orgId, interactionId, ev]);
    for (const n of notes) {
      if (String(n.note || "").endsWith(LABEL)) continue;
      await db.runTx(c, `UPDATE interactions SET note = ?, metadata = COALESCE(metadata, '{}'::jsonb) || '{"from_deleted_meeting": true}'::jsonb WHERE id = ? AND org_id = ?`,
        [String(n.note || "") + LABEL, n.id, orgId]);
      out.notes.push({ id: n.id, note: n.note });
    }
  }
  out.threads = (await db.queryTx(c, `UPDATE threads SET closed_at = NOW(), close_kind = 'dismissed', close_reason = 'meeting_deleted'
                                       WHERE org_id = ? AND opening_interaction_id = ? AND closed_at IS NULL RETURNING id`, [orgId, interactionId])).map(r => r.id);
  return out;
}

async function giveMeeting(db, c, m, orgId) {
  if (!m) return;
  if ((m.voided || []).length) await db.runTx(c, `UPDATE tasks SET voided_at = NULL, voided_reason = NULL, updated_at = NOW() WHERE org_id = ? AND id = ANY(?) AND voided_reason = 'meeting_deleted'`, [orgId, m.voided]);
  if ((m.events || []).length) await db.runTx(c, `UPDATE calendar_events SET dismissed_at = NULL, updated_at = NOW() WHERE org_id = ? AND id = ANY(?)`, [orgId, m.events]);
  if ((m.threads || []).length) await db.runTx(c, `UPDATE threads SET closed_at = NULL, close_kind = NULL, close_reason = NULL WHERE org_id = ? AND id = ANY(?) AND close_reason = 'meeting_deleted'`, [orgId, m.threads]);
  for (const t of m.doneTasks || []) await db.runTx(c, `UPDATE tasks SET title = ?, updated_at = NOW() WHERE id = ? AND org_id = ?`, [t.title, t.id, orgId]);
  for (const n of m.notes || []) await db.runTx(c, `UPDATE interactions SET note = ?, metadata = metadata - 'from_deleted_meeting' WHERE id = ? AND org_id = ?`, [n.note, n.id, orgId]);
}

module.exports = { takeMeeting, giveMeeting, LABEL };
