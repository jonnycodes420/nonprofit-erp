#!/usr/bin/env node
// ATLAS-10 item 4 — pending volunteer applications from someone who already volunteers.
//
// Since ATLAS-10 such an application closes as it arrives, and one already waiting is left out of
// the pending list and counts (server/volunteers/alreadyVolunteer.js). The rows already waiting
// still say `pending`. This closes them the way a new one closes: approved onto the person's own
// record, by system:already-volunteer, decided now. Nothing else on the person is touched.
//
// SAFE BY DEFAULT: a dry run unless --apply. A second run finds nothing.
//
// Usage:
//   node scripts/ops/atlas10-close-already-volunteer.js                 # dry run, all orgs
//   node scripts/ops/atlas10-close-already-volunteer.js --org=org_x     # one org
//   node scripts/ops/atlas10-close-already-volunteer.js --apply         # write
"use strict";
const { Pool } = require("pg");
const AV = require("../../server/volunteers/alreadyVolunteer");

const APPLY = process.argv.includes("--apply");
const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;
const DB_URL = require("../lib/prodGuard").writerDbUrl();   // a remote database needs --i-know-this-is-prod (BUILD-55)

async function main() {
  const local = /localhost|127\.0\.0\.1/.test(DB_URL);
  const pool = new Pool({ connectionString: DB_URL, ssl: local ? false : { rejectUnauthorized: false } });
  console.log(`Target DB: ${DB_URL.replace(/:[^:@/]+@/, ":****@")}`);
  console.log(APPLY ? "MODE: APPLY (closes the applications)\n" : "MODE: DRY RUN (no writes)\n");
  const rows = (await pool.query(
    `SELECT a.id, a.org_id, a.name, ${AV.VOLUNTEER_OF("a")} AS person_id FROM volunteer_applications a
      WHERE a.status = 'pending' AND ${AV.VOLUNTEER_OF("a")} IS NOT NULL ${orgArg ? "AND a.org_id = $1" : ""}
      ORDER BY a.org_id, a.submitted_at`, orgArg ? [orgArg] : [])).rows;
  for (const r of rows) console.log(`  ${r.org_id}  ${r.id}  ${r.name} → already volunteers as ${r.person_id}`);
  console.log(`\n${rows.length} pending application(s) from people who already volunteer.`);
  if (APPLY && rows.length) {
    const ids = rows.map(r => r.id);
    const out = await pool.query(
      `UPDATE volunteer_applications a SET status = 'approved', person_id = ${AV.VOLUNTEER_OF("a")}, matched_existing = true,
              decided_at = NOW(), decided_by = $2, decided_by_name = $3
        WHERE a.id = ANY($1::text[]) AND a.status = 'pending' AND ${AV.VOLUNTEER_OF("a")} IS NOT NULL`, [ids, AV.ACTOR.id, AV.ACTOR.name]);
    console.log(`Closed ${out.rowCount}.`);
  } else if (rows.length) console.log("Run again with --apply to close them.");
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
