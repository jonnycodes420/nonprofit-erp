#!/usr/bin/env node
// FLOWS-15 item 1 (W-1114-Fundraising-17) · THE DEMO'S YEAR-END APPEAL GETS ITS FIRST-GIFT VERSION.
// scripts/seed/email1-demo.js now seeds Harborlight's Year-end appeal with a first-gift version on
// its hero and its thank-you paragraphs (scripts/seed/demoFirstGift.js), so a never-giver reads
// those words and the fleet sees the whole path. This puts the same version on a demo already
// seeded (staging's Harborlight).
//
// org_b72demo only, campaign ecamp_b72_yearend only, and only while it has not been sent and a
// block that thanks the reader still has no version. Never a real org: Steward never writes her
// words for her. A dry run unless --apply; --apply writes through scripts/lib/prodGuard's
// writerDbUrl, and a remote database must also be staging (--staging --staging-api=<url> whose
// /health says env "staging"). Prod is refused.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/flows15-demo-first-gift.js                                   # what it would do
//   DATABASE_URL=… node scripts/ops/flows15-demo-first-gift.js --staging --staging-api=https://<staging api> --apply --i-know-this-is-prod
"use strict";
const { Pool } = require("pg");

const ORG = "org_b72demo";
const CAMPAIGN = "ecamp_b72_yearend";

async function allowedToWrite(url) {
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return true;
  if (!process.argv.includes("--staging")) return false;
  const a = process.argv.find(x => x.startsWith("--staging-api=")), base = a ? a.slice("--staging-api=".length).replace(/\/+$/, "") : "";
  if (!base) return false;
  const h = await fetch(base + "/health", { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  return !!(h && h.env === "staging");
}

async function main() {
  const PG = await import("../../shared/pastGiving.js");
  const { withDemoFirstGift } = require("../seed/demoFirstGift");
  const apply = process.argv.includes("--apply");
  const url = apply ? require("../lib/prodGuard").writerDbUrl() : process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  if (apply && !(await allowedToWrite(url))) { console.error("REFUSED: --apply writes only to a loopback database, or to staging with --staging and --staging-api=<url> (its /health must say env \"staging\")."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    const [c] = (await pool.query(`SELECT id, name, status, email_blocks FROM campaigns WHERE id=$1 AND org_id=$2`, [CAMPAIGN, ORG])).rows;
    if (!c) { console.log(`${CAMPAIGN} is not on this database (${ORG}). Nothing to do.`); return; }
    const blocks = Array.isArray(c.email_blocks) ? c.email_blocks : [];
    const open = PG.openClaims(blocks);
    console.log(`${ORG} · ${c.name} (${c.id}) · ${c.status} · ${open.length} block(s) that thank the reader with no first-gift version${open.length ? `: ${open.map(o => `block ${o.index + 1} ("${o.phrase}")`).join(", ")}` : ""}`);
    if (!open.length) { console.log("Nothing to do."); return; }
    if (c.status === "sent" || c.status === "sending") { console.log("It has gone out; left as it is."); return; }
    const next = withDemoFirstGift(blocks, PG.claimsOf);
    const still = PG.openClaims(next);
    if (still.length) { console.log(`The demo's words do not cover block(s) ${still.map(o => o.index + 1).join(", ")}; left as it is.`); return; }
    if (!apply) { console.log("Dry run: nothing was written. Add --apply to set the demo's first-gift version."); return; }
    const r = await pool.query(`UPDATE campaigns SET email_blocks=$1::jsonb, updated_at=NOW() WHERE id=$2 AND org_id=$3 AND status NOT IN ('sent','sending')`,
      [JSON.stringify(next), CAMPAIGN, ORG]);
    console.log(`Applied: ${r.rowCount} row changed, ${ORG}'s ${CAMPAIGN} only.`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
