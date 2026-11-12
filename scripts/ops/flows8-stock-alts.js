#!/usr/bin/env node
// FLOWS-8 (W-1112-Fundraising-35X) · PHOTOS THAT STILL CARRY THE OLD ALT TEXT. A DRY RUN; IT WRITES NOTHING.
//
// Two of Steward's bundled photos had alt text copied from their source's
// title, not from the picture (shared/stockPhotos.js now describes them):
//   kids/running-in-spring.jpg   "A child running through a sunny field"
//   kids/friends-in-tall-grass.jpg "Three young children together in tall grass"
// A page made before the fix stored the old words with its photo. Listed here:
// giving pages and peer fundraisers (image_meta.alt), the membership cover, and
// any page block (published or draft widgets) carrying either old sentence.
// It lists, and writes nothing: each page's alt is put right by choosing its
// photo again in the editor (the alt follows the photo), or by Jonathan after
// reading the list. Skips org_b72demo (seed-demo.js owns it) and org_creo.
//
// Usage:
//   node scripts/ops/flows8-stock-alts.js                 # list, every org
//   node scripts/ops/flows8-stock-alts.js --org=<org_id>  # one org
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
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply."); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  const one = arg("org");
  let found = 0;
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
        if (rows.length) console.log(`  the photo's own words: "${to}"`);
      }
    }
    console.log(`\n${found} place(s) carry an old alt sentence.`);
    console.log("Dry run: nothing was written.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
