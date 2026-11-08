#!/usr/bin/env node
// INTEGRITY-1 · PEOPLE AN IMPORT'S UNDO TRASHED WHO WERE HERE BEFORE THAT IMPORT.
//
// Before INTEGRITY-1, a "Bring them back" stamp named no file, so any
// spreadsheet import in the next 24 hours that matched the person claimed it,
// and that import's Undo put them in the trash (server/imports/restoredPeople.js).
// A person brought back for one file, or brought back and never imported, was
// live and in use when a DIFFERENT file was imported and undone, and vanished
// from the Donors list (W-1107-Finance-35, 7 Nov: a $11,700 donor).
//
// A person is listed when ALL of these hold:
//   · an import's Undo put them in the trash (deleted_records.row_data.__importUndo),
//     that trash row is still open, and they are still deleted;
//   · the bring-back that import claimed for them was not pressed for it: its
//     stamp names another file, or (a stamp from before INTEGRITY-1, with no
//     file) it was pressed by someone other than the person who ran the
//     import, or more than 15 minutes before that import started;
//   · nobody has deleted them by hand since (no later open trash row).
// Only org ids and counts are printed, never names.
//
// DRY RUN BY DEFAULT. --apply brings each one back (deleted_at cleared, the
// undo's trash row closed), one transaction and ONE audit row per org (actor
// system:scripts/ops/integrity1-find-vanished) naming the people and the trash
// rows. --undo=<audit id> puts that run's people back in the trash exactly
// (reopens those trash rows) with its own audit row. A second run of either
// changes nothing.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/integrity1-find-vanished.js               # dry run, every org
//   DATABASE_URL=… node scripts/ops/integrity1-find-vanished.js --apply       # write
//   DATABASE_URL=… node scripts/ops/integrity1-find-vanished.js --undo=al_…   # reverse one org's run
//   --org=org_x narrows it to one organisation. org_creo is never touched.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/ops/integrity1-find-vanished", name: "Fix: an import's undo trashed someone who was already here", kind: "system" };
const PATH = "scripts/ops/integrity1-find-vanished.js";
const rid = p => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

const LIST_SQL = `
  WITH undone AS (
    SELECT r.org_id, r.record_id AS donor_id, r.id AS trash_id, r.created_at AS trashed_at, r.row_data ->> '__importUndo' AS import_id
      FROM deleted_records r
     WHERE r.table_name = 'donors' AND r.restored_at IS NULL AND (r.row_data ->> '__importUndo') IS NOT NULL
       AND ($1::text IS NULL OR r.org_id = $1) AND r.org_id <> 'org_creo'
  )
  SELECT u.org_id, u.donor_id, u.trash_id, u.import_id
    FROM undone u
    JOIN donors d ON d.org_id = u.org_id AND d.id = u.donor_id AND d.deleted_at IS NOT NULL
    JOIN imports i ON i.org_id = u.org_id AND i.id = u.import_id
    LEFT JOIN sheet_import_jobs j ON j.org_id = u.org_id AND j.id = u.import_id
    JOIN LATERAL (
      SELECT b.row_data -> '__bringBack' AS stamp FROM deleted_records b
       WHERE b.org_id = u.org_id AND b.table_name = 'donors' AND b.record_id = u.donor_id
         AND (b.row_data -> '__bringBack' ->> 'importId') = u.import_id
       ORDER BY b.restored_at DESC NULLS LAST LIMIT 1) bb ON true
   WHERE ( (bb.stamp ->> 'file') IS NOT NULL   -- a stamp for another file than the one the import's commit carried
           AND NOT EXISTS (SELECT 1 FROM fin_audit_log a WHERE a.org_id = u.org_id AND a.request_path = '/sheet-import/commit'
                            AND (a.after_fields ->> 'importId') = u.import_id AND (a.after_fields ->> 'file') = (bb.stamp ->> 'file')) )
      OR ( (bb.stamp ->> 'file') IS NULL
           AND ( (bb.stamp ->> 'by') IS DISTINCT FROM i.actor_user_id
                 OR (bb.stamp ->> 'at')::timestamptz < COALESCE(j.started_at, i.committed_at) - INTERVAL '15 minutes' ) )
     -- deleted by hand since: a later trash row of their own
     AND NOT EXISTS (SELECT 1 FROM deleted_records l WHERE l.org_id = u.org_id AND l.table_name = 'donors' AND l.record_id = u.donor_id
                      AND l.restored_at IS NULL AND l.created_at > u.trashed_at AND l.id <> u.trash_id)
   ORDER BY u.org_id, u.donor_id`;

async function list(client, orgArg) {
  const { rows } = await client.query(LIST_SQL, [orgArg]);
  const byOrg = new Map();
  for (const r of rows) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r); }
  return byOrg;
}

const audit = (client, orgId, action, changes, before, after, summary, n) => client.query(
  `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                              changes, before_fields, after_fields, summary, record_count, request_method, request_path)
   VALUES ($1,$2,$3,$4,$5,$6,'donor',NULL,$7,$8,$9,$10,$11,'SCRIPT',$12) RETURNING id`,
  [rid("al_"), orgId, ACTOR.id, ACTOR.name, ACTOR.kind, action, JSON.stringify(changes), JSON.stringify(before), JSON.stringify(after), summary, n, PATH]);

async function apply(client, orgId, rows) {
  await client.query("BEGIN");
  try {
    const back = (await client.query("UPDATE donors SET deleted_at = NULL WHERE org_id = $1 AND id = ANY($2) AND deleted_at IS NOT NULL RETURNING id",
      [orgId, rows.map(r => r.donor_id)])).rows.map(r => r.id);
    const trash = rows.filter(r => back.includes(r.donor_id)).map(r => r.trash_id);
    await client.query("UPDATE deleted_records SET restored_at = NOW() WHERE org_id = $1 AND id = ANY($2) AND restored_at IS NULL", [orgId, trash]);
    const { rows: [a] } = await audit(client, orgId, "bring back",
      { people: back, trashRecords: trash, imports: [...new Set(rows.map(r => r.import_id))] }, { trashed: back }, { live: back },
      `${back.length} people an import's undo had trashed, though they were here before that import, were brought back`, back.length);
    await client.query("COMMIT");
    return { auditId: a.id, count: back.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = 'bring back'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    // only the trash rows this run closed, for people still live and not deleted again since
    const closed = (await client.query(`SELECT id, record_id FROM deleted_records WHERE org_id = $1 AND id = ANY($2) AND restored_at IS NOT NULL`,
      [a.org_id, ch.trashRecords || []])).rows;
    const gone = (await client.query(`UPDATE donors SET deleted_at = NOW() WHERE org_id = $1 AND id = ANY($2) AND deleted_at IS NULL RETURNING id`,
      [a.org_id, closed.map(r => r.record_id)])).rows.map(r => r.id);
    await client.query(`UPDATE deleted_records SET restored_at = NULL WHERE org_id = $1 AND id = ANY($2)`,
      [a.org_id, closed.filter(r => gone.includes(r.record_id)).map(r => r.id)]);
    if (gone.length) await audit(client, a.org_id, "return to trash", { people: gone, undoes: auditId }, { live: gone }, { trashed: gone },
      `${gone.length} people put back in the trash: the script's run ${auditId} undone`, gone.length);
    await client.query("COMMIT");
    return { orgId: a.org_id, count: gone.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main(argv = process.argv) {
  const { writerDbUrl } = require("../lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = argv.includes("--apply");
  const undoId = (argv.find(a => a.startsWith("--undo=")) || "").slice(7) || null;
  const orgArg = (argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  if (orgArg === "org_creo") throw new Error("org_creo is never touched.");
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    if (undoId) {
      const r = await undo(client, undoId);
      console.log(`${r.orgId}: ${r.count} put back in the trash.`);
      return;
    }
    console.log(APPLY ? "MODE: APPLY (one transaction and one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    const byOrg = await list(client, orgArg);
    let total = 0;
    for (const [orgId, rows] of byOrg) {
      if (!APPLY) { console.log(`${orgId}: ${rows.length}`); total += rows.length; continue; }
      const r = await apply(client, orgId, rows);
      console.log(`${orgId}: ${r.count} brought back (audit ${r.auditId}; undo with --undo=${r.auditId})`);
      total += r.count;
    }
    console.log(`\n${total} ${total === 1 ? "person" : "people"} in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"} ${APPLY ? "brought back" : "would be brought back"}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL };
