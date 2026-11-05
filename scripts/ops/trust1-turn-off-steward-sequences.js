#!/usr/bin/env node
// scripts/ops/trust1-turn-off-steward-sequences.js · TRUST-1. JONATHAN RUNS IT.
//
// Turns OFF ('paused', turned_off_at = NOW()) every at-risk and milestone
// sequence Steward made on its own and left on (see
// trust1-steward-sequences-readonly.sql for the same list). Since TRUST-1 they
// are made off; these are the ones made before. Turning off leaves enrolments
// where they are and sends nothing further, exactly like the Turn off button;
// drafts already waiting for review stay waiting.
//
// SAFE BY DEFAULT: a dry run unless --apply. Skips any sequence a person turned
// on (turned_on_by) or changed by hand (a PATCH /sequences/<id>/status in the
// audit trail). Before applying it writes the ids to a JSON file in /tmp so the
// change can be undone (UPDATE sequences SET status='active', turned_off_at=NULL
// WHERE id = ANY(<ids>)). Idempotent: a second run finds none.
//
//   node scripts/ops/trust1-turn-off-steward-sequences.js                 # dry run
//   node scripts/ops/trust1-turn-off-steward-sequences.js --org=org_x     # one org
//   node scripts/ops/trust1-turn-off-steward-sequences.js --apply         # write
// A remote database needs --i-know-this-is-prod (scripts/lib/prodGuard.js).
"use strict";
const fs = require("fs");
const { Pool } = require("pg");

const APPLY = process.argv.includes("--apply");
const ORG = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;
const DB_URL = require("../lib/prodGuard").writerDbUrl();

const LIST_SQL = `
  SELECT s.id, s.org_id, s.trigger,
         (SELECT COUNT(*)::int FROM sequence_enrollments e WHERE e.sequence_id = s.id AND e.status='active') AS active_enrollments
    FROM sequences s
   WHERE s.created_by = 'system:auto' AND s.trigger IN ('at_risk','milestone')
     AND s.status = 'active' AND s.turned_on_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM fin_audit_log a WHERE a.org_id = s.org_id AND a.request_path = '/sequences/' || s.id || '/status')
     AND ($1::text IS NULL OR s.org_id = $1::text)
   ORDER BY s.org_id, s.trigger`;

async function main() {
  const pool = new Pool({ connectionString: DB_URL, ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  try {
    console.log(`Target DB: ${DB_URL.replace(/:[^:@/]+@/, ":****@")}`);
    console.log(APPLY ? "MODE: APPLY (turns them off)\n" : "MODE: DRY RUN (no writes)\n");
    const rows = (await pool.query(LIST_SQL, [ORG])).rows;
    for (const r of rows) console.log(`  ${r.org_id}  ${r.id}  ${r.trigger}  active enrolments: ${r.active_enrollments}`);
    console.log(`\n${rows.length} sequence(s) Steward made and left on${ORG ? ` in ${ORG}` : ""}.`);
    if (!APPLY || !rows.length) { if (!APPLY && rows.length) console.log("Dry run: nothing changed. Re-run with --apply to turn them off."); return; }
    const file = `/tmp/trust1-turned-off-${Date.now()}.json`;
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`Ids written to ${file} (to undo).`);
    const ids = rows.map(r => r.id);
    const out = await pool.query(
      `UPDATE sequences SET status='paused', turned_off_at=NOW()
        WHERE id = ANY($1::text[]) AND status='active' AND turned_on_by IS NULL AND created_by='system:auto'`, [ids]);
    console.log(`Turned off ${out.rowCount} sequence(s).`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
