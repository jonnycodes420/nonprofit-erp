#!/usr/bin/env node
// FLOWS-10 (Area 5 Check 17) · THE DEMO'S PLACEHOLDER EIN. Harborlight was seeded with 00-0000000,
// so the receipts check could never pass on the demo. scripts/ci/seed-demo.js now seeds the made-up
// shared/demoEin.js DEMO_EIN; this puts it on a demo already seeded (staging's Harborlight).
//
// org_b72demo only, and only while its EIN is a placeholder (shared/placeholderCopy.js). Never a
// real org. A dry run unless --apply; --apply writes through scripts/lib/prodGuard's writerDbUrl,
// and a remote database must also be staging (--staging --staging-api=<url> whose /health says env
// "staging"). Prod is refused.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/flows10-demo-ein.js                                   # what it would do
//   DATABASE_URL=… node scripts/ops/flows10-demo-ein.js --staging --staging-api=https://<staging api> --apply --i-know-this-is-prod
"use strict";
const { Pool } = require("pg");

const ORG = "org_b72demo";

async function allowedToWrite(url) {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return true;
  if (!process.argv.includes("--staging")) return false;
  const a = process.argv.find(x => x.startsWith("--staging-api=")), base = a ? a.slice("--staging-api=".length).replace(/\/+$/, "") : "";
  if (!base) return false;
  const h = await fetch(base + "/health", { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  return !!(h && h.env === "staging");
}

async function main() {
  const { DEMO_EIN } = await import("../../shared/demoEin.js");
  const { isPlaceholderEin } = await import("../../shared/placeholderCopy.js");
  const apply = process.argv.includes("--apply");
  const url = apply ? require("../lib/prodGuard").writerDbUrl() : process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  if (apply && !(await allowedToWrite(url))) { console.error("REFUSED: --apply writes only to a loopback database, or to staging with --staging and --staging-api=<url> (its /health must say env \"staging\")."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    const [o] = (await pool.query(`SELECT id, name, ein FROM orgs WHERE id=$1`, [ORG])).rows;
    if (!o) { console.log(`${ORG} is not on this database. Nothing to do.`); return; }
    const placeholder = !o.ein || isPlaceholderEin(o.ein);
    console.log(`${o.id} · ${o.name} · EIN ${o.ein || "(none)"}${placeholder ? ` → ${DEMO_EIN}` : " (a real-shaped EIN already; left as it is)"}`);
    if (!placeholder) return;
    if (!apply) { console.log("Dry run: nothing was written. Add --apply to set it."); return; }
    const r = await pool.query(`UPDATE orgs SET ein=$1 WHERE id=$2 AND (ein IS NULL OR ein=$3)`, [DEMO_EIN, ORG, o.ein || null]);
    console.log(`Applied: ${r.rowCount} row changed, ${ORG}'s EIN only.`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
