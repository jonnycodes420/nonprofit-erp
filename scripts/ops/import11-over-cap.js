#!/usr/bin/env node
// IMPORT-11 item 2 — gifts already stored over the cap ($100,000,000.00, money.js MAX_CENTS).
//
// The import had no cap, so a gift of $1,000,000,000 could be written, and every
// reader that went through toCents() then turned it into $0. Since IMPORT-11 no
// door can write one (the import sets the row aside, the gift form refuses it,
// and ck_gifts_amount_within_cap refuses the write), but rows written before
// stay as they are: nothing changes at deploy. This lists them, by org id and
// count only (no names, no amounts per person), for Jonathan to decide each.
//
// READ ONLY. The session is set read-only before the one SELECT; it never writes.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/import11-over-cap.js
"use strict";
const { Pool } = require("pg");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("Set DATABASE_URL."); process.exit(2); }

async function main() {
  const local = /localhost|127\.0\.0\.1/.test(DB_URL);
  const pool = new Pool({ connectionString: DB_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 1 });
  const c = await pool.connect();
  try {
    console.log(`Target DB: ${DB_URL.replace(/:[^:@/]+@/, ":****@")}`);
    console.log("MODE: READ ONLY (no writes)\n");
    await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    const { rows } = await c.query(
      `SELECT g.org_id, COUNT(*)::int AS gifts, COUNT(DISTINCT g.donor_id)::int AS people,
              COUNT(*) FILTER (WHERE g.import_id IS NOT NULL)::int AS from_imports
         FROM gifts g
        WHERE abs(g.amount) > 100000000
        GROUP BY g.org_id ORDER BY g.org_id`);
    for (const r of rows) console.log(`  ${r.org_id}  ${r.gifts} gift(s) over the cap, on ${r.people} person(s), ${r.from_imports} from an import`);
    console.log(`\n${rows.reduce((n, r) => n + r.gifts, 0)} gift(s) over $100,000,000 in ${rows.length} org(s).`);
    console.log("Each one shows as $0 wherever a reader refused it. Undo its import, or delete or correct the gift, from the app.");
  } finally { c.release(); await pool.end(); }
}

main().catch(e => { console.error(e); process.exit(1); });
