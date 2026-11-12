#!/usr/bin/env node
// IMPORT-10 item 8 · PEOPLE MARKED DONOR WHO HAVE NEVER GIVEN.
//
// The Directory counts the stored role (person_types holds "donor"). Two import
// paths stored "donor" on every row, gift or not (fixed in this build: shared/
// numbers/donorType.js), so an org's Directory said Donors 6,445, Contacts 0,
// with 3,592 of the 6,445 never having given. This lists, per org, the people
// marked donor who have not given by the profile's rule (donorLabel.js
// HAS_GIVEN: a gift on file, or a lifetime above zero from the old system), and
// what each would become: their other roles kept, or a contact ("other").
// Only org ids and counts are printed, never names.
//
// DRY RUN BY DEFAULT. --apply makes the change, one transaction and ONE audit
// row per org (actor system:scripts/ops/import10-donor-roles) holding every
// person's roles before. --undo=<audit id> puts that org's roles back exactly,
// for anyone still as the script left them. A second run changes nothing.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/import10-donor-roles.js               # dry run, every org
//   DATABASE_URL=… node scripts/ops/import10-donor-roles.js --apply       # write
//   DATABASE_URL=… node scripts/ops/import10-donor-roles.js --undo=al_…   # put one org's run back
//   --org=org_x narrows it to one organisation. org_creo is never touched.
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
const { MARKED_NOT_GIVEN, WITHOUT_DONOR } = require("../../shared/numbers/donorType");

const ACTOR = { id: "system:scripts/ops/import10-donor-roles", name: "Fix: people marked donor who never gave", kind: "system" };
const PATH = "scripts/ops/import10-donor-roles.js";
const rid = p => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

const LIST_SQL = `
  SELECT d.org_id, d.id, d.person_types AS before, ${WITHOUT_DONOR("d")} AS after
    FROM donors d
   WHERE d.deleted_at IS NULL AND ($1::text IS NULL OR d.org_id = $1) AND d.org_id <> 'org_creo'
     AND ${MARKED_NOT_GIVEN("d")}
   ORDER BY d.org_id, d.id`;

const word = types => (types || []).filter(t => t !== "other").join(" + ") || "contact";

async function list(client, orgArg) {
  const { rows } = await client.query(LIST_SQL, [orgArg]);
  const byOrg = new Map();
  for (const r of rows) { if (!byOrg.has(r.org_id)) byOrg.set(r.org_id, []); byOrg.get(r.org_id).push(r); }
  return byOrg;
}

async function apply(client, orgId, rows) {
  await client.query("BEGIN");
  try {
    const ids = rows.map(r => r.id);
    const done = (await client.query(`UPDATE donors d SET person_types = ${WITHOUT_DONOR("d")}, updated_at = NOW()
                                       WHERE d.org_id = $1 AND d.id = ANY($2) AND ${MARKED_NOT_GIVEN("d")} RETURNING d.id, d.person_types`, [orgId, ids])).rows;
    const before = Object.fromEntries(rows.filter(r => done.some(x => x.id === r.id)).map(r => [r.id, r.before]));
    const auditId = rid("al_");
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'donor role removed','donor',NULL,$6,$7,$8,$9,$10,'SCRIPT',$11)`,
      [auditId, orgId, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ people: done.map(x => x.id) }),
       JSON.stringify({ personTypes: before }), JSON.stringify({ personTypes: Object.fromEntries(done.map(x => [x.id, x.person_types])) }),
       `${done.length} people marked donor who had never given are no longer counted as donors`, done.length, PATH]);
    await client.query("COMMIT");
    return { auditId, count: done.length };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
}

async function undo(client, auditId) {
  const { rows: [a] } = await client.query(`SELECT * FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = 'donor role removed'`, [auditId, ACTOR.id]);
  if (!a) throw new Error(`No run of this script has the audit id ${auditId}.`);
  const parse = v => (typeof v === "string" ? JSON.parse(v) : v || {});
  const before = parse(a.before_fields).personTypes || {}, after = parse(a.after_fields).personTypes || {};
  await client.query("BEGIN");
  try {
    let n = 0;
    for (const [id, types] of Object.entries(before)) {
      // only someone still as the script left them
      const r = await client.query(`UPDATE donors SET person_types = $3::jsonb, updated_at = NOW() WHERE org_id = $1 AND id = $2 AND person_types = $4::jsonb`,
        [a.org_id, id, types == null ? null : JSON.stringify(types), JSON.stringify(after[id])]);
      n += r.rowCount;
    }
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'donor role restored','donor',NULL,$6,'{}'::jsonb,'{}'::jsonb,$7,$8,'SCRIPT',$9)`,
      [rid("al_"), a.org_id, ACTOR.id, ACTOR.name, ACTOR.kind, JSON.stringify({ undoes: auditId }), `${n} people's roles put back: the script's run ${auditId} undone`, n, PATH]);
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
    if (undoId) { const r = await undo(client, undoId); console.log(`${r.orgId}: ${r.count} put back.`); return; }
    console.log(APPLY ? "MODE: APPLY (one transaction and one audit row per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    const byOrg = await list(client, orgArg);
    let total = 0;
    for (const [orgId, rows] of byOrg) {
      const become = new Map();
      for (const r of rows) { const w = word(r.after); become.set(w, (become.get(w) || 0) + 1); }
      const what = [...become].map(([w, n]) => `${n} ${w}`).join(", ");
      if (!APPLY) { console.log(`${orgId}: ${rows.length} marked donor with no gift → ${what}`); total += rows.length; continue; }
      const r = await apply(client, orgId, rows);
      console.log(`${orgId}: ${r.count} no longer donors → ${what} (audit ${r.auditId}; undo with --undo=${r.auditId})`);
      total += r.count;
    }
    console.log(`\n${total} ${total === 1 ? "person" : "people"} in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"} ${APPLY ? "changed" : "would change"}.`);
  } finally { client.release(); await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
module.exports = { LIST_SQL, main };
