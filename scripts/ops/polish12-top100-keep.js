#!/usr/bin/env node
// POLISH-12 item 4 — keep the Top 100 on for every org that already uses it.
//
// Since POLISH-12 the Top 100 is an org setting, orgs.top100_enabled, off for
// every org (server/org/menu.js). An org that already has anyone on its Top
// 100, or chose Top 100 as one of its Major Gifts tabs by hand (orgs.mg_views
// lists it), would lose sight of its list. This turns the setting on for those
// orgs and touches nothing else: no list, place or plan of care changes.
//
// SAFE BY DEFAULT: a dry run (reads only) unless --apply. A second run finds nothing.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/polish12-top100-keep.js                                  # dry run: org id, count, why
//   DATABASE_URL=… node scripts/ops/polish12-top100-keep.js --apply --i-know-this-is-prod    # set the flag
"use strict";
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
// A write needs the prod guard (BUILD-55); a dry run only reads.
const DB_URL = APPLY ? require("../lib/prodGuard").writerDbUrl() : process.env.DATABASE_URL;

async function main() {
  if (!DB_URL) { console.error("Set DATABASE_URL first."); process.exit(1); }
  const local = /localhost|127\.0\.0\.1/.test(DB_URL);
  const pool = new Pool({ connectionString: DB_URL, ssl: local ? false : { rejectUnauthorized: false } });
  console.log(`Target DB: ${DB_URL.replace(/:[^:@/]+@/, ":****@")}`);
  console.log(APPLY ? "MODE: APPLY (turns the Top 100 on)\n" : "MODE: DRY RUN (no writes)\n");
  const rows = (await pool.query(
    `SELECT o.id AS org_id,
            (SELECT COUNT(*)::int FROM portfolio_members m WHERE m.org_id = o.id) AS on_list,
            (o.mg_views IS NOT NULL AND o.mg_views LIKE '%"top100"%') AS chose_tab
       FROM orgs o
      WHERE COALESCE(o.top100_enabled, false) = false
        AND (EXISTS (SELECT 1 FROM portfolio_members m WHERE m.org_id = o.id)
             OR (o.mg_views IS NOT NULL AND o.mg_views LIKE '%"top100"%'))
      ORDER BY o.id`)).rows;
  for (const r of rows) console.log(`  ${r.org_id}  ${r.on_list} on the Top 100${r.chose_tab ? ", Top 100 chosen as a Major Gifts tab" : ""}`);
  console.log(`\n${rows.length} org(s) that use the Top 100 with it off.`);
  if (APPLY && rows.length) {
    const out = await pool.query(`UPDATE orgs SET top100_enabled = true WHERE id = ANY($1::text[]) AND COALESCE(top100_enabled, false) = false`,
      [rows.map(r => r.org_id)]);
    console.log(`Turned on for ${out.rowCount}.`);
  } else if (rows.length) console.log("Run again with --apply --i-know-this-is-prod to turn it on for them.");
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
