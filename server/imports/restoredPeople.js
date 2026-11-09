// server/imports/restoredPeople.js · IMPORT-9. UNDO PUTS BACK THE PEOPLE AN
// IMPORT BROUGHT BACK FROM THE TRASH.
//
// Muse's Walk B (5 Nov): a 1,000-row file was imported and undone, its people
// removed to the trash, and the file imported again. The second preview
// matched the 199 people in the trash and "Bring them all back" restored them.
// Undoing that second import removed its gifts but left all 199 live at $0
// lifetime: the undo knew only the people the file CREATED
// (donors.created_import_id) and the fields it changed on people already
// here (personChanges). Who the import had brought back from the trash was
// written nowhere, so nothing could put them back.
//
// Now the three steps leave a trail, and Undo follows it:
//   1. markBroughtBack: POST /sheet-import/bring-back stamps each trash row it
//      closed (deleted_records.row_data.__bringBack: when, by whom).
//   2. claimForImport: the import's write takes the stamped rows of the people
//      it matched (closed in the last day and not yet claimed), names its run
//      on them (__bringBack.importId), and lists them in the run's summary
//      (summary_json.restoredFromTrash). A failed write rolls the claim back
//      with everything else.
//   3. sendBackToTrash: Undo puts each one back in the trash, with a trash row
//      of its own (the ordinary soft delete, so the Undo toast, Recent changes
//      and a later "Bring them back" all see them), unless something was
//      added to them since the import (a gift, a note, a call, a task): then
//      they stay and the sentence names them, as IMPORT-8's created people do.
// No schema change: the trail is in the trash rows the doors already write.
//
// INTEGRITY-1 · AN UNDO REMOVES ONLY WHAT ITS OWN IMPORT CREATED OR RESTORED.
// On 7 Nov a donor with $11,700 lifetime vanished from the Donors list while
// another area's 1,000-row import was undone. A bring-back stamp named no
// file: ANY import in the next 24 hours that matched the person claimed it,
// so a person brought back for one file (or brought back and never imported)
// was claimed by a different file, and that file's Undo trashed someone who
// was live and in use before it ran. Now the stamp carries the file it was
// pressed for (the preview's fileKey, the cells' fingerprint), only an
// import of that same file claims it, and Undo trashes a person only when
// their trash row names this run (re-read from the trash rows, never trusted
// from the summary alone).
//
// INTEGRITY-2 (W-1107-Finance-35 again, 8 Nov): Fiona Callahan ($35,000)
// went to the trash in a Finance import undo she was not part of. The fleet
// imports the same fixture files from several areas, so two areas' files
// have the same fingerprint: a "Bring them back" one area pressed in its
// preview was claimed by ANOTHER area's import of the same file, whose Undo
// then trashed her. A bring-back belongs to the person who pressed it: the
// claim now needs the stamp's `by` to be the importer as well as the file.
// And the trash row Undo writes says why (__why: import undo, which import),
// through the one door out (personTrash.trashPeople), so the Trash list reads
// "Import undo of <file>, 8 Nov" and Restore brings back what went with them.
"use strict";

const CLAIM_HOURS = 24;

async function markBroughtBack(db, orgId, ids, who, fileKey) {
  if (!ids.length) return 0;
  const file = typeof fileKey === "string" && /^[0-9a-f]{8,64}$/.test(fileKey) ? fileKey : null;
  const stamp = JSON.stringify({ __bringBack: { at: new Date().toISOString(), by: (who && who.id) || null, file } });
  const r = await db.query(
    `UPDATE deleted_records SET row_data = row_data || ?::jsonb
      WHERE org_id=? AND table_name='donors' AND record_id = ANY(?) AND restored_at IS NOT NULL
        AND restored_at > NOW() - INTERVAL '10 minutes' AND (row_data -> '__bringBack') IS NULL
      RETURNING id`, [stamp, orgId, ids]);
  return r.length;
}

// Inside the import's write (its ambient transaction). Returns the ids.
// INTEGRITY-1: only a stamp pressed for this same file (its fingerprint).
async function claimForImport(db, orgId, matchedIds, importId, fileKey, byId) {
  const ids = [...new Set(matchedIds)];
  if (!ids.length || !fileKey || !byId) return [];
  const rows = await db.query(
    `UPDATE deleted_records r SET row_data = jsonb_set(r.row_data, '{__bringBack,importId}', to_jsonb(?::text))
      WHERE r.org_id=? AND r.table_name='donors' AND r.record_id = ANY(?) AND r.restored_at IS NOT NULL
        AND r.restored_at > NOW() - (? * INTERVAL '1 hour')
        AND (r.row_data -> '__bringBack') IS NOT NULL AND (r.row_data -> '__bringBack' -> 'importId') IS NULL
        AND (r.row_data -> '__bringBack' ->> 'file') = ?
        AND (r.row_data -> '__bringBack' ->> 'by') = ?
        AND EXISTS (SELECT 1 FROM donors d WHERE d.org_id = r.org_id AND d.id = r.record_id AND d.deleted_at IS NULL)
      RETURNING r.record_id`, [importId, orgId, ids, CLAIM_HOURS, fileKey, String(byId)]);
  return [...new Set(rows.map(r => r.record_id))];
}

// What was added to a person after the import (not by it). One query for all.
async function activitySince(db, orgId, ids, importId, since) {
  if (!ids.length) return new Map();
  const rows = await db.query(
    `SELECT d.id, d.name,
            (SELECT COUNT(*) FROM gifts g WHERE g.org_id=d.org_id AND g.donor_id=d.id AND g.created_at > ?::timestamptz
               AND g.import_id IS DISTINCT FROM ?)::int AS gifts,
            (SELECT COUNT(*) FROM interactions i WHERE i.org_id=d.org_id AND i.donor_id=d.id AND i.created_at > ?::timestamptz
               AND i.import_id IS DISTINCT FROM ? AND i.type='note')::int AS notes,
            (SELECT COUNT(*) FROM interactions i WHERE i.org_id=d.org_id AND i.donor_id=d.id AND i.created_at > ?::timestamptz
               AND i.import_id IS DISTINCT FROM ? AND i.type='call')::int AS calls,
            (SELECT COUNT(*) FROM tasks t WHERE t.org_id=d.org_id AND t.donor_id=d.id AND t.created_at > ?::timestamptz
               AND t.import_id IS DISTINCT FROM ? AND t.created_by IS DISTINCT FROM ?)::int AS tasks
       FROM donors d WHERE d.org_id=? AND d.id = ANY(?) AND d.deleted_at IS NULL`,
    [since, importId, since, importId, since, importId, since, importId, `system:data-health/import/${importId}`, orgId, ids]);
  return new Map(rows.map(r => [r.id, r]));
}

// Undo's step. Returns { trashed: [id], stayed: [{ id, name, why }] }.
async function sendBackToTrash(db, orgId, imp, sj, who) {
  const listed = [...new Set((sj && sj.restoredFromTrash) || [])];
  if (!listed.length) return { trashed: [], stayed: [] };
  // INTEGRITY-1: the trash rows are the proof. A person goes back only when a
  // trash row of theirs was closed by a bring-back this very run claimed.
  const ids = (await db.query(
    `SELECT DISTINCT record_id FROM deleted_records WHERE org_id=? AND table_name='donors' AND record_id = ANY(?)
        AND restored_at IS NOT NULL AND (row_data -> '__bringBack' ->> 'importId') = ?`, [orgId, listed, imp.id])).map(r => r.record_id);
  if (!ids.length) return { trashed: [], stayed: [] };
  const live = await activitySince(db, orgId, ids, imp.id, imp.committed_at || imp.created_at);
  const stayed = [], go = [];
  for (const id of ids) {
    const r = live.get(id);
    if (!r) continue;   // already deleted again, or gone
    const why = [r.gifts && (r.gifts === 1 ? "a gift" : `${r.gifts} gifts`), r.notes && (r.notes === 1 ? "a note" : `${r.notes} notes`),
      r.calls && (r.calls === 1 ? "a call" : `${r.calls} calls`), r.tasks && (r.tasks === 1 ? "a task" : `${r.tasks} tasks`)].filter(Boolean);
    if (why.length) stayed.push({ id, name: r.name, why: why.join(", "), restored: true });
    else go.push(id);
  }
  // INTEGRITY-2: the one door out, with why; their links go with them and come back with Restore
  const trashed = (await require("../../personTrash").trashPeople(orgId, go, who && who.id ? who : { id: "system:import-undo", name: "Steward (undo)" },
    { why: { kind: "import_undo", importId: imp.id }, extra: { __importUndo: imp.id } })).map(g => g.id);
  return { trashed, stayed };
}

module.exports = { markBroughtBack, claimForImport, sendBackToTrash, CLAIM_HOURS };
