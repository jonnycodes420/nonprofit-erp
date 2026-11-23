#!/usr/bin/env node
// scripts/ops/staging-trash-tidy.js · TRASH-1 item 6. STAGING'S TRASH IS A SAFETY NET AGAIN.
//
// The QA walkers delete what they make, every night, so staging's Trash fills
// with their rows and a real slip on staging is lost among them. This lists
// the trash rows the walkers made and, with --apply, deletes them for good
// through the one purge (server/donors/records.js purgePeople, the same one
// Empty trash and the 30-day clear-out use).
//
// A walker's row is:
//   · anything in org_stagewalk's trash (the CI walk's own org: everyone in it is made up);
//   · in any other staging org, a person in the trash whose trash row was
//     written by a system identity (created_by 'system:…'), whose email is on
//     the walkers' domain (@walk.staging.invalid), or whose name carries a
//     walker's marker ("QA …", "Walk …", "Trash Walk …", "Quokka Walk …");
//   · a non-person trash row (deleted_records) a system identity wrote.
//
// It refuses to run anywhere but staging, on three separate checks:
//   1. the --staging flag;
//   2. STEWARD_ENV must be "staging" (NODE_ENV alone cannot tell staging from
//      prod: both run "production"), and NODE_ENV=production without it is refused;
//   3. the database: the API at BASE (RAILWAY_PUBLIC_DOMAIN) must say /health
//      env "staging" and serve the very database this connection opened.
// Without --apply it writes nothing (a dry run, the default).
//
// Run (from the checkout linked to Railway; the secret is never printed):
//   railway run --environment staging --service web -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/ops/staging-trash-tidy.js --staging'
//   …and the same with --apply to delete them for good.
"use strict";
const { Client } = require("pg");
const path = require("path");
const guard = require("../lib/prodGuard");

const WALK_ORG = "org_stagewalk";
const WALK_DOMAIN = "@walk.staging.invalid";
const WALK_NAME = /^(qa\b|walk\b|trash walk\b|quokka walk\b|stagewalk\b)/i;

// Pure, so a test can hold it: is this trashed person a walker's?
function isWalkerPerson(p) {
  if (p.org_id === WALK_ORG) return true;
  if (String(p.created_by || "").startsWith("system:")) return true;
  if (String(p.email || "").toLowerCase().endsWith(WALK_DOMAIN)) return true;
  return WALK_NAME.test(String(p.name || "").trim());
}

function refuse(msg) { console.error("REFUSED: " + msg); process.exit(1); }

async function main() {
  const argv = process.argv, env = process.env;
  const apply = argv.includes("--apply");
  if (!argv.includes(guard.STAGING_FLAG)) refuse(`pass ${guard.STAGING_FLAG}. This script reads staging, and with --apply deletes there, nowhere else.`);
  const stewardEnv = String(env.STEWARD_ENV || "").trim().toLowerCase();
  if (stewardEnv !== "staging") refuse(`STEWARD_ENV is "${stewardEnv || "<unset>"}"${env.NODE_ENV === "production" ? " and NODE_ENV is production" : ""}. Only staging's own environment may run this.`);
  const DB = env.DATABASE_URL;
  if (!DB) refuse("DATABASE_URL is not set.");
  if (/localhost|127\.0\.0\.1/.test(DB) && apply) refuse("a local database is not staging; --apply is for staging only.");
  const BASE = env.BASE || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : "");
  if (!BASE) refuse("BASE (or RAILWAY_PUBLIC_DOMAIN) is not set, so the database cannot be checked against the staging API.");
  const health = guard.assertServerIdentity(BASE);
  if (health.env !== "staging") refuse(`${BASE}/health says env "${health.env}". Only staging.`);

  const client = new Client({ connectionString: DB, ssl: /localhost|127\.0\.0\.1/.test(DB) ? false : { rejectUnauthorized: false } });
  await client.connect();
  const q = (sql, p = []) => client.query(sql, p).then(r => r.rows);
  const [{ current_database: dbName }] = await q("SELECT current_database()");
  if (dbName !== health.database) { await client.end(); refuse(`${BASE} serves database "${health.database}" but this connection is to "${dbName}".`); }

  const { IN_TRASH } = require("../../shared/numbers/trash");
  const people = await q(`
    SELECT d.org_id, d.id, d.name, d.email, r.created_by
      FROM donors d
      LEFT JOIN LATERAL (SELECT x.created_by FROM deleted_records x WHERE x.org_id = d.org_id AND x.table_name = 'donors' AND x.record_id = d.id
                          ORDER BY (x.restored_at IS NULL) DESC, x.created_at DESC LIMIT 1) r ON true
     WHERE ${IN_TRASH("d")}
     ORDER BY d.org_id, d.deleted_at`);
  const walkers = people.filter(isWalkerPerson);
  const rows = await q(`
    SELECT org_id, id, table_name FROM deleted_records
     WHERE restored_at IS NULL AND table_name <> 'donors' AND (org_id = $1 OR created_by LIKE 'system:%')
     ORDER BY org_id, created_at`, [WALK_ORG]);

  const byOrg = new Map();
  for (const p of walkers) { const o = byOrg.get(p.org_id) || { people: [], rows: 0 }; o.people.push(p); byOrg.set(p.org_id, o); }
  for (const r of rows) { const o = byOrg.get(r.org_id) || { people: [], rows: 0 }; o.rows++; byOrg.set(r.org_id, o); }
  console.log(`[staging] ${BASE} is staging, database "${dbName}". ${apply ? "APPLYING." : "Dry run: nothing is written."}`);
  console.log(`[staging] ${people.length} people in the trash across staging; ${walkers.length} are the walkers'. ${rows.length} other trash rows are the walkers'.`);
  for (const [org, o] of byOrg) {
    console.log(`  ${org}: ${o.people.length} people, ${o.rows} other rows`);
    for (const p of o.people.slice(0, 10)) console.log(`    · ${p.name}${p.email ? " <" + p.email + ">" : ""} (by ${p.created_by || "unknown"})`);
    if (o.people.length > 10) console.log(`    · …and ${o.people.length - 10} more`);
  }
  if (!apply) { await client.end(); console.log("[staging] dry run. Run again with --apply to delete these for good."); return; }

  // The one purge, as Empty trash runs it: records.js is mounted with the
  // database's own helpers (its routes are built and never served).
  process.env.DISABLE_BACKGROUND_TICKS = "1";
  const db = require("../../db");
  const records = require("../../server/donors/records");
  const noop = () => {};
  const ctx = new Proxy({ ...db }, { get: (t, k) => (k in t ? t[k] : (typeof k === "string" && /^[a-z]/.test(k) ? noop : undefined)) });
  records.mount(ctx);
  let purged = 0;
  for (const [org, o] of byOrg) {
    if (o.people.length) purged += (await records.purgePeople(org, o.people.map(p => p.id))).purged;
  }
  const gone = rows.length ? await q(`DELETE FROM deleted_records WHERE id = ANY($1) AND restored_at IS NULL RETURNING id`, [rows.map(r => r.id)]) : [];
  await client.end();
  console.log(`[staging] deleted for good: ${purged} people and ${gone.length} other trash rows.`);
  process.exit(0);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { isWalkerPerson, WALK_ORG, WALK_DOMAIN };
