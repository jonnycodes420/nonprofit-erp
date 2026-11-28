#!/usr/bin/env node
// scripts/ops/fresh5-stuck-lapsed.js · FRESH-5 item 3. WHO IS STILL LAPSED ON THE LIST BUT CURRENT ON THE PROFILE.
//
// Before FRESH-5 only a NEW gift took somebody Steward had placed in Lapsed out of it. A gift whose date was
// edited into the last 12 months, or one put back by Undo, left the stored stage at Lapsed for good, so the
// Donors list's Stage said Lapsed while the profile said Current (W-1112-Volunteers-01X, "Epsilon").
// FRESH-5 settles it on every write to the person, and the nightly sweep (autoLapseOrg →
// unlapseHeldByPledge, the "own giving" branch FRESH-5 added) moves the rows that already exist, with the
// usual automatic move and its line. This script only COUNTS them, per org, so the first sweep's moves can
// be checked against it. Read-only: it writes nothing and takes no --apply.
//
//   DATABASE_URL=… node scripts/ops/fresh5-stuck-lapsed.js              # every org
//   DATABASE_URL=… node scripts/ops/fresh5-stuck-lapsed.js --org=org_x  # one org
"use strict";
if (!process.env.DATABASE_URL) { console.error("REFUSED: set DATABASE_URL first."); process.exit(2); }
const ORG = (process.argv.find(a => a.startsWith("--org=")) || "").slice(6) || null;

async function main() {
  const { query, closePool } = require("../../db");
  const LAPSE = require("../../shared/numbers/lapse");
  const { orgToday } = require("../../orgTime");
  const orgs = await query(`SELECT id, timezone FROM orgs WHERE (?::text IS NULL OR id = ?) ORDER BY id`, [ORG, ORG]);
  let total = 0;
  for (const o of orgs) {
    const today = orgToday({ timezone: o.timezone || "America/New_York" });
    const lapsedNow = LAPSE.lapsedSql("d.last_gift_date", today, "d.id");
    const [r] = await query(
      `SELECT COUNT(*)::int AS n FROM donors d
        WHERE d.org_id=? AND d.deleted_at IS NULL AND d.stage='lapsed'
          AND d.gift_count > 0 AND d.last_gift_date IS NOT NULL AND d.last_gift_date <> ''
          AND NOT ${lapsedNow.sql}
          AND NOT EXISTS (SELECT 1 FROM moves m WHERE m.org_id=d.org_id AND m.donor_id=d.id
                            AND m.officer_id IS NOT NULL AND m.to_stage='lapsed')`,
      [o.id, ...lapsedNow.args]);
    if (r.n) console.log(`${o.id}: ${r.n} ${r.n === 1 ? "person reads" : "people read"} Lapsed on the list and Current on the profile`);
    total += r.n;
  }
  console.log(`dry run: ${total} in all, across ${orgs.length} org(s). Nothing was changed; tonight's sweep moves them (200 per org a night).`);
  if (closePool) await closePool();
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
