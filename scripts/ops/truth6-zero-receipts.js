#!/usr/bin/env node
// TRUTH-6 · ROWS WRITTEN BEFORE THIS BUILD THAT STILL CARRY THE OLD STATE. A DRY RUN; IT WRITES NOTHING.
//
//   1. receipts   an issued gift receipt (not voided) whose gift is now $0,
//                 refunded in full, or gone (W-1107-Donors-21X: "Marlowe's $0
//                 gift still carries a $200 receipt"). A $0 gift has no
//                 receipt. The receipt and the gift both say "Void this
//                 receipt" (server/receipts/drift.js); a person voids it there.
//                 Receipts are snapshots the IRS requires us to keep, so this
//                 never voids or edits one.
//   2. scheduled  a gift dated after the org's today that is not stored as
//                 scheduled (gifts.scheduled_on is NULL): written by hand
//                 before this build, so it counted in Lifetime, Last gift and
//                 the year's totals before its date. The SQL to store each as
//                 scheduled is printed for Jonathan to run; this script runs
//                 nothing.
//
// Reads every org except org_b72demo (seed-demo.js owns it). org_creo is
// listed, never written (nothing here writes).
//
// Usage:
//   node scripts/ops/truth6-zero-receipts.js                 # every org
//   node scripts/ops/truth6-zero-receipts.js --org=<org_id>  # one org
"use strict";
const { Pool } = require("pg");

const SKIP_ORGS = ["org_b72demo"];
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const usd = c => "$" + (Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply. A person voids each receipt from its own screen."); process.exit(2); }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  const one = arg("org");
  const args = one ? [SKIP_ORGS, one] : [SKIP_ORGS];
  try {
    const rows = (await pool.query(
      `SELECT r.id, r.org_id, r.receipt_number, ROUND(r.amount * 100)::bigint AS receipt_cents, r.gift_id,
              g.id AS gid, ROUND(g.amount * 100)::bigint AS gift_cents, g.refunded_in_full, d.name
         FROM receipts r
         LEFT JOIN gifts g ON g.id = r.gift_id AND g.org_id = r.org_id
         LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
        WHERE r.type = 'gift' AND r.voided_at IS NULL AND r.gift_id IS NOT NULL
          AND (g.id IS NULL OR g.amount <= 0 OR g.refunded_in_full IS TRUE)
          AND NOT (r.org_id = ANY($1)) ${one ? "AND r.org_id = $2" : ""}
        ORDER BY r.org_id, r.created_at`, args)).rows;
    console.log(`1 · issued receipts on a gift that is now $0, refunded in full or gone: ${rows.length}`);
    for (const r of rows) {
      const now = !r.gid ? "no longer on file" : r.refunded_in_full ? "refunded in full" : `now ${usd(r.gift_cents)}`;
      console.log(`  ${r.org_id} · receipt ${r.receipt_number || r.id} · ${r.name || "(no name)"} · says ${usd(r.receipt_cents)} · gift ${now} → Void this receipt (the person's Receipts tab)`);
    }
    const hasCol = (await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='gifts' AND column_name='scheduled_on'`)).rows.length > 0;
    const future = (await pool.query(
      `SELECT g.id, g.org_id, LEFT(g.date, 10) AS date, ROUND(g.amount * 100)::bigint AS cents, d.name
         FROM gifts g JOIN orgs o ON o.id = g.org_id
         LEFT JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
        WHERE LEFT(g.date, 10) > to_char(NOW() AT TIME ZONE COALESCE(NULLIF(o.timezone, ''), 'America/New_York'), 'YYYY-MM-DD')
          ${hasCol ? "AND g.scheduled_on IS NULL" : ""}
          AND NOT (g.org_id = ANY($1)) ${one ? "AND g.org_id = $2" : ""}
        ORDER BY g.org_id, g.date`, args)).rows;
    console.log(`\n2 · gifts dated after today not stored as scheduled: ${future.length}`);
    for (const g of future) console.log(`  ${g.org_id} · ${g.name || "(no name)"} · ${usd(g.cents)} dated ${g.date} · gift ${g.id}`);
    if (future.length) console.log("\n  To store these as scheduled, set each one's scheduled_on to its date (the statement is in the TRUTH-6 report, For Jonathan).");
    console.log("\nDry run: nothing was written.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
