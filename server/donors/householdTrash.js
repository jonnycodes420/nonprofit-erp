// server/donors/householdTrash.js · SAFE-EDIT-1 item 3 (Duet m15). A HOUSEHOLD GOES WITH ITS
// LAST MEMBER, AND COMES BACK WITH THEM.
//
// A person's delete takes their household membership with them (personLinks.takeLinks), so
// when every member was in the trash the household stayed behind with nobody in it: listed
// with 0 members, its Top 100 place kept, its name offered in pickers. Now:
//   · emptied()   inside the delete's transaction, any household those people belonged to
//                 that has no live member left goes to the trash too (one deleted_records
//                 row, table 'households', the row as it was plus __with.member_ids and
//                 __emptied: true), the same row FIX-14's Delete household writes, so Recent
//                 changes and Undo read it the same way.
//   · bringBack() inside a restore's transaction (personTrash.bringPeopleBack, every door
//                 back), before the links are given back: a household that was emptied this
//                 way, and is named by a returning person's own trash row, is put back first,
//                 so giveLinks re-links them to it. A household somebody deleted by hand
//                 stays deleted (only __emptied rows come back this way).
// `db` is the db module (queryTx / runTx), `c` the caller's transaction client.
"use strict";

async function emptied(db, c, orgId, householdIds, who) {
  const ids = [...new Set((householdIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const empty = await db.queryTx(c,
    `SELECT h.id FROM households h
      WHERE h.org_id = ? AND h.id = ANY(?)
        AND NOT EXISTS (SELECT 1 FROM donors d WHERE d.org_id = h.org_id AND d.household_id = h.id AND d.deleted_at IS NULL)`,
    [orgId, ids]);
  if (!empty.length) return [];
  const { newId } = require("../shared/newId");
  const out = [];
  for (const h of empty) {
    // the people who were in it: the trash rows' own links name them (takeLinks wrote them a moment ago)
    const trashId = newId("del");
    await db.runTx(c,
      `INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
       SELECT ?, ?, 'households', h.id, to_jsonb(h) || jsonb_build_object('__emptied', true), ?, ? FROM households h WHERE h.id = ? AND h.org_id = ?`,
      [trashId, orgId, (who && who.id) || "system:trash", (who && who.name) || "Steward", h.id, orgId]);
    await db.runTx(c, `DELETE FROM households WHERE id = ? AND org_id = ?`, [h.id, orgId]);
    out.push({ id: h.id, trashId });
  }
  return out;
}

async function bringBack(db, c, orgId, householdIds) {
  const ids = [...new Set((householdIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const rows = await db.queryTx(c,
    `SELECT r.id, r.record_id, r.row_data FROM deleted_records r
      WHERE r.org_id = ? AND r.table_name = 'households' AND r.record_id = ANY(?) AND r.restored_at IS NULL
        AND (r.row_data ->> '__emptied') = 'true'
        AND NOT EXISTS (SELECT 1 FROM households h WHERE h.id = r.record_id)
      ORDER BY r.created_at DESC`, [orgId, ids]);
  const back = [];
  for (const r of rows) {
    if (back.includes(r.record_id)) continue;
    const data = typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data;
    await db.runTx(c, `INSERT INTO households SELECT * FROM jsonb_populate_record(NULL::households, ?::jsonb)`, [JSON.stringify(data)]);
    await db.runTx(c, `UPDATE deleted_records SET restored_at = NOW() WHERE id = ?`, [r.id]);
    back.push(r.record_id);
  }
  return back;
}

module.exports = { emptied, bringBack };
