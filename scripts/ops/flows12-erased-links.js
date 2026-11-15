#!/usr/bin/env node
// FLOWS-12 item 5 (W-1114-Finance-29X) · ERASED PEOPLE STILL LINKED TO A HOUSEHOLD OR AN OFFICER.
//
// erasePerson (personData.js) keeps the record and its gifts and clears everything that is about
// the person, but it leaves donors.household_id and donors.assigned_to as they were. FLOWS-12 makes
// every picker and every portfolio count read past an erased person (shared/numbers/pickable.js),
// so these rows no longer show anywhere they were reported. This lists them, so REPAIR-1 can decide
// whether to clear the two columns. READ ONLY: there is no --apply; it writes nothing.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/flows12-erased-links.js            # every org
//   DATABASE_URL=… node scripts/ops/flows12-erased-links.js org_x      # one org
"use strict";
const { Pool } = require("pg");

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const org = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : null;
  const pool = new Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await pool.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const { rows } = await pool.query(
      `SELECT d.org_id, d.id, d.household_id, d.assigned_to, LEFT(d.erased_at::text, 10) AS erased_on
         FROM donors d
        WHERE d.erased_at IS NOT NULL AND d.deleted_at IS NULL AND (d.household_id IS NOT NULL OR d.assigned_to IS NOT NULL)
          AND ($1::text IS NULL OR d.org_id = $1)
        ORDER BY d.org_id, d.erased_at`, [org]);
    const byOrg = new Map();
    for (const r of rows) byOrg.set(r.org_id, [...(byOrg.get(r.org_id) || []), r]);
    console.log(`${rows.length} erased ${rows.length === 1 ? "record is" : "records are"} still linked (dry run: nothing is changed).`);
    for (const [o, list] of byOrg) {
      console.log(`\n${o}: ${list.filter(r => r.household_id).length} in a household, ${list.filter(r => r.assigned_to).length} assigned to an officer`);
      for (const r of list) console.log(`  ${r.id}  erased ${r.erased_on}${r.household_id ? `  household ${r.household_id}` : ""}${r.assigned_to ? `  assigned ${r.assigned_to}` : ""}`);
    }
    console.log("\nThe repair, when REPAIR-1 takes it: UPDATE donors SET household_id=NULL, assigned_to=NULL WHERE erased_at IS NOT NULL (per org, audited).");
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
