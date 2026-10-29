#!/usr/bin/env node
// HARDEN-2 item 4 · CLOSE THE DELETION RECORDS OF PEOPLE WHO ARE ALREADY BACK.
//
// A person restored through a door that never closed their deletion record
// (deleted_records, table_name 'donors', restored_at IS NULL) is live but
// still "deleted" (scripts/stale-deletions-readonly.sql counts them). Every door
// closes it now (personTrash.js bringPeopleBack); this closes the ones left
// from before, ONE ORG AT A TIME.
//
// DRY RUN BY DEFAULT: it prints how many people and records, and each record
// id with the person id it names (no names, no emails). --apply sets
// restored_at on exactly those records, inside ONE transaction, and leaves one
// audit row (actor system:scripts/close-stale-deletions) listing them.
// deleted_records has no closer column, so the audit row is the actor stamp.
// Nobody's deleted_at changes: the people are already live. Safe to run twice:
// a second run finds nothing.
//
// Usage:
//   DATABASE_URL=… node scripts/close-stale-deletions.js --org <org id>            # dry run
//   DATABASE_URL=… node scripts/close-stale-deletions.js --org <org id> --apply    # write
// A remote DATABASE_URL also needs --i-know-this-is-prod (scripts/lib/prodGuard).
// The read-only count across every org is scripts/stale-deletions-readonly.sql.
"use strict";
const { Pool } = require("pg");
const crypto = require("crypto");
const { STALE_RECORDS_SQL } = require("../personTrash");

const ACTOR = { id: "system:scripts/close-stale-deletions", name: "Fix: deletion record left open after a restore", kind: "system" };

function orgArg(argv) {
  const i = argv.indexOf("--org");
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const eq = argv.find(a => a.startsWith("--org="));
  return eq ? eq.slice(6) : null;
}

async function main() {
  const ORG = orgArg(process.argv);
  if (!ORG) {
    console.error("REFUSED: --org <org id> is required. This closes one org's records at a time.");
    process.exit(2);
  }
  const { writerDbUrl } = require("./lib/prodGuard");
  const DB_URL = writerDbUrl();
  const APPLY = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: DB_URL,
    ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    console.log(APPLY ? "MODE: APPLY (one transaction)\n" : "MODE: DRY RUN (nothing is written; add --apply to write)\n");
    await client.query(APPLY ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
    const { rows: org } = await client.query(`SELECT id FROM orgs WHERE id = $1`, [ORG]);
    if (!org.length) { console.error(`No org ${ORG}. Nothing done.`); await client.query("ROLLBACK"); process.exitCode = 1; return; }
    const { rows } = await client.query(STALE_RECORDS_SQL + (APPLY ? " FOR UPDATE OF r" : ""), [ORG]);
    const people = new Set(rows.map(r => r.record_id));
    console.log(`${ORG}: ${people.size} live ${people.size === 1 ? "person" : "people"} with ${rows.length} open deletion record${rows.length === 1 ? "" : "s"}`);
    for (const r of rows) console.log(`  ${r.id}  person ${r.record_id}  deleted ${new Date(r.created_at).toISOString()}`);
    if (!APPLY || !rows.length) {
      await client.query("ROLLBACK");
      console.log(`\n${rows.length} record(s) ${APPLY ? "to close: none, nothing written" : "would be closed"}.`);
      return;
    }
    const ids = rows.map(r => r.id);
    const done = await client.query(
      `UPDATE deleted_records SET restored_at = NOW()
        WHERE org_id = $1 AND table_name = 'donors' AND restored_at IS NULL AND id = ANY($2)`, [ORG, ids]);
    if (done.rowCount !== ids.length) throw new Error(`closed ${done.rowCount} of ${ids.length}; rolled back`);
    await client.query(
      `INSERT INTO fin_audit_log
         (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
          changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'close deletion records','donor',NULL,$6,$7,$8,$9,$10,'SCRIPT','scripts/close-stale-deletions.js')`,
      ["al_" + crypto.randomUUID().slice(0, 12), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ restored_at: { from: null, to: "now" } }),
       JSON.stringify({ open: ids }), JSON.stringify({ closed: ids, people: [...people] }),
       `Closed ${ids.length} deletion record${ids.length === 1 ? "" : "s"} of ${people.size} ${people.size === 1 ? "person" : "people"} already back on file`,
       ids.length]);
    await client.query("COMMIT");
    console.log(`\n${ids.length} record(s) closed.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { orgArg };
