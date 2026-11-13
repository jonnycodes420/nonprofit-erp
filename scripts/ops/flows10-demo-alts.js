#!/usr/bin/env node
// FLOWS-10 (W-1112-Fundraising-35X, repeat) · THE DEMO'S PHOTOS WHOSE ALT TEXT DESCRIBES ANOTHER PICTURE.
//
// FLOWS-8 fixed the bundled catalog and listed old pages (flows8-stock-alts.js), but that script
// skips org_b72demo and has no --apply, and the Year-end photo is not a catalog photo at all: it is
// the demo asset demo-campaign-chapel.jpg (a chapel with a steeple on a hill at dusk), seeded by
// scripts/seed/fix41-media.js and email1-demo.js as "A sunlit hall with tall windows". Both seeds
// now say what the photo shows; this puts the rows already made right, in the demo org only.
//
// It changes alt text and nothing else, in org_b72demo only, and only where the old sentence is.
// A dry run unless --apply. --apply goes through scripts/lib/prodGuard's writerDbUrl, and a remote
// database must also be staging: --staging with --staging-api=<url> of a server whose /health says env "staging".
// Prod is refused.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/flows10-demo-alts.js                                  # list
//   DATABASE_URL=… node scripts/ops/flows10-demo-alts.js --staging --staging-api=https://<staging api> --apply --i-know-this-is-prod
"use strict";
const { Pool } = require("pg");

const ORG = "org_b72demo";
const FIXES = [
  ["A sunlit hall with tall windows and wooden benches", "A small chapel with a bell tower on a grassy hill at dusk"],
  ["A sunlit hall with tall windows", "A small chapel with a bell tower on a grassy hill at dusk"],
];
// Each place an alt is kept: table, column, and whether the column is JSON.
const PLACES = [
  { table: "media_items", col: "alt", json: false },
  { table: "giving_pages", col: "image_meta", json: true },
  { table: "giving_pages", col: "published", json: true },
  { table: "giving_pages", col: "draft", json: true },
  { table: "events", col: "hero_meta", json: true },
  { table: "auction_items", col: "photos", json: true },
];

async function allowedToWrite(url) {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return true;
  if (!process.argv.includes("--staging")) return false;
  const a = process.argv.find(x => x.startsWith("--staging-api=")), base = a ? a.slice("--staging-api=".length).replace(/\/+$/, "") : "";
  if (!base) return false;
  const h = await fetch(base + "/health", { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  return !!(h && h.env === "staging");
}

async function main() {
  const apply = process.argv.includes("--apply");
  // --apply writes through the prod guard (a remote database needs --i-know-this-is-prod), and on top
  // of it a remote target must say it is staging. A dry run only reads.
  const url = apply ? require("../lib/prodGuard").writerDbUrl() : process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  if (apply && !(await allowedToWrite(url))) { console.error("REFUSED: --apply writes only to a loopback database, or to staging with --staging and --staging-api=<url> (its /health must say env \"staging\")."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  let found = 0, changed = 0;
  try {
    for (const { table, col, json } of PLACES) {
      const have = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, col])).rows.length;
      if (!have) continue;
      for (const [from, to] of FIXES) {
        const rows = (await pool.query(`SELECT id FROM ${table} WHERE org_id=$1 AND ${col}::text LIKE $2 ORDER BY id`, [ORG, `%${from}%`])).rows;
        for (const r of rows) console.log(`${table}.${col} · ${r.id} · "${from}" → "${to}"`);
        found += rows.length;
        if (apply && rows.length) {
          const set = json ? `${col} = replace(${col}::text, $3, $4)::jsonb` : `${col} = replace(${col}, $3, $4)`;
          const r = await pool.query(`UPDATE ${table} SET ${set} WHERE org_id=$1 AND ${col}::text LIKE $2`, [ORG, `%${from}%`, from, to]);
          changed += r.rowCount;
        }
      }
    }
    console.log(`\n${found} place(s) in ${ORG} carry an alt that describes another picture.`);
    console.log(apply ? `Applied: ${changed} row(s) changed, alt text only.` : "Dry run: nothing was written. Add --apply to put them right.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
