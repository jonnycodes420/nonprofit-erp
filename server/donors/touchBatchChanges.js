// server/donors/touchBatchChanges.js · FLOWS-20 (W-1120-Donors-T20).
// A BULK TOUCH IS ONE LINE IN RECENT CHANGES, WITH THE UNDO THE TOAST CALLS.
//
// EDIT-2 logged a touch to many people as one batch and undid it as one, but only from the toast:
// Recent changes is read from the seams that undo things (routes/removal.js), and a batch was not
// one of them, so once the toast was gone the batch could only be taken back person by person.
// Each batch this person logged in the last 30 days and has not undone is one row here, read from
// touch_batches (nothing new is recorded), and its Undo is POST /touch-batches/:id/undo.
"use strict";

const LIST_DAYS = 30;
const peopleWords = n => `${Number(n).toLocaleString("en-US")} ${Number(n) === 1 ? "person" : "people"}`;
const batchSentence = b => `Logged "${b.title}" to ${peopleWords(b.people)}.`;

async function recentBatchRows(query, orgId, userId) {
  const rows = await query(
    `SELECT id, title, people, created_at FROM touch_batches
      WHERE org_id = ? AND created_by = ? AND undone_at IS NULL AND created_at > NOW() - INTERVAL '${LIST_DAYS} days'
      ORDER BY created_at DESC LIMIT 50`, [orgId, userId]);
  return rows.map(b => ({
    id: "batch:" + b.id, kind: "touch_batch", sentence: batchSentence(b), at: b.created_at,
    until: new Date(new Date(b.created_at).getTime() + LIST_DAYS * 864e5).toISOString(),
    undo: { method: "POST", path: `/touch-batches/${encodeURIComponent(b.id)}/undo`, body: {} },
  }));
}

module.exports = { recentBatchRows, batchSentence, LIST_DAYS };
