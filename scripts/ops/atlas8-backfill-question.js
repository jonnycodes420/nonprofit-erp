#!/usr/bin/env node
// ATLAS-8 item 6 — the question on Atlas lines written before atlas_actions.question.
//
// Since ATLAS-8 every Atlas line keeps the question it answered. A line written
// before has `question` NULL, but its request (voice_memos, request_id) still
// holds her words, so the question can be put back from there, redacted by the
// same rule new lines use (server/atlas/rowsSteps.js auditQuestion).
//
// SAFE BY DEFAULT: a dry run unless --apply. It touches only lines with
// question IS NULL whose request is an Atlas request (source atlas…) with text,
// so a second run changes nothing. Lines with no request (the daily job that
// closes questions) are left NULL: no question made them.
//
// Usage:
//   node scripts/ops/atlas8-backfill-question.js                 # dry run, all orgs
//   node scripts/ops/atlas8-backfill-question.js --org=org_x     # one org
//   node scripts/ops/atlas8-backfill-question.js --apply         # write
"use strict";
const { Pool } = require("pg");
const { auditQuestion } = require("../../server/atlas/rowsSteps");

const APPLY = process.argv.includes("--apply");
const orgArg = (process.argv.find(a => a.startsWith("--org=")) || "").split("=")[1] || null;
const DB_URL = require("../lib/prodGuard").writerDbUrl();   // a remote database needs --i-know-this-is-prod (BUILD-55)

async function main() {
  const local = /localhost|127\.0\.0\.1/.test(DB_URL);
  const pool = new Pool({ connectionString: DB_URL, ssl: local ? false : { rejectUnauthorized: false } });
  console.log(`Target DB: ${DB_URL.replace(/:[^:@/]+@/, ":****@")}`);
  console.log(APPLY ? "MODE: APPLY (writes atlas_actions.question)\n" : "MODE: DRY RUN (no writes)\n");
  const rows = (await pool.query(
    `SELECT a.id, a.org_id, m.text FROM atlas_actions a JOIN voice_memos m ON m.id = a.request_id AND m.org_id = a.org_id
      WHERE a.question IS NULL AND m.source LIKE 'atlas%' AND COALESCE(m.text, '') <> '' ${orgArg ? "AND a.org_id = $1" : ""}
      ORDER BY a.org_id, a.created_at`, orgArg ? [orgArg] : [])).rows;
  const byOrg = new Map();
  for (const r of rows) byOrg.set(r.org_id, (byOrg.get(r.org_id) || 0) + 1);
  for (const [org, n] of byOrg) console.log(`  ${org}: ${n} line(s) with no question, each request's words to put back`);
  console.log(`\n${rows.length} line(s) in ${byOrg.size} org(s).`);
  if (APPLY && rows.length) {
    let done = 0;
    for (const r of rows) {
      const q = auditQuestion(r.text);
      const u = await pool.query(`UPDATE atlas_actions SET question = $1 WHERE id = $2 AND org_id = $3 AND question IS NULL`, [q, r.id, r.org_id]);
      done += u.rowCount;
    }
    console.log(`Wrote ${done}.`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
