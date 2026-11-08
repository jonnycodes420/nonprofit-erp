#!/usr/bin/env node
// scripts/ops/stale2-event-line-orphans.js · STALE-2 item 2. JONATHAN RUNS IT.
//
// Before STALE-2 a guest removed from an event (or every guest, then the
// event) left their "Registered for X." and "Came to X." lines on the
// person's timeline (W-1107-Volunteers-21). Removing a guest now takes the
// lines with it (server/events/attendanceLines.js). This finds the ones left
// behind before that: an event line (metadata via event_registration or
// event_attendance) whose guest row is gone and is not waiting in the trash.
//
// SAFE BY DEFAULT: a dry run prints org ids and counts only, never a name or a
// note. --apply deletes them in one transaction and one audit row per org,
// whose `changes` keep every deleted row whole, so --undo=<audit id> puts that
// org's lines back exactly. A second run finds none. org_creo is never touched.
//
//   node scripts/ops/stale2-event-line-orphans.js                 # dry run
//   node scripts/ops/stale2-event-line-orphans.js --org=org_x     # one org
//   node scripts/ops/stale2-event-line-orphans.js --apply         # write
//   node scripts/ops/stale2-event-line-orphans.js --undo=al_…     # put one org's run back
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const crypto = require("crypto");
const { Pool } = require("pg");
const { ORPHANS_WHERE } = require("../../server/events/attendanceLines");

const ACTOR = { id: "system:scripts/ops/stale2-event-line-orphans", name: "Cleanup: event lines whose guest is gone", kind: "system" };
const PATH = "scripts/ops/stale2-event-line-orphans.js";
const rid = p => p + crypto.randomBytes(8).toString("hex");

const LIST_SQL = `
  SELECT i.org_id, COUNT(*)::int AS n
    FROM interactions i
   WHERE ${ORPHANS_WHERE}
     AND i.org_id <> 'org_creo'
     AND ($1::text IS NULL OR i.org_id = $1::text)
   GROUP BY i.org_id ORDER BY i.org_id`;

async function list(client, orgArg = null) {
  return (await client.query(LIST_SQL, [orgArg])).rows;
}

async function apply(client, orgId) {
  if (orgId === "org_creo") throw new Error("org_creo is never touched.");
  await client.query("BEGIN");
  try {
    const gone = (await client.query(
      `DELETE FROM interactions i WHERE i.org_id = $1 AND ${ORPHANS_WHERE} RETURNING i.*`, [orgId])).rows;
    let auditId = null;
    if (gone.length) {
      auditId = rid("al_");
      await client.query(
        `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                    changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'delete orphaned event lines','interaction',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
        [auditId, orgId, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ interactions: gone }),
         JSON.stringify({ lines: gone.length }), JSON.stringify({ lines: 0 }),
         `${gone.length} timeline ${gone.length === 1 ? "line" : "lines"} for event guests who are no longer on the event removed`, gone.length, PATH]);
    }
    await client.query("COMMIT");
    return { auditId, count: gone.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = 'delete orphaned event lines'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    const back = (await client.query(
      `INSERT INTO interactions SELECT * FROM jsonb_populate_recordset(NULL::interactions, $1::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
      [JSON.stringify(ch.interactions || [])])).rows.map(r => r.id);
    if (back.length) {
      await client.query(
        `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                    changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'restore orphaned event lines','interaction',NULL,$6,NULL,NULL,$7,$8,'SCRIPT',$9)`,
        [rid("al_"), a.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ interactions: back, undoes: auditId }),
         `${back.length} event ${back.length === 1 ? "line" : "lines"} put back: the script's run ${auditId} undone`, back.length, PATH]);
    }
    await client.query("COMMIT");
    return { orgId: a.org_id, count: back.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main(argv = process.argv) {
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
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
      console.log(`${r.orgId}: ${r.count} put back.`);
      return;
    }
    console.log(APPLY ? "MODE: APPLY (deletes; one transaction and one audit row per org, rows kept for --undo)\n" : "MODE: DRY RUN (nothing is written; add --apply to delete)\n");
    const orgs = await list(client, orgArg);
    let total = 0;
    for (const o of orgs) {
      if (!APPLY) { console.log(`${o.org_id}: ${o.n}`); total += o.n; continue; }
      const r = await apply(client, o.org_id);
      console.log(`${o.org_id}: ${r.count} removed${r.auditId ? ` (audit ${r.auditId}; undo with --undo=${r.auditId})` : ""}`);
      total += r.count;
    }
    console.log(`\n${total} orphaned event ${total === 1 ? "line" : "lines"} in ${orgs.length} ${orgs.length === 1 ? "org" : "orgs"} ${APPLY ? "removed" : "would be removed"}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL, list, apply, undo, ACTOR };
