#!/usr/bin/env node
// IMPORT-13 — rows already stored in the shapes the import gauntlet found (27 Nov).
//
// IMPORT-13 stops new ones: a gift ID twice in one file lands once, an
// unreadable date is set aside unless she says "Import them undated", and a
// workbook's Pledges sheet keyed by name writes its pledges. Rows written before
// stay exactly as they are (nothing changes at deploy). This counts them, per
// org, for Jonathan to decide each with the org:
//   1. possible repeated gifts within one import: two or more gifts from the
//      same import on the same person, amount and date (the one reader did not
//      keep a gift's ID before IMPORT-13, so a resent ID looks like this; so do
//      real twins, which are right: check each against the old system)
//   2. undated gifts whose file had words in the date cell ("Date in your file: …"
//      on the gift's note), not a blank and not a fiscal year like "FY26"
//   3. workbook imports whose Pledges sheet wrote nothing (the run's own
//      semantics counted 0 pledges and left a pledge unresolved)
// It prints org ids and counts only, never a name, an email or an amount per person.
//
// READ ONLY. The session is set read-only before the SELECTs; it never writes.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/import13-gauntlet-rows.js
"use strict";
const { Pool } = require("pg");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("Set DATABASE_URL."); process.exit(2); }

const SQL = {
  repeated: `SELECT org_id, COUNT(*)::int AS groups, SUM(n - 1)::int AS extra
               FROM (SELECT org_id, import_id, donor_id, amount, date, COUNT(*) AS n FROM gifts
                      WHERE import_id IS NOT NULL AND amount > 0 AND date IS NOT NULL
                      GROUP BY 1, 2, 3, 4, 5 HAVING COUNT(*) > 1) t
              GROUP BY org_id ORDER BY org_id`,
  unreadable: `SELECT org_id, COUNT(*)::int AS gifts FROM gifts
                WHERE date IS NULL AND import_id IS NOT NULL AND notes ~ 'Date in your file: '
                  AND notes !~* 'Date in your file: (FY ?''?\\d{2,4}|fiscal)'
                GROUP BY org_id ORDER BY org_id`,
  pledges: `SELECT org_id, COUNT(*)::int AS imports FROM imports
             WHERE shape IN ('workbook', 'both') AND reversed_at IS NULL
               AND COALESCE((summary_json->'semantics'->>'pledges')::int, 0) = 0
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(summary_json->'semantics'->'unresolved', '[]'::jsonb)) x WHERE x->>'kind' = 'pledge')
             GROUP BY org_id ORDER BY org_id`,
};

async function main() {
  const local = /localhost|127\.0\.0\.1/.test(DB_URL);
  const pool = new Pool({ connectionString: DB_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 1 });
  const c = await pool.connect();
  try {
    console.log(`Target DB: ${DB_URL.replace(/:[^:@/]+@/, ":****@")}`);
    console.log("MODE: READ ONLY (no writes)\n");
    await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const rep = (await c.query(SQL.repeated)).rows, und = (await c.query(SQL.unreadable)).rows, pl = (await c.query(SQL.pledges)).rows;
    console.log("1. Possible repeated gifts within one import (same import, person, amount and date):");
    for (const r of rep) console.log(`  ${r.org_id}  ${r.groups} group(s), ${r.extra} gift(s) beyond the first`);
    console.log(`\n2. Undated gifts whose file had words in the date cell:`);
    for (const r of und) console.log(`  ${r.org_id}  ${r.gifts} gift(s)`);
    console.log(`\n3. Workbook imports whose Pledges sheet wrote nothing:`);
    for (const r of pl) console.log(`  ${r.org_id}  ${r.imports} import(s)`);
    console.log(`\n${rep.length + und.length + pl.length === 0 ? "Nothing found." : "Each is decided with the org in the app: undo the import and bring the file in again, date or delete a gift, or record the pledge."}`);
  } finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
