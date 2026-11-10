// tests/lib/undoTrashed.js · INTEGRITY-3. WHO AN UNDO PUT IN THE TRASH.
//
// An import's undo used to delete the people its file created outright; now
// it moves them to the trash (restorable for 30 days), with a trash row that
// says the undone file created them (row_data.__created). A suite that checks
// "the org is exactly as before the import" compares the LIVE org: these
// people, and the rows that wait in the trash with them, are left out.
"use strict";

async function undoTrashed(q, org) {
  const rows = await q(`SELECT d.id FROM donors d WHERE d.org_id=$1 AND d.deleted_at IS NOT NULL
                          AND EXISTS (SELECT 1 FROM deleted_records r WHERE r.org_id=d.org_id AND r.table_name='donors' AND r.record_id=d.id
                                        AND r.restored_at IS NULL AND (r.row_data ->> '__created') = 'true')`, [org]);
  return new Set(rows.map(r => r.id));
}
// keep a row of table t unless it is one of them, or theirs
const notUndoTrashed = (set, t) => r => (t === "donors" ? !set.has(r.id) : !(r.donor_id && set.has(r.donor_id)));

module.exports = { undoTrashed, notUndoTrashed };
