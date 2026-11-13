#!/usr/bin/env node
// FLOWS-10 item 4 (W-1113-Fundraising-29X) · STEPS A STOP LEFT READING "DONE". A DRY RUN; IT WRITES NOTHING.
//
// Before FLOWS-10, stopping one person's journey (POST /plans/:id/stop) closed the open step's
// Thread as dismissed, so the person's Tasks read that step "Done" on the stop's day, and the
// steps not yet open stayed "pending" under a stopped journey. A stop now skips them all
// ("Skipped, journey stopped") and removes the open step's task. This lists, per org, the rows a
// stop made before the fix:
//   done-looking  a skipped step whose Thread was closed dismissed/handled_outside (its task reads Done)
//   pending       a step still pending under a journey that was stopped by hand
// Usage:
//   DATABASE_URL=… node scripts/ops/flows10-stopped-steps.js [--org=<org_id>]
"use strict";
const { Pool } = require("pg");
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };

async function main() {
  if (process.argv.includes("--apply")) { console.error("This script is a dry run only; it has no --apply."); process.exit(2); }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const one = arg("org");
  try {
    // A stop by hand: abandoned, not by a batch undo, a replacement or a death (those set a reason).
    const stoppedByHand = `p.status='abandoned' AND p.end_reason IS NULL AND p.replaced_reason IS NULL`;
    const doneLooking = (await pool.query(
      `SELECT p.org_id, d.name, p.template_name, s.label, LEFT(s.closed_at::text, 10) AS day
         FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id = s.plan_id JOIN donors d ON d.id = p.donor_id
         JOIN threads t ON t.id = s.thread_id
        WHERE ${stoppedByHand} AND s.status='skipped' AND t.close_kind='dismissed' AND t.close_reason='handled_outside'
          ${one ? "AND p.org_id = $1" : ""} ORDER BY p.org_id, d.name`, one ? [one] : [])).rows;
    const pending = (await pool.query(
      `SELECT p.org_id, COUNT(*)::int AS n, COUNT(DISTINCT p.id)::int AS journeys
         FROM cultivation_plan_steps s JOIN cultivation_plans p ON p.id = s.plan_id
        WHERE ${stoppedByHand} AND s.status='pending' ${one ? "AND p.org_id = $1" : ""} GROUP BY p.org_id ORDER BY p.org_id`, one ? [one] : [])).rows;
    for (const r of doneLooking) console.log(`done-looking · ${r.org_id} · ${r.name} · ${r.template_name} · "${r.label}" · stopped ${r.day}`);
    for (const r of pending) console.log(`pending · ${r.org_id} · ${r.n} step(s) in ${r.journeys} stopped journey(s)`);
    console.log(`\n${doneLooking.length} step(s) read Done because of a stop; ${pending.reduce((a, r) => a + r.n, 0)} step(s) still pending under a stopped journey.`);
    console.log("Dry run: nothing was written. REPAIR-1 or Jonathan decides how they are put right.");
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
