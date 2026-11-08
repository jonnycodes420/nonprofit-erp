#!/usr/bin/env node
// INTEGRITY-2 · WHAT DELETES BEFORE THIS BUILD LEFT BEHIND.
//
// The fixes stop new residue. These rows already exist and still carry the old
// state, so this script finds them. Only org ids and counts are printed, never
// names.
//
//   1. links  (W-1108-Donors-45X): relationship rows, household memberships and
//      household primaries that still name a person in the trash. The screens
//      already hide a link to someone in the trash; --apply moves each one onto
//      that person's open trash row (row_data.__links, exactly as a delete does
//      now), so Restore brings it back, and removes it. One transaction and one
//      audit row per org. --undo=<audit id> puts that run's links back.
//   2. taken  (W-1107-Finance-35): people an import's Undo trashed because it
//      claimed a "Bring them back" another user pressed for the same file
//      (Fiona's shape; INTEGRITY-1's script looks only for a different file).
//      LISTED ONLY: Restore is a hand click in Settings, Trash, by someone who
//      knows the person (the brief's rule for Fiona).
//   3. meetings (W-1108-Volunteers-17X): open "How did it go" and prep tasks of
//      a calendar meeting whose logged meeting line was deleted. LISTED ONLY:
//      each is one click in Tasks, and the meeting may have been re-logged.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/integrity2-trash-residue.js             # dry run, every org
//   DATABASE_URL=… node scripts/ops/integrity2-trash-residue.js --apply     # move the links (part 1 only)
//   DATABASE_URL=… node scripts/ops/integrity2-trash-residue.js --undo=al_… # reverse one org's run
//   --org=org_x narrows it to one organisation. org_creo is never touched.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");

const ACTOR = { id: "system:scripts/ops/integrity2-trash-residue", name: "Fix: links left on people in the trash", kind: "system" };
const PATH = "scripts/ops/integrity2-trash-residue.js";
const rid = p => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const ORG_OK = "($1::text IS NULL OR d.org_id = $1) AND d.org_id <> 'org_creo'";

async function links(client, org) {
  const { rows } = await client.query(
    `SELECT d.org_id, d.id,
            (SELECT COUNT(*) FROM donor_relationships r WHERE r.org_id = d.org_id AND (r.donor_id_a = d.id OR r.donor_id_b = d.id))::int AS rels,
            (d.household_id IS NOT NULL) AS member,
            (SELECT COUNT(*) FROM households h WHERE h.org_id = d.org_id AND h.primary_donor_id = d.id)::int AS heads
       FROM donors d
      WHERE d.deleted_at IS NOT NULL AND d.erased_at IS NULL AND ${ORG_OK}
        AND (d.household_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM donor_relationships r WHERE r.org_id = d.org_id AND (r.donor_id_a = d.id OR r.donor_id_b = d.id))
             OR EXISTS (SELECT 1 FROM households h WHERE h.org_id = d.org_id AND h.primary_donor_id = d.id))`, [org]);
  return rows;
}
async function taken(client, org) {
  const { rows } = await client.query(
    `SELECT d.org_id, COUNT(DISTINCT d.id)::int AS n
       FROM deleted_records u
       JOIN donors d ON d.org_id = u.org_id AND d.id = u.record_id AND d.deleted_at IS NOT NULL
       JOIN imports i ON i.org_id = u.org_id AND i.id = u.row_data ->> '__importUndo'
       JOIN deleted_records b ON b.org_id = u.org_id AND b.table_name = 'donors' AND b.record_id = u.record_id
                             AND (b.row_data -> '__bringBack' ->> 'importId') = i.id
      WHERE u.table_name = 'donors' AND u.restored_at IS NULL AND ${ORG_OK}
        AND (b.row_data -> '__bringBack' ->> 'by') IS DISTINCT FROM i.actor_user_id
      GROUP BY d.org_id`, [org]);
  return rows;
}
async function meetings(client, org) {
  const { rows } = await client.query(
    `SELECT d.org_id, COUNT(*)::int AS n FROM tasks d
       JOIN calendar_events c ON c.org_id = d.org_id AND c.id = d.calendar_event_id
      WHERE COALESCE(d.done, 0)::int = 0 AND d.voided_at IS NULL AND c.interaction_id IS NULL AND c.logged_at IS NOT NULL AND ${ORG_OK}
      GROUP BY d.org_id`, [org]);
  return rows;
}

const audit = (client, orgId, action, changes, summary, n) => client.query(
  `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                              changes, summary, record_count, request_method, request_path)
   VALUES ($1,$2,$3,$4,$5,$6,'donor',NULL,$7,$8,$9,'SCRIPT',$10) RETURNING id`,
  [rid("al_"), orgId, ACTOR.id, ACTOR.name, ACTOR.kind, action, JSON.stringify(changes), summary, n, PATH]);

// Part 1 --apply: the same take as personLinks.takeLinks, onto each person's newest open trash row.
async function applyLinks(client, orgId, ids) {
  await client.query("BEGIN");
  try {
    const moved = [];
    for (const id of ids) {
      const { rows: [t] } = await client.query(`SELECT id FROM deleted_records WHERE org_id=$1 AND table_name='donors' AND record_id=$2 AND restored_at IS NULL ORDER BY created_at DESC LIMIT 1`, [orgId, id]);
      if (!t) continue;   // no open trash row (merged, or deleted by an old path): left for a person to look at
      const rels = (await client.query(`DELETE FROM donor_relationships WHERE org_id=$1 AND (donor_id_a=$2 OR donor_id_b=$2) RETURNING *`, [orgId, id])).rows;
      const hh = (await client.query(`SELECT household_id FROM donors WHERE org_id=$1 AND id=$2`, [orgId, id])).rows[0].household_id;
      if (hh) await client.query(`UPDATE donors SET household_id=NULL WHERE org_id=$1 AND id=$2`, [orgId, id]);
      const heads = (await client.query(`UPDATE households SET primary_donor_id=NULL, updated_at=NOW() WHERE org_id=$1 AND primary_donor_id=$2 RETURNING id`, [orgId, id])).rows.map(r => r.id);
      const l = { relationships: rels, household: hh || null, primaryOf: heads };
      await client.query(`UPDATE deleted_records SET row_data = row_data || jsonb_build_object('__links', $2::jsonb) WHERE id=$1`, [t.id, JSON.stringify(l)]);
      moved.push({ person: id, trashId: t.id, rels: rels.map(r => r.id), household: hh || null, heads });
    }
    const n = moved.reduce((s, m) => s + m.rels.length + (m.household ? 1 : 0) + m.heads.length, 0);
    const { rows: [a] } = await audit(client, orgId, "move links to trash", { moved },
      `${n} links left on ${moved.length} people in the trash were moved onto their trash rows (Restore brings them back)`, n);
    await client.query("COMMIT");
    return { auditId: a.id, people: moved.length, links: n };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}
async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id=$1 AND user_id=$2 AND action='move links to trash'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    let n = 0;
    for (const m of ch.moved || []) {
      const { rows: [t] } = await client.query(`SELECT row_data -> '__links' AS l FROM deleted_records WHERE id=$1`, [m.trashId]);
      const l = t && (typeof t.l === "string" ? JSON.parse(t.l) : t.l);
      if (!l) continue;
      for (const r of l.relationships || []) n += (await client.query(`INSERT INTO donor_relationships SELECT * FROM jsonb_populate_record(NULL::donor_relationships, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(r)])).rowCount;
      if (l.household) n += (await client.query(`UPDATE donors SET household_id=$1 WHERE org_id=$2 AND id=$3 AND household_id IS NULL`, [l.household, a.org_id, m.person])).rowCount;
      for (const h of l.primaryOf || []) n += (await client.query(`UPDATE households SET primary_donor_id=$1 WHERE org_id=$2 AND id=$3 AND primary_donor_id IS NULL`, [m.person, a.org_id, h])).rowCount;
      await client.query(`UPDATE deleted_records SET row_data = row_data - '__links' WHERE id=$1`, [m.trashId]);
    }
    await audit(client, a.org_id, "return links", { undoes: auditId }, `${n} links put back: the script's run ${auditId} undone`, n);
    await client.query("COMMIT");
    return { orgId: a.org_id, count: n };
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
    if (undoId) { const r = await undo(client, undoId); console.log(`${r.orgId}: ${r.count} links put back.`); return; }
    console.log(APPLY ? "MODE: APPLY (part 1 only; one transaction and one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to move part 1's links)\n");
    const L = await links(client, orgArg);
    const byOrg = new Map();
    for (const r of L) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r); }
    console.log("1. links left on people in the trash:");
    for (const [orgId, rows] of byOrg) {
      const n = rows.reduce((s, r) => s + r.rels + (r.member ? 1 : 0) + r.heads, 0);
      if (!APPLY) { console.log(`   ${orgId}: ${n} links on ${rows.length} people`); continue; }
      const r = await applyLinks(client, orgId, rows.map(x => x.id));
      console.log(`   ${orgId}: ${r.links} links on ${r.people} people moved to their trash rows (audit ${r.auditId}; undo with --undo=${r.auditId})`);
    }
    if (!byOrg.size) console.log("   none");
    console.log("2. people an undo trashed through another user's Bring them back (restore by hand in Settings, Trash):");
    const T = await taken(client, orgArg);
    for (const r of T) console.log(`   ${r.org_id}: ${r.n}`);
    if (!T.length) console.log("   none");
    console.log("3. open meeting tasks whose logged meeting was deleted (close by hand in Tasks):");
    const M = await meetings(client, orgArg);
    for (const r of M) console.log(`   ${r.org_id}: ${r.n}`);
    if (!M.length) console.log("   none");
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { links, taken, meetings, applyLinks, undo };
