#!/usr/bin/env node
// GRANTS-FIX item 4 · LINK THE GRANTS THAT CARRY ONLY A TYPED FUNDER NAME.
//
// Grants written by older paths (the Pipeline's New grant form, the general
// PUT, earlier seeds) have `funder` but no `funder_donor_id`, so Steward
// refused to award them and nothing on screen could link them. This lists,
// per org, what the one resolver (server/grants/funderLink.js) would do for
// each one, and with --apply does the links:
//   "link to existing <name>"   the one organization with exactly that name
//   "create funder <name>"      no record has the name: a new organization
//   "left for a person"         two organizations match, or only a person does
// and lists each Awarded grant with no award recorded ("needs its award
// recorded: left for a person"). It never merges, never renames, never writes
// money and never records an award. One audit row per link. Idempotent: a
// second run finds nothing to link.
//
// Skips sample rows, org_creo (the boot-seed fixture) and org_b72demo (only
// scripts/ci/seed-demo.js writes the demo).
//
// Usage:
//   node scripts/ops/grants-link-funders.js                       # dry run, every org
//   node scripts/ops/grants-link-funders.js --org=<org_id>        # one org
//   node scripts/ops/grants-link-funders.js --apply [--i-know-this-is-prod]
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
const FL = require("../../server/grants/funderLink");

const ACTOR = { id: "system:scripts/ops/grants-link-funders", name: "Fix: link a grant to its funder", kind: "system" };
const SKIP_ORGS = ["org_creo", "org_b72demo"];

// funderLink.js writes `?` placeholders; pg wants $n.
const pgArgs = sql => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
const dbFor = c => ({ q: async (sql, a) => (await c.query(pgArgs(sql), a)).rows, r: async (sql, a) => { const x = await c.query(pgArgs(sql), a); return { changes: x.rowCount }; } });

async function run({ client, apply = false, orgId = null, log = console.log }) {
  const out = { linked: 0, created: 0, left: 0, needsAward: 0, orgs: {} };
  const unlinked = (await client.query(
    `SELECT id, org_id, funder, program, status FROM grants
      WHERE funder_donor_id IS NULL AND is_sample IS NOT TRUE AND NOT (org_id = ANY($1::text[])) AND ($2::text IS NULL OR org_id = $2)
      ORDER BY org_id, funder, id`, [SKIP_ORGS, orgId])).rows;
  const noAward = (await client.query(
    `SELECT id, org_id, funder, program FROM grants
      WHERE LOWER(status) IN ('awarded','active') AND award_pledge_id IS NULL AND is_sample IS NOT TRUE
        AND NOT (org_id = ANY($1::text[])) AND ($2::text IS NULL OR org_id = $2)
      ORDER BY org_id, funder, id`, [SKIP_ORGS, orgId])).rows;
  const orgs = [...new Set([...unlinked, ...noAward].map(r => r.org_id))].sort();
  const db = dbFor(client);
  for (const org of orgs) {
    const o = out.orgs[org] = { linked: [], left: [], needsAward: [] };
    log(`${org}:`);
    if (apply) await client.query("BEGIN");
    try {
      const madeHere = new Map();   // one new record per new name, however many grants carry it
      for (const g of unlinked.filter(r => r.org_id === org)) {
        const key = FL.normName(g.funder);
        let p = madeHere.has(key) ? { action: "link", donorId: madeHere.get(key), donorName: g.funder, createdNow: true } : await FL.planFunder(db, org, g.funder);
        const label = `  ${g.id}  ${g.funder || "(no name)"}${g.program ? " · " + g.program : ""}`;
        if (p.action === "leave") {
          const why = p.why === "ambiguous" ? `${p.matches.length} organizations match` : p.why === "person" ? "only a person has that name" : "no funder name";
          log(`${label}: ${why}: left for a person`);
          o.left.push(g.id); out.left++; continue;
        }
        log(`${label}: ${p.action === "create" ? `create funder ${p.name}` : p.createdNow ? `link to ${p.donorName} (created above)` : `link to existing ${p.donorName}`}`);
        if (p.action === "create") out.created++;
        o.linked.push(g.id); out.linked++;
        if (!apply) { if (p.action === "create") madeHere.set(key, "(new)"); continue; }
        let donorId = p.donorId;
        if (p.action === "create") { donorId = await FL.createFunderOrg(db, org, p.name, ACTOR); madeHere.set(key, donorId); }
        const upd = await client.query(`UPDATE grants SET funder_donor_id=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3 AND funder_donor_id IS NULL`, [donorId, g.id, org]);
        if (!upd.rowCount) continue;
        await client.query(
          `INSERT INTO fin_audit_log
             (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
              changes, before_fields, after_fields, summary, record_count, request_method, request_path)
           VALUES ($1,$2,$3,$4,$5,'linked funder','grant',$6,$7,$8,$9,$10,1,'SCRIPT','scripts/ops/grants-link-funders.js')`,
          ["al_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), org, ACTOR.id, ACTOR.name, ACTOR.kind, g.id,
           JSON.stringify({ funder_donor_id: { from: null, to: donorId } }), JSON.stringify({ funder_donor_id: null }), JSON.stringify({ funder_donor_id: donorId }),
           `Linked the ${g.funder} grant to its funder record${p.action === "create" ? " (added as a new funder)" : ""}.`]);
      }
      for (const g of noAward.filter(r => r.org_id === org)) {
        log(`  ${g.id}  ${g.funder || "(no name)"}${g.program ? " · " + g.program : ""}: Awarded, needs its award recorded: left for a person`);
        o.needsAward.push(g.id); out.needsAward++;
      }
      if (apply) await client.query("COMMIT");
    } catch (e) {
      if (apply) await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  }
  log(`\n${out.linked} grant(s) ${apply ? "linked" : "would be linked"} (${out.created} new funder record(s)), ${out.left} left for a person, ${out.needsAward} awarded grant(s) need their award recorded.`);
  return out;
}

async function main() {
  const { writerDbUrl } = require("../lib/prodGuard");
  const APPLY = process.argv.includes("--apply");
  const DB_URL = APPLY ? writerDbUrl() : (process.env.DATABASE_URL || writerDbUrl());
  const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    console.log(APPLY ? "MODE: APPLY (links only, one transaction per org)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    await run({ client, apply: APPLY, orgId: orgArg });
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { run, SKIP_ORGS };
