// personTrash.js · HARDEN-2 item 4. A PERSON WHO COMES BACK CLOSES THEIR
// DELETION RECORD, WHICHEVER DOOR BROUGHT THEM.
//
// A person's delete is soft (donors.deleted_at) and leaves a trash row in
// deleted_records (table_name 'donors', record_id = the person). That row is
// OPEN while restored_at IS NULL. A person counts as deleted if EITHER
// deleted_at is set OR an open trash row names them, so a live person with an
// open trash row reads as "a deleted person on the Donors list"
// (scripts/ops/stale-deletions-readonly.sql counts them).
//
// Every door that clears deleted_at goes through bringPeopleBack: the Undo
// (POST /deleted-records/:id/restore), the bulk Undo (POST
// /deleted-records/restore-people) and an import's Bring them back (POST
// /sheet-import/bring-back). It clears deleted_at and closes EVERY open trash
// row for the people it brought back, not only the one the Undo named, in the
// same transaction. (Before HARDEN-2 the Undo closed only its own row, so a
// person with an older open row, left by a path that never closed it, stayed
// "deleted" after a perfectly good Undo.)
//
// A person whose id is taken again by a new row (Load sample data reuses its
// ids after Clear) has their open trash rows closed by the trigger in db.js
// (steward_person_row_forgets_trash), whichever door did it. A row that is
// gone for good is never live, so its record is left as it is.
//
// STALE_DELETIONS_SQL is the read-only count by org, the same definition as
// scripts/ops/stale-deletions-readonly.sql, used by scripts/ci/close-stale-deletions.js and the FIX-54 suite.
"use strict";

// The people who are live (deleted_at IS NULL) and still named by an open
// deletion record, per org.
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
    // INTEGRITY-2: the links their delete took (server/donors/personLinks.js)
    // come back from the open trash rows about to close.
    if (back.length) {
      const open = await db.queryTx(c,
        `SELECT record_id, row_data -> '__links' AS links FROM deleted_records
          WHERE org_id = ? AND table_name = 'donors' AND record_id = ANY(?) AND restored_at IS NULL AND (row_data -> '__links') IS NOT NULL`,
        [orgId, back.map(r => r.id)]);
      if (open.length) await require("./server/donors/personLinks").giveLinks(db, c, orgId,
        open.map(o => ({ personId: o.record_id, links: typeof o.links === "string" ? JSON.parse(o.links) : o.links })));
    }
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

// INTEGRITY-2 · THE ONE DOOR OUT. Every way a person goes to the trash (the
// profile's Delete, the Donors list's Move to trash, an import undo, Undo's
// "Move them too") goes through here: deleted_at, one trash row each with
// who, when and why (row_data.__why, read by the Trash list), and their
// links (personLinks.takeLinks) kept on that row so Restore brings them back.
//   why: { kind: "delete" | "bulk_delete" | "import_undo" | "undo_moved_too", importId?, fileName? }
// Returns [{ id, undoId }] for the people who were live and are now in the trash.
async function trashPeople(orgId, ids, who, { client = null, why = { kind: "delete" }, extra = {} } = {}) {
  const db = require("./db");
  const { newId } = require("./server/shared/newId");
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return [];
  const go = async c => {
    const gone = await db.queryTx(c, "UPDATE donors SET deleted_at = NOW() WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL RETURNING id", [orgId, list]);
    if (!gone.length) return [];
    const links = await require("./server/donors/personLinks").takeLinks(db, c, orgId, gone.map(g => g.id));
    const out = gone.map(g => ({ id: g.id, undoId: newId("del") }));
    for (let k = 0; k < out.length; k += 500) {
      const b = out.slice(k, k + 500);
      await db.runTx(c, `INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
                         VALUES ${b.map(() => "(?, ?, 'donors', ?, ?::jsonb, ?, ?)").join(",")}`,
        b.flatMap(g => {
          const l = links.get(g.id);
          const data = { __soft: true, __why: why, ...extra, ...(require("./server/donors/personLinks").hasLinks(l) ? { __links: l } : {}) };
          return [g.undoId, orgId, g.id, JSON.stringify(data), (who && who.id) || "system:trash", (who && who.name) || "Steward"];
        }));
    }
    return out;
  };
  return client ? go(client) : db.withTransaction(go);
}

module.exports = { bringPeopleBack, trashPeople, STALE_DELETIONS_SQL, STALE_RECORDS_SQL };
