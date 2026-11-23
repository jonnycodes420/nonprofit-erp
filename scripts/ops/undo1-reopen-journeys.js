#!/usr/bin/env node
// UNDO-1 item 6 · JOURNEYS FINISHED BY A TICK THAT WAS TAKEN BACK.
//
// Before UNDO-1, ticking a journey's step (a task tick, Home's Done, a logged
// touch) marked the step done and could finish the journey, and reopening the
// step reopened its Thread and nothing else (the fleet, 22 Nov: Renee
// Castillo's Birthday card on the prod demo). Since UNDO-1 a reopen takes the
// journey back too (server/effects/planEffects.js). This finds the rows left
// from before: a journey step marked done whose own next step is OPEN again.
// Its journey is listed as finished (or moved past it) while its step waits.
//
// DRY RUN BY DEFAULT, read only: per org, how many; with --org, each person,
// journey and step.
//
//   DATABASE_URL=… node scripts/ops/undo1-reopen-journeys.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/undo1-reopen-journeys.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply, for that one org, in one transaction: the step is open again
// (status open, its close cleared) and a journey marked done is active again.
// A journey that has another step open already is listed and left alone. One
// audit row as system:undo1-reopen-journeys. A remote database needs
// --i-know-this-is-prod (prodGuard's writerDbUrl). Never org_b72demo (only
// the seed writes it). Nothing is sent. Nothing runs at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_b72demo"];
const ACTOR = { id: "system:undo1-reopen-journeys", name: "Journeys reopened with their step (UNDO-1)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

// A step marked done whose next step (its thread) is open again.
const FIND_SQL = `
  SELECT s.id AS step_id, s.org_id, s.label, s.closed_at AS step_closed_at, p.id AS plan_id, p.status AS plan_status,
         p.template_name, d.name AS donor_name, t.id AS thread_id,
         EXISTS (SELECT 1 FROM cultivation_plan_steps o WHERE o.org_id = s.org_id AND o.plan_id = s.plan_id AND o.status = 'open' AND o.id <> s.id) AS other_open
    FROM cultivation_plan_steps s
    JOIN cultivation_plans p ON p.id = s.plan_id AND p.org_id = s.org_id
    JOIN threads t ON t.id = s.thread_id AND t.org_id = s.org_id
    JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
   WHERE s.status = 'done' AND t.closed_at IS NULL AND p.status IN ('done', 'active') AND d.deleted_at IS NULL
     AND ($1::text IS NULL OR s.org_id = $1) AND NOT (s.org_id = ANY($2))
   ORDER BY s.org_id, d.name`;

async function main() {
  const { query, withTransaction } = require("../../db");
  const rows = await query(FIND_SQL, [ORG || null, NEVER]);
  const byOrg = new Map();
  for (const r of rows) byOrg.set(r.org_id, (byOrg.get(r.org_id) || 0) + 1);
  console.log(`Journey steps marked done whose next step is open again: ${rows.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, n] of byOrg) console.log(`  ${org.padEnd(28)} ${String(n).padStart(4)}`);
  if (ORG) for (const r of rows) console.log(`    ${r.donor_name} · ${r.template_name || "journey"} · "${r.label}" · journey ${r.plan_status}${r.other_open ? " · LEFT ALONE: another step of this journey is open" : ""}`);
  const fix = rows.filter(r => !r.other_open);
  if (!APPLY) { console.log("\nDry run: nothing was written." + (fix.length ? " Add --org <org> --apply to reopen them." : "")); return; }
  if (!fix.length) { console.log("\nNothing to reopen."); return; }
  let steps = 0, plans = 0;
  await withTransaction(async client => {
    for (const r of fix) {
      steps += (await client.query(`UPDATE cultivation_plan_steps SET status = 'open', closed_at = NULL, closed_by = NULL, closed_by_name = NULL
                                     WHERE id = $1 AND org_id = $2 AND status = 'done'`, [r.step_id, ORG])).rowCount;
      plans += (await client.query(`UPDATE cultivation_plans SET status = 'active', closed_at = NULL WHERE id = $1 AND org_id = $2 AND status = 'done'`, [r.plan_id, ORG])).rowCount;
    }
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'undo1 reopen journeys','journey',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/undo1-reopen-journeys.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ reopened: fix.map(r => ({ step: r.step_id, plan: r.plan_id, label: r.label, was: r.plan_status })) }),
       `Reopened ${steps} journey step${steps === 1 ? "" : "s"} whose next step was open again (${plans} finished journey${plans === 1 ? "" : "s"} active again)`, steps]);
  });
  console.log(`\nReopened ${steps} step${steps === 1 ? "" : "s"}; ${plans} journey${plans === 1 ? " is" : "s are"} active again. Nothing was sent.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
module.exports = { FIND_SQL };
