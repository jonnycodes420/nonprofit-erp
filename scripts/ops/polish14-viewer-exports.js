#!/usr/bin/env node
// POLISH-14 item 5 — the orgs whose view-only people can still export by the old default.
//
// Since POLISH-14 a NEW org starts with "Viewers can export" off (orgs.viewer_exports_off
// defaults to true). Every org that existed before keeps the old setting, on, because the
// deploy writes no rows. Whether to turn it off for them is Jonathan's decision
// (docs/needs-jonathan/POLISH-14.md). This counts them, and, only with --apply, turns
// the setting off for exactly those orgs; an org's admin can turn it back on in
// Settings → Team. Nothing else changes.
//
// SAFE BY DEFAULT: a dry run (reads only) unless --apply. A second run finds nothing.
//
// Usage:
//   DATABASE_URL=… node scripts/ops/polish14-viewer-exports.js                                  # dry run: how many, with viewers
//   DATABASE_URL=… node scripts/ops/polish14-viewer-exports.js --apply --i-know-this-is-prod    # turn it off for them
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
  console.log(APPLY ? "MODE: APPLY (turns Viewers can export off)\n" : "MODE: DRY RUN (no writes)\n");
  const [r] = (await pool.query(
    `SELECT COUNT(*)::int AS orgs,
            COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM users u WHERE u.org_id = o.id AND u.role = 'viewer')
                             OR EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = o.id AND m.role = 'viewer' AND m.revoked_at IS NULL))::int AS with_viewers
       FROM orgs o WHERE o.viewer_exports_off IS NOT TRUE`)).rows;
  console.log(`${r.orgs} org(s) still let view-only people export (the old default); ${r.with_viewers} of them have a view-only person today.`);
  if (APPLY && r.orgs) {
    const out = await pool.query(`UPDATE orgs SET viewer_exports_off = true WHERE viewer_exports_off IS NOT TRUE`);
    console.log(`Turned off for ${out.rowCount}.`);
  } else if (r.orgs) console.log("Run again with --apply --i-know-this-is-prod to turn it off for them (only on Jonathan's decision).");
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
