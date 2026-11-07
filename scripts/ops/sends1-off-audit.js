#!/usr/bin/env node
// scripts/ops/sends1-off-audit.js · SENDS-1 item 1. JONATHAN RUNS IT.
//
// Off means Off. Lists, by org id with counts only (no names, no addresses):
//   A. orgs where an email type is switched on while the org's email (Donor
//      mail, the master) is off. Reported only: since SENDS-1 every surface
//      reads Off for these and nothing sends, so the director's kept choice is
//      left alone.
//   B. sequences that are Active while a step has no words, or with no trigger.
//      Since SENDS-1 these can't be turned on. --apply sets them Paused
//      (turned_off_at = NOW()), one audit row per org naming the sequence ids.
//      The milestone sequence drafts each email per person, so its empty step
//      is not counted (server/outreach/sendsOff.js).
//
// SAFE BY DEFAULT: a dry run. A second --apply finds none. org_creo is never
// touched. To put one org back: UPDATE sequences SET status='active',
// turned_off_at=NULL WHERE id = ANY(<the ids in its audit row>).
//
//   node scripts/ops/sends1-off-audit.js                 # dry run
//   node scripts/ops/sends1-off-audit.js --org=org_x     # one org
//   node scripts/ops/sends1-off-audit.js --apply         # pause list B
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const crypto = require("crypto");
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const ORG = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;
const ACTOR = { id: "system:scripts/ops/sends1-off-audit", name: "Cleanup: sequences that can't be Active", kind: "system" };
const PATH = "scripts/ops/sends1-off-audit.js";
const rid = p => p + crypto.randomBytes(10).toString("hex");

const SUB_ON_MASTER_OFF_SQL = `
  SELECT t.org_id, COUNT(*)::int AS n
    FROM org_mail_types t JOIN orgs o ON o.id = t.org_id
   WHERE t.is_on = TRUE AND o.emails_enabled IS NOT TRUE
     AND t.org_id <> 'org_creo' AND ($1::text IS NULL OR t.org_id = $1::text)
   GROUP BY t.org_id ORDER BY t.org_id`;

// A step is empty when its body has no words once tags, &nbsp; and blanks go.
const EMPTY_ACTIVE_SQL = `
  SELECT s.org_id, s.id
    FROM sequences s
   WHERE s.status = 'active' AND s.org_id <> 'org_creo'
     AND ($1::text IS NULL OR s.org_id = $1::text)
     AND (COALESCE(TRIM(s.trigger), '') = ''
          OR (s.trigger <> 'milestone' AND (
                NOT EXISTS (SELECT 1 FROM sequence_steps st WHERE st.sequence_id = s.id)
             OR EXISTS (SELECT 1 FROM sequence_steps st WHERE st.sequence_id = s.id
                         AND TRIM(REPLACE(REGEXP_REPLACE(COALESCE(st.body, ''), '<[^>]*>', '', 'g'), '&nbsp;', ' ')) = ''))))
   ORDER BY s.org_id, s.id`;

async function pauseOrg(client, orgId, ids) {
  await client.query("BEGIN");
  try {
    const done = (await client.query(
      `UPDATE sequences SET status = 'paused', turned_off_at = NOW() WHERE org_id = $1 AND id = ANY($2) AND status = 'active' RETURNING id`,
      [orgId, ids])).rows.map(r => r.id);
    if (done.length) {
      await client.query(
        `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                    changes, before_fields, after_fields, summary, record_count, request_method, request_path)
         VALUES ($1,$2,$3,$4,$5,'pause sequences','sequence',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
        [rid("al_"), orgId, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ sequences: done }),
         JSON.stringify({ status: "active" }), JSON.stringify({ status: "paused" }),
         `${done.length} ${done.length === 1 ? "sequence" : "sequences"} with an empty step or no trigger set to Paused (nothing sent, nothing deleted)`, done.length, PATH]);
    }
    await client.query("COMMIT");
    return done.length;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function main() {
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
  const pool = new Pool({ connectionString: DB_URL, ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    console.log(APPLY ? "MODE: APPLY (pauses list B)\n" : "MODE: DRY RUN (no writes)\n");
    const a = (await client.query(SUB_ON_MASTER_OFF_SQL, [ORG])).rows;
    console.log(`A. Orgs with an email type on while the org's email is off: ${a.length}`);
    for (const r of a) console.log(`   ${r.org_id}  types on: ${r.n}`);
    const rows = (await client.query(EMPTY_ACTIVE_SQL, [ORG])).rows;
    const byOrg = new Map();
    for (const r of rows) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r.id); }
    console.log(`\nB. Active sequences with an empty step or no trigger: ${rows.length} in ${byOrg.size} org(s)`);
    for (const [org, ids] of byOrg) console.log(`   ${org}  sequences: ${ids.length}`);
    if (!APPLY) { if (rows.length) console.log("\nDry run: nothing changed. Re-run with --apply to set list B to Paused."); return; }
    let n = 0;
    for (const [org, ids] of byOrg) n += await pauseOrg(client, org, ids);
    console.log(`\nSet ${n} sequence(s) to Paused, one audit row per org.`);
  } finally { client.release(); await pool.end(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { SUB_ON_MASTER_OFF_SQL, EMPTY_ACTIVE_SQL };
