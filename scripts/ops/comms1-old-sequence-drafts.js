#!/usr/bin/env node
// scripts/ops/comms1-old-sequence-drafts.js · COMMS-1 item 3. JONATHAN RUNS IT.
//
// The at-risk and milestone sequences TRUST-1 turned off left their drafts
// sitting in orgs' "waiting for you" queues. This archives the unsent ones:
// drafts (milestone_drafts, status 'pending_review', never sent) whose
// sequence is now off (status not 'active') and that are older than 7 days.
//
// SAFE BY DEFAULT: a dry run lists org ids and counts only. --apply archives
// them (status 'archived': never deleted, never sent) in one transaction and
// one audit row per org, naming the draft ids. They show under Drafts to
// review's "Dismissed (n)", where each can be restored (server/drafts/dismiss.js). --undo=<audit id> puts that
// org's drafts back in the queue. A second run finds none. org_creo is never
// touched.
//
//   node scripts/ops/comms1-old-sequence-drafts.js                 # dry run
//   node scripts/ops/comms1-old-sequence-drafts.js --org=org_x     # one org
//   node scripts/ops/comms1-old-sequence-drafts.js --apply         # write
//   node scripts/ops/comms1-old-sequence-drafts.js --undo=al_…     # put one org's run back
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const crypto = require("crypto");
const { Pool } = require("pg");

const ACTOR = { id: "system:scripts/ops/comms1-old-sequence-drafts", name: "Cleanup: drafts from sequences that are turned off", kind: "system" };
const PATH = "scripts/ops/comms1-old-sequence-drafts.js";
const rid = p => p + crypto.randomBytes(8).toString("hex");

const LIST_SQL = `
  SELECT m.org_id, m.id
    FROM milestone_drafts m
    JOIN sequence_enrollments e ON e.id = m.sequence_enrollment_id
    JOIN sequences s ON s.id = e.sequence_id AND s.org_id = m.org_id
   WHERE m.status = 'pending_review' AND m.sent_at IS NULL
     AND s.status <> 'active'
     AND m.created_at < NOW() - INTERVAL '7 days'
     AND m.org_id <> 'org_creo'
     AND ($1::text IS NULL OR m.org_id = $1::text)
   ORDER BY m.org_id, m.created_at, m.id`;

async function list(client, orgArg = null) {
  const { rows } = await client.query(LIST_SQL, [orgArg]);
  const byOrg = new Map();
  for (const r of rows) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r.id); }
  return byOrg;
}

async function apply(client, orgId, ids) {
  await client.query("BEGIN");
  try {
    const done = (await client.query(
      `UPDATE milestone_drafts SET status = 'archived', archived_at = NOW(), archived_by = $3, archived_by_name = $4
        WHERE org_id = $1 AND id = ANY($2) AND status = 'pending_review' AND sent_at IS NULL RETURNING id`,
      [orgId, ids, ACTOR.id, ACTOR.name])).rows.map(r => r.id);
    let auditId = null;
    if (done.length) {
      auditId = rid("al_");
      await client.query(
        `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                    changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'archive drafts','draft',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
        [auditId, orgId, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ drafts: done }),
         JSON.stringify({ status: "pending_review" }), JSON.stringify({ status: "archived" }),
         `${done.length} unsent ${done.length === 1 ? "draft" : "drafts"} from turned-off sequences archived (none sent, none deleted)`, done.length, PATH]);
    }
    await client.query("COMMIT");
    return { auditId, count: done.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = 'archive drafts'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const ch = typeof a.changes === "string" ? JSON.parse(a.changes) : a.changes || {};
  await client.query("BEGIN");
  try {
    // only the drafts this run archived that are still archived
    const back = (await client.query(
      `UPDATE milestone_drafts SET status = 'pending_review', archived_at = NULL, archived_by = NULL, archived_by_name = NULL
        WHERE org_id = $1 AND id = ANY($2) AND status = 'archived' AND archived_by = $3 RETURNING id`,
      [a.org_id, ch.drafts || [], ACTOR.id])).rows.map(r => r.id);
    if (back.length) {
      await client.query(
        `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                    changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'restore drafts','draft',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
        [rid("al_"), a.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ drafts: back, undoes: auditId }),
         JSON.stringify({ status: "archived" }), JSON.stringify({ status: "pending_review" }),
         `${back.length} archived ${back.length === 1 ? "draft" : "drafts"} put back in the queue: the script's run ${auditId} undone`, back.length, PATH]);
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
      console.log(`${r.orgId}: ${r.count} put back in the queue.`);
      return;
    }
    console.log(APPLY ? "MODE: APPLY (archives; one transaction and one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to archive)\n");
    const byOrg = await list(client, orgArg);
    let total = 0;
    for (const [orgId, ids] of byOrg) {
      if (!APPLY) { console.log(`${orgId}: ${ids.length}`); total += ids.length; continue; }
      const r = await apply(client, orgId, ids);
      console.log(`${orgId}: ${r.count} archived${r.auditId ? ` (audit ${r.auditId}; undo with --undo=${r.auditId})` : ""}`);
      total += r.count;
    }
    console.log(`\n${total} ${total === 1 ? "draft" : "drafts"} in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"} ${APPLY ? "archived" : "would be archived"}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL, list, apply, undo, ACTOR };
