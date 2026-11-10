// server/imports/undoMoves.js · INTEGRITY-3. AN IMPORT UNDO NEVER DESTROYS A
// PERSON.
//
// Fiona Callahan ($35,000, the demo org) was gone from every surface: not in
// the Trash, not in search, not in the Audit log. On a fixture the trail that
// destroys a person is this one: a person the import made (her gifts came with
// that file), later put in the trash and perhaps brought back and sent back
// again by other imports, is DELETED OUTRIGHT when that first import is
// undone. Undo removed the gifts the file wrote, found her with none left,
// and ran `DELETE FROM donors`, taking her trash rows with her (FIX-52), and
// wrote one row for the whole undo that named nobody.
//
// The rule now (no CRM undo ever destroys data it did not create, and a
// person is never destroyed by an undo at all):
//   · CREATED by the import and live: moved to the trash (restorable for 30
//     days) through the one door out (personTrash.trashPeople), never
//     hard-deleted. Already in the trash: left exactly where they are. (A
//     staged import's hidden, never-shown people are the one exception:
//     trashCreated says why.)
//   · RESTORED by the import (they were in the trash before it): back to the
//     trash on their ORIGINAL trash row (who deleted them, when and why), the
//     row reopened, deleted_at put back to when they went in. The bring-back
//     this run claimed is kept on that row as history (__bringBackUndone).
//   · Pre-existing and active: untouched (undoPeople.js; never on a list).
// A person leaves Steward for good only through Empty trash or the 30-day
// clear-out, and each writes one audit row per person.
//
// Every person an undo moves is one audit row: the person's id, the state they
// were in and the state they are in now. On the request, the middleware writes
// them (req.audit.perRecord, rowsFor); on the queue, the job writes them
// (writeRows), as every background job does.
"use strict";

const WHY = importId => ({ kind: "import_undo", importId });

// The people this run created that the undo takes (no activity since):
// [{ id, was_deleted, staged }]. Live ones go to the trash; the ones already in
// the trash stay where they are. Returns { moved: [{ id, from, to, how }],
// alreadyInTrash: [id], discarded: [{ id, from, to, how }] }.
//
// The one exception, ONBOARD-1's staged import: its people were hidden from
// the moment they were written and never shown to anyone (a preview waiting
// for Accept). They were never a record anybody saw, so undoing the preview
// discards them, as ONBOARD-1 decided ("nothing in the trash"), and putting
// them in the trash would make the same file, staged again, match them as
// deleted people. Each one is still an audit row (staged → discarded).
async function trashCreated(db, orgId, imp, people, who) {
  const staged = people.filter(p => p.staged).map(p => p.id);
  const live = people.filter(p => !p.was_deleted && !p.staged).map(p => p.id);
  const already = people.filter(p => p.was_deleted).map(p => p.id);
  const actor = who && who.id ? who : { id: "system:import-undo", name: "Steward (undo)" };
  const discarded = [];
  if (staged.length) {
    await db.run("DELETE FROM interactions WHERE org_id=? AND donor_id = ANY(?)", [orgId, staged]).catch(() => {});
    await db.run("DELETE FROM tasks WHERE org_id=? AND donor_id = ANY(?) AND COALESCE(created_by, '') LIKE 'system:%'", [orgId, staged]).catch(() => {});
    for (const id of staged) {
      try { await db.run("DELETE FROM donors WHERE org_id=? AND id=? AND staged_import_id=?", [orgId, id, imp.id]); discarded.push({ id, from: "staged", to: "discarded", how: "staged" }); }
      catch (e) { console.error("[imports] undo kept a staged person another record holds:", id, e.code || e.message); }
    }
  }
  const out = live.length ? await require("../../personTrash").trashPeople(orgId, live, actor,
    { why: WHY(imp.id), extra: { __importUndo: imp.id, __created: true } }) : [];
  return { moved: out.map(g => ({ id: g.id, from: "active", to: "trash", how: "created" })), alreadyInTrash: already, discarded };
}

// The people this run brought back from the trash, back on the trash row they
// came out of. `ids` are people the caller has checked (claimed by this run,
// no activity since). Returns [{ id, from, to, how }].
async function putBackRestored(db, orgId, imp, ids, who) {
  if (!ids.length) return [];
  const PL = require("../donors/personLinks");
  return db.withTransaction(async c => {
    // the newest row of each that this run's bring-back closed
    const rows = await db.queryTx(c,
      `SELECT DISTINCT ON (record_id) id, record_id, created_at, row_data
         FROM deleted_records WHERE org_id = ? AND table_name = 'donors' AND record_id = ANY(?)
          AND restored_at IS NOT NULL AND (row_data -> '__bringBack' ->> 'importId') = ?
        ORDER BY record_id, restored_at DESC, created_at DESC`, [orgId, ids, imp.id]);
    const back = [];
    for (const r of rows) {
      const [d] = await db.queryTx(c, `UPDATE donors SET deleted_at = ? WHERE org_id = ? AND id = ? AND deleted_at IS NULL RETURNING id`,
        [r.created_at, orgId, r.record_id]);
      if (d) back.push(r);
    }
    if (!back.length) return [];
    // what their delete took the first time, taken again (it came back with them)
    const links = await PL.takeLinks(db, c, orgId, back.map(r => r.record_id));
    const at = new Date().toISOString();
    for (const r of back) {
      const data = typeof r.row_data === "string" ? JSON.parse(r.row_data) : (r.row_data || {});
      const l = links.get(r.record_id);
      const patch = { __bringBackUndone: [...(Array.isArray(data.__bringBackUndone) ? data.__bringBackUndone : []),
        { ...(data.__bringBack || {}), undoneAt: at, undoneBy: (who && who.id) || "system:import-undo" }] };
      if (PL.hasLinks(l)) patch.__links = l;
      await db.runTx(c, `UPDATE deleted_records SET restored_at = NULL, row_data = (row_data - '__bringBack' - '__links') || ?::jsonb
                          WHERE org_id = ? AND id = ?`, [JSON.stringify(patch), orgId, r.id]);
    }
    return back.map(r => ({ id: r.record_id, from: "active", to: "trash", how: "restored" }));
  });
}

const SAID = { staged: "a staged import's preview, never shown", created: "this import created", restored: "this import brought back from the trash", moved_too: "this import created or restored, moved with the undo as chosen" };
const summaryOf = (m, importId) => `Import undo ${importId}: moved from ${m.from} to ${m.to} (${SAID[m.how] || m.how})`;

// For req.audit.perRecord: one row for the undo itself, then one per person.
function rowsFor(importId, moved) {
  return [{ entityType: "import", entityId: importId, label: "Import undo", action: "undid" },
    ...moved.map(m => ({ entityType: "donor", entityId: m.id, action: m.to === "trash" ? "moved to trash" : m.to, before: { state: m.from }, after: { state: m.to },
      summary: summaryOf(m, importId) }))];
}

// On the queue: the same rows, written by the job (as the person who pressed Undo).
async function writeRows(orgId, who, importId, moved) {
  if (!moved.length) return 0;
  const user = who && who.id && !String(who.id).startsWith("system:");
  return require("../../middleware/auditTrail").insertAuditRows(moved.map(m => ({
    orgId, actorId: (who && who.id) || "system:import-undo", actorName: (who && who.name) || "Steward (undo)", actorKind: user ? "user" : "system",
    action: m.to === "trash" ? "moved to trash" : m.to, entityType: "donor", entityId: m.id, entityLabel: null,
    changes: { state: { before: m.from, after: m.to } }, before: { state: m.from }, after: { state: m.to },
    summary: summaryOf(m, importId), recordCount: 1, method: "JOB", path: `importUndo:${importId}`, status: 200 })));
}

module.exports = { trashCreated, putBackRestored, rowsFor, writeRows };
