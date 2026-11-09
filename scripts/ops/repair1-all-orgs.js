#!/usr/bin/env node
// scripts/ops/repair1-all-orgs.js · REPAIR-1. THE SHIPPED RULES, ON THE ROWS EVERY OTHER ORG ALREADY HAS. JONATHAN RUNS IT.
//
// SENDS-1, STALE-2 and PLEDGES-2 fixed how new rows are written; rows written
// before them still say the old thing. This runs the demo tidy's steps 8 to 10
// (scripts/ops/demoTidy/repairSteps.js) on every org except two:
//   8 · one open thank-you per gift; the others to Done, noted "duplicate"
//   9 · every "Came to" / "Registered for" line says what its guest row says now
//  10 · every pledge installment's paid flag comes from the payments, oldest due first
// It never touches org_creo (the demo tidy does, when Jonathan runs it) or
// org_b72demo (only scripts/ci/seed-demo.js writes the demo).
//
// SAFE BY DEFAULT: the dry run prints, per org id, what each step would change
// (counts and ids; no addresses) and writes nothing. --apply makes each org's
// changes in its own transaction with ONE audit row per org that keeps every
// change whole, and --undo=<that row's id> puts that org back. A second
// --apply changes nothing.
//
//   node scripts/ops/repair1-all-orgs.js                    # dry run, every org
//   node scripts/ops/repair1-all-orgs.js --org=org_x        # one org
//   node scripts/ops/repair1-all-orgs.js --apply            # write
//   node scripts/ops/repair1-all-orgs.js --undo=al_…        # put one org back
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const { Pool } = require("pg");
const { journal, reverse, rid } = require("./demoTidy/journal");
const { ALL_ORG_STEPS } = require("./demoTidy/repairSteps");

const ACTOR = { id: "system:scripts/ops/repair1-all-orgs", name: "Repair: rows brought up to the shipped rules (REPAIR-1)", kind: "system" };
const PATH = "scripts/ops/repair1-all-orgs.js";
const ACTION = "repair1 run";
const SKIP = ["org_creo", "org_b72demo"];

const audit = (c, row) => c.query(
  `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                              changes, before_fields, after_fields, summary, record_count, request_method, request_path)
   VALUES ($1,$2,$3,$4,$5,$6,'org',NULL,$7,NULL,NULL,$8,$9,'SCRIPT',$10)`,
  [row.id, row.orgId, ACTOR.id, ACTOR.name, ACTOR.kind, row.action, JSON.stringify(row.changes), row.summary, row.count, PATH]);

async function repairOrg(c, orgId, apply, log) {
  await c.query("BEGIN");
  try {
    const ctx = { orgId, now: new Date().toISOString(), actor: ACTOR };
    const entries = [], lines = [];
    for (const [title, fn] of ALL_ORG_STEPS) {
      const J = journal(c, title);
      for (const l of await fn(c, J, ctx)) lines.push(`${title}: ${l}`);
      entries.push(...J.entries);
    }
    if (!entries.length) { await c.query("ROLLBACK"); return { orgId, changes: 0 }; }
    log(`\n${orgId}`);
    for (const l of lines) log(`  · ${l}`);
    if (!apply) { await c.query("ROLLBACK"); return { orgId, changes: entries.length }; }
    const id = rid("al_");
    await audit(c, { id, orgId, action: ACTION, changes: { entries }, count: entries.length,
      summary: `REPAIR-1: ${entries.length} ${entries.length === 1 ? "change" : "changes"} bringing thank-you tasks, attendance lines and pledge flags up to the shipped rules` });
    await c.query("COMMIT");
    log(`  applied; undo with --undo=${id}`);
    return { orgId, changes: entries.length, auditId: id };
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
}

async function run({ client: c, orgId = null, apply = false, log = console.log }) {
  if (orgId && SKIP.includes(orgId)) throw new Error(`${orgId} is never repaired here. ${orgId === "org_creo" ? "The demo tidy (scripts/ops/demo-tidy.js) repairs it." : "Only scripts/ci/seed-demo.js writes the demo."}`);
  log(apply ? "MODE: APPLY: one transaction and one audit row per org" : "MODE: DRY RUN: nothing is written; add --apply");
  log(`Skipped: ${SKIP.join(", ")}`);
  const orgs = (await c.query(`SELECT id FROM orgs WHERE id <> ALL($1::text[]) AND ($2::text IS NULL OR id = $2::text) ORDER BY id`, [SKIP, orgId])).rows;
  const results = [];
  for (const o of orgs) results.push(await repairOrg(c, o.id, apply, log));
  const touched = results.filter(r => r.changes);
  log(`\n${touched.length} of ${orgs.length} orgs ${apply ? "repaired" : "would change"}: ${touched.reduce((s, r) => s + r.changes, 0)} changes.`);
  return results;
}

async function undo({ client: c, auditId, log = console.log }) {
  const [r] = (await c.query(`SELECT org_id, changes FROM fin_audit_log WHERE id = $1 AND user_id = $2 AND action = $3`, [auditId, ACTOR.id, ACTION])).rows;
  if (!r) throw new Error(`No REPAIR-1 run ${auditId}.`);
  const [done] = (await c.query(`SELECT 1 FROM fin_audit_log WHERE org_id = $1 AND user_id = $2 AND action = 'repair1 undo' AND changes->>'undoes' = $3`, [r.org_id, ACTOR.id, auditId])).rows;
  if (done) throw new Error(`Run ${auditId} was already undone.`);
  const entries = (typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes).entries || [];
  await c.query("BEGIN");
  try {
    for (const e of [...entries].reverse()) await reverse(c, e);
    await audit(c, { id: rid("al_"), orgId: r.org_id, action: "repair1 undo", changes: { undoes: auditId }, count: entries.length, summary: `REPAIR-1 run ${auditId} undone` });
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  log(`${r.org_id}: run ${auditId} undone, ${entries.length} changes put back.`);
  return { orgId: r.org_id, count: entries.length };
}

async function main(argv = process.argv) {
  const arg = k => (argv.find(a => a.startsWith(`--${k}=`)) || "").slice(k.length + 3) || null;
  const DB_URL = require("../lib/prodGuard").writerDbUrl();
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    if (arg("undo")) await undo({ client, auditId: arg("undo") });
    else await run({ client, orgId: arg("org"), apply: argv.includes("--apply") });
  } finally { client.release(); await pool.end(); }
}

if (require.main === module) main().then(() => process.exit(0), e => { console.error(e.message || e); process.exit(1); });
module.exports = { run, undo, ACTOR, ACTION, SKIP };
