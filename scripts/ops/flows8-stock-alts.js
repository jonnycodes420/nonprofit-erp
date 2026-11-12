#!/usr/bin/env node
// FLOWS-8 (W-1112-Fundraising-35X) · PHOTOS THAT STILL CARRY THE OLD ALT TEXT. A DRY RUN BY DEFAULT.
//
// Two of Steward's bundled photos had alt text copied from their source's
// title, not from the picture (shared/stockPhotos.js now describes them):
//   kids/running-in-spring.jpg   "A child running through a sunny field"
//   kids/friends-in-tall-grass.jpg "Three young children together in tall grass"
// A page made before the fix stored the old words with its photo. Listed here:
// giving pages and peer fundraisers (image_meta.alt), the membership cover, and
// any page block (published or draft widgets) carrying either old sentence.
// --apply rewrites the old sentence to the new one in exactly those places and
// nothing else. Skips org_b72demo (seed-demo.js owns it) and org_creo.
//
// Usage:
//   node scripts/ops/flows8-stock-alts.js                 # list, every org
//   node scripts/ops/flows8-stock-alts.js --org=<org_id>  # one org
//   node scripts/ops/flows8-stock-alts.js --apply         # rewrite what the list shows
"use strict";
const { Pool } = require("pg");

const FIXES = [
  ["A child running through a sunny field", "A child in a lilac coat leaping off a rock onto the grass"],
  ["Three young children together in tall grass", "Two small children seen from behind under green trees"],
];
const SKIP_ORGS = ["org_b72demo", "org_creo"];
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
// Each place a picture's alt is kept: the table, its org column, and the JSON column.
const PLACES = [
  { table: "giving_pages", col: "image_meta" },
  { table: "giving_pages", col: "published" },
  { table: "giving_pages", col: "draft" },
  { table: "peer_fundraisers", col: "image_meta" },
  { table: "portal_settings", col: "membership_cover" },
];

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const apply = process.argv.includes("--apply");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  const one = arg("org");
  let found = 0, written = 0;
  try {
    for (const { table, col } of PLACES) {
      const have = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, col])).rows.length;
      if (!have) continue;
      for (const [from, to] of FIXES) {
        const args = [SKIP_ORGS, `%${from}%`, ...(one ? [one] : [])];
        const where = `NOT (org_id = ANY($1)) AND ${col}::text LIKE $2 ${one ? "AND org_id = $3" : ""}`;
        const rows = (await pool.query(`SELECT org_id, ${table === "portal_settings" ? "org_id AS id" : "id"} FROM ${table} WHERE ${where} ORDER BY org_id`, args)).rows;
        for (const r of rows) console.log(`${table}.${col} · ${r.org_id} · ${r.id} · "${from}"`);
        found += rows.length;
        if (apply && rows.length) {
          const u = await pool.query(`UPDATE ${table} SET ${col} = replace(${col}::text, $${args.length + 1}, $${args.length + 2})::jsonb WHERE ${where}`, [...args, from, to]);
          written += u.rowCount;
        }
      }
    }
    console.log(`\n${found} place(s) carry an old alt sentence.`);
    console.log(apply ? `${written} row(s) rewritten to the photo's own description.` : "Dry run: nothing was written. Add --apply to rewrite them.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
