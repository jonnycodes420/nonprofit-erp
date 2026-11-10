#!/usr/bin/env node
// MONEY-4 (W-1109-Fundraising-35X) · ORGS WHOSE STORED EIN COPIES DIFFER. DRY RUN ONLY.
//
// The EIN lives in one place now: orgs.ein (Settings, Tax Receipts). The giving
// page footer used to read its own typed copy (portal_settings.ein_line), so a
// form could say 84-2917365 while receipts and the Year-end editor said
// 82-4331907. Since MONEY-4 nothing reads that copy; this lists the orgs where
// it differed, so whoever runs it knows which public pages changed EIN on the
// deploy and can check that orgs.ein is the right one. It writes nothing.
//
// Also listed: orgs with no EIN in Settings that had one typed only in the
// editor (their footer now shows none until it is entered in Settings).
// Skips org_creo and org_b72demo.
//
//   node scripts/ops/money4-ein-copies.js
"use strict";
const { Pool } = require("pg");
const SKIP_ORGS = ["org_creo", "org_b72demo"];
const digits = v => String(v || "").replace(/\D/g, "");

async function run({ client, log = console.log }) {
  const { rows } = await client.query(
    `SELECT o.id, o.name, o.ein, ps.ein_line FROM orgs o JOIN portal_settings ps ON ps.org_id = o.id
      WHERE NULLIF(trim(COALESCE(ps.ein_line, '')), '') IS NOT NULL AND NOT (o.id = ANY($1::text[])) ORDER BY o.id`, [SKIP_ORGS]);
  const out = [];
  for (const r of rows) {
    const s = digits(r.ein), t = digits(r.ein_line);
    if (s && t === s) continue;
    const kind = !s ? "settings_empty" : "differs";
    out.push({ orgId: r.id, kind, settings: r.ein || null, editorLine: r.ein_line });
    log(`  ${r.id}  ${r.name}: ${kind === "differs" ? `Settings says ${r.ein}, the editor's copy said "${r.ein_line}"` : `no EIN in Settings, the editor's copy said "${r.ein_line}"`}`);
  }
  log(`\n${out.length} org(s) whose stored EIN copies differ. Nothing was written.`);
  return out;
}

async function main() {
  const { writerDbUrl } = require("../lib/prodGuard");
  const DB_URL = process.env.DATABASE_URL || writerDbUrl();
  const pool = new Pool({ connectionString: DB_URL, ssl: process.env.DB_SSL === "disable" || /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  let code = 0;
  try { console.log("MODE: DRY RUN (this script only reads)\n"); await run({ client }); }
  catch (e) { console.error(e); code = 1; }
  finally { client.release(); await pool.end(); }
  process.exit(code);
}
if (require.main === module) main();
module.exports = { run };
