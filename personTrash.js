// personTrash.js · HARDEN-2 item 4. A PERSON WHO COMES BACK CLOSES THEIR
// DELETION RECORD, WHICHEVER DOOR BROUGHT THEM.
//
// A person's delete is soft (donors.deleted_at) and leaves a trash row in
// deleted_records (table_name 'donors', record_id = the person). That row is
// OPEN while restored_at IS NULL. The nightly check (nightlyCheck.js, check a,
// deletedAmong) counts a person as deleted if EITHER deleted_at is set OR an
// open trash row names them, so a live person with an open trash row reads as
// "a deleted person on the Donors list".
//
// Every door that clears deleted_at goes through bringPeopleBack: the Undo
// (POST /deleted-records/:id/restore), the bulk Undo (POST
// /deleted-records/restore-people) and an import's Bring them back (POST
// /sheet-import/bring-back). It clears deleted_at and closes EVERY open trash
// row for the people it brought back, not only the one the Undo named, in the
// same transaction. (Before HARDEN-2 the Undo closed only its own row, so a
// person with an older open row, left by a path that never closed it, stayed
// "deleted" to the nightly check after a perfectly good Undo.)
//
// A person whose row is hard-deleted (purge, Clear sample data, an import's
// Undo, an org's deletion) or whose id is taken again by a new row (Load
// sample data reuses its ids) has their open trash rows dropped by the
// trigger in db.js (steward_person_row_forgets_trash), whichever door did it.
//
// STALE_DELETIONS_SQL is the read-only count by org, the same definition as
// check a, used by scripts/close-stale-deletions.js and the FIX-54 suite.
"use strict";

// The people who are live (deleted_at IS NULL) and still named by an open
// deletion record, per org: exactly check a's "deleted" side of deletedAmong.
// $1 = an org id, or NULL for every org.
const STALE_DELETIONS_SQL = `
  SELECT d.org_id, COUNT(DISTINCT d.id)::int AS people
    FROM donors d
    JOIN deleted_records r ON r.org_id = d.org_id AND r.table_name = 'donors'
                          AND r.record_id = d.id AND r.restored_at IS NULL
   WHERE d.deleted_at IS NULL
     AND ($1::text IS NULL OR d.org_id = $1)
   GROUP BY d.org_id
   ORDER BY d.org_id`;

// The open records themselves, for one org: what the close script closes.
const STALE_RECORDS_SQL = `
  SELECT r.id, r.record_id, r.created_at
    FROM deleted_records r
    JOIN donors d ON d.org_id = r.org_id AND d.id = r.record_id AND d.deleted_at IS NULL
   WHERE r.org_id = $1 AND r.table_name = 'donors' AND r.restored_at IS NULL
   ORDER BY r.created_at, r.id`;

// Bring people back, and close every open deletion record of everyone who is
// back. `client` is the caller's transaction (db.withTransaction); without
// one, this opens its own, so the two writes land together or not at all.
//   exceptMerged: leave a record merged into another where it is (Bring them
//                 back: only someone deleted by hand comes back).
//   touch:        stamp updated_at (an import's Bring them back did).
// Returns the ids that were deleted and are now back.
async function bringPeopleBack(orgId, ids, { client = null, exceptMerged = false, touch = false } = {}) {
  const db = require("./db");
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return [];
  const go = async c => {
    const back = await db.queryTx(c,
      `UPDATE donors d SET deleted_at = NULL${touch ? ", updated_at = NOW()" : ""}
        WHERE d.org_id = ? AND d.id = ANY(?) AND d.deleted_at IS NOT NULL
        ${exceptMerged ? "AND NOT EXISTS (SELECT 1 FROM donor_merges m WHERE m.org_id = d.org_id AND m.merged_id = d.id AND m.undone_at IS NULL)" : ""}
        RETURNING d.id`, [orgId, list]);
    // Everyone named who is live now (just back, or back already by another
    // door): none of them may keep an open deletion record.
    await db.runTx(c,
      `UPDATE deleted_records r SET restored_at = NOW()
        WHERE r.org_id = ? AND r.table_name = 'donors' AND r.record_id = ANY(?) AND r.restored_at IS NULL
          AND EXISTS (SELECT 1 FROM donors d WHERE d.org_id = r.org_id AND d.id = r.record_id AND d.deleted_at IS NULL)`,
      [orgId, list]);
    return back.map(r => r.id);
  };
  return client ? go(client) : db.withTransaction(go);
}

module.exports = { bringPeopleBack, STALE_DELETIONS_SQL, STALE_RECORDS_SQL };
