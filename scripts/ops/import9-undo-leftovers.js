#!/usr/bin/env node
// IMPORT-9 · PEOPLE AN UNDONE IMPORT LEFT OUT OF THE TRASH.
//
// Before IMPORT-9, an import's "Bring them back" restored people from the
// trash, and that import's Undo did not put them back: it removed the
// import's gifts and left them live at $0 (Muse's Walk B, 5 Nov: Everyone
// went from 1,017 to 1,217). The fix (server/imports/restoredPeople.js) covers
// imports from now on; this script finds the ones already left behind.
//
// A person is listed when ALL of these hold:
//   · a "Bring them back" (POST /sheet-import/bring-back, its audit row's
//     after_fields.broughtBack) restored them from the trash, and the next
//     spreadsheet import into that org (within a day) was later undone;
//   · nothing of their own was added after the bring-back: no gift, no note
//     or call, no task;
//   · untouched since the undo: no audit row names them after it.
// Only org ids and counts are printed, never names.
//
// DRY RUN BY DEFAULT. --apply puts each one back in the trash (deleted_at,
// and a trash row of their own, the same as Delete), one transaction and ONE
// audit row per org (actor system:scripts/ops/import9-undo-leftovers) naming
// the people and the trash rows. --undo=<audit id> brings that org's people
// back exactly (closes those trash rows) and writes its own audit row. A
// second run of either changes nothing.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/import9-undo-leftovers.js                 # dry run, every org
//   DATABASE_URL=… node scripts/ops/import9-undo-leftovers.js --apply         # write
//   DATABASE_URL=… node scripts/ops/import9-undo-leftovers.js --undo=al_…     # put one org's run back
//   --org=org_x narrows it to one organisation. org_creo is never touched.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/ops/import9-undo-leftovers", name: "Fix: an undone import left people it brought back", kind: "system" };
const PATH = "scripts/ops/import9-undo-leftovers.js";
const rid = p => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

const LIST_SQL = `
  WITH back AS (
    SELECT a.org_id, a.created_at AS back_at, jsonb_array_elements_text(a.after_fields -> 'broughtBack') AS donor_id
      FROM fin_audit_log a
     WHERE a.request_path = '/sheet-import/bring-back' AND jsonb_typeof(a.after_fields -> 'broughtBack') = 'array'
       AND ($1::text IS NULL OR a.org_id = $1) AND a.org_id <> 'org_creo'
  ), next_import AS (
    SELECT b.*, (SELECT i.id FROM imports i WHERE i.org_id = b.org_id AND i.shape = 'sheet' AND i.committed_at > b.back_at
                    AND i.committed_at < b.back_at + INTERVAL '1 day' ORDER BY i.committed_at, i.id LIMIT 1) AS import_id
      FROM back b
  ), undone AS (
    SELECT DISTINCT ON (n.org_id, n.donor_id) n.org_id, n.donor_id, n.back_at, n.import_id, i.reversed_at
      FROM next_import n JOIN imports i ON i.id = n.import_id AND i.org_id = n.org_id
     WHERE i.reversed_at IS NOT NULL
     ORDER BY n.org_id, n.donor_id, n.back_at DESC
  )
  SELECT u.org_id, u.donor_id, u.import_id
    FROM undone u
    JOIN donors d ON d.org_id = u.org_id AND d.id = u.donor_id AND d.deleted_at IS NULL
   WHERE NOT EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = u.org_id AND g.donor_id = u.donor_id AND g.created_at > u.back_at)
     AND NOT EXISTS (SELECT 1 FROM interactions x WHERE x.org_id = u.org_id AND x.donor_id = u.donor_id AND x.created_at > u.back_at)
     AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.org_id = u.org_id AND t.donor_id = u.donor_id AND t.created_at > u.back_at)
     AND NOT EXISTS (SELECT 1 FROM fin_audit_log a WHERE a.org_id = u.org_id AND a.entity_id = u.donor_id AND a.created_at > u.reversed_at)
     -- a later bring-back that was kept (its import not undone) means she wanted them
     AND NOT EXISTS (SELECT 1 FROM next_import k JOIN imports ki ON ki.id = k.import_id
                      WHERE k.org_id = u.org_id AND k.donor_id = u.donor_id AND k.back_at > u.back_at AND ki.reversed_at IS NULL)
   ORDER BY u.org_id, u.donor_id`;

async function list(client, orgArg) {
  const { rows } = await client.query(LIST_SQL, [orgArg]);
  const byOrg = new Map();
  for (const r of rows) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r); }
  return byOrg;
}

async function apply(client, orgId, rows) {
  await client.query("BEGIN");
  try {
    const ids = rows.map(r => r.donor_id);
    const gone = (await client.query("UPDATE donors SET deleted_at = NOW() WHERE org_id = $1 AND id = ANY($2) AND deleted_at IS NULL RETURNING id", [orgId, ids])).rows.map(r => r.id);
    const trash = [];
    for (const id of gone) {
      const t = rid("del_");
      await client.query(`INSERT INTO deleted_records (id, org_id, table_name, record_id, row_data, created_by, created_by_name)
                          VALUES ($1, $2, 'donors', $3, $4::jsonb, $5, $6)`,
        [t, orgId, id, JSON.stringify({ __soft: true, __script: "import9-undo-leftovers" }), ACTOR.id, ACTOR.name]);
      trash.push(t);
    }
    const auditId = rid("al_");
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'return to trash','donor',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
      [auditId, orgId, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ people: gone, trashRecords: trash, imports: [...new Set(rows.map(r => r.import_id))] }),
       JSON.stringify({ live: gone }), JSON.stringify({ trashed: gone }),
       `${gone.length} people an undone import had brought back from the trash were put back there`, gone.length, PATH]);
    await client.query("COMMIT");
    return { auditId, count: gone.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = 'return to trash'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    // only the trash rows this run wrote and nobody has closed since
    const open = (await client.query(`SELECT record_id FROM deleted_records WHERE org_id = $1 AND id = ANY($2) AND restored_at IS NULL`,
      [a.org_id, ch.trashRecords || []])).rows.map(r => r.record_id);
    const back = (await client.query(`UPDATE donors SET deleted_at = NULL WHERE org_id = $1 AND id = ANY($2) AND deleted_at IS NOT NULL RETURNING id`,
      [a.org_id, open])).rows.map(r => r.id);
    await client.query(`UPDATE deleted_records SET restored_at = NOW() WHERE org_id = $1 AND table_name = 'donors' AND record_id = ANY($2) AND restored_at IS NULL`,
      [a.org_id, back]);
    if (back.length) {
      await client.query(
        `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                    changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'bring back','donor',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
        [rid("al_"), a.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ people: back, undoes: auditId }),
         JSON.stringify({ trashed: back }), JSON.stringify({ live: back }),
         `${back.length} people brought back: the script's run ${auditId} undone`, back.length, PATH]);
    }
    await client.query("COMMIT");
    return { orgId: a.org_id, count: back.length };
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
      console.log(`${r.orgId}: ${r.count} brought back.`);
      return;
    }
    console.log(APPLY ? "MODE: APPLY (one transaction and one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    const byOrg = await list(client, orgArg);
    let total = 0;
    for (const [orgId, rows] of byOrg) {
      if (!APPLY) { console.log(`${orgId}: ${rows.length}`); total += rows.length; continue; }
      const r = await apply(client, orgId, rows);
      console.log(`${orgId}: ${r.count} put back in the trash (audit ${r.auditId}; undo with --undo=${r.auditId})`);
      total += r.count;
    }
    console.log(`\n${total} ${total === 1 ? "person" : "people"} in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"} ${APPLY ? "put back in the trash" : "would be put back in the trash"}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL };
