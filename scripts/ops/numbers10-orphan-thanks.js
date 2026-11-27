#!/usr/bin/env node
// NUMBERS-10 item 6 (W-1127-Finance-03) · A THANK-YOU WITH NO GIFT BEHIND IT.
//
// "Deleting a donor's gifts still leaves the 'Call to say thank you' journey step and note in place with
// no gift behind it." Since NUMBERS-10 a delete that cancels a thank-you writes one timeline line saying
// so ("Thank-you cancelled: the $100 gift of Nov 24, 2026 was removed, so Call to say thank you (New donor,
// first year) is cancelled."), and the gift's Undo takes it away (server/donors/giftThanks.js cancelLine).
// Rows written before that still carry the old state. This lists them, three kinds:
//
//   open      a journey still active whose gift is gone (its source gift, its `gift:<id>` event, or an
//             unstamped first-gift journey whose person has no gift left), with its thank-you step open;
//   silent    a journey a gift delete stopped (end_reason gift_deleted) with no line on the timeline
//             saying its thank-you was cancelled;
//   tasks     an open task Steward made for a gift (thanks_gift_id / source_gift_id) that is gone.
//
// DRY RUN BY DEFAULT, read only: per org, how many of each; with --org, every row.
//
//   DATABASE_URL=… node scripts/ops/numbers10-orphan-thanks.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/numbers10-orphan-thanks.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply, one org, one transaction: an `open` journey is stopped as a delete stops it (its open step's
// task voided gift_deleted, its thread closed, steps not done skipped "Skipped, the gift was removed",
// the plan abandoned gift_deleted); `open` and `silent` journeys each get the one timeline line; `tasks`
// are voided (reason gift_deleted, never deleted). One audit row as system:scripts/ops/numbers10-orphan-thanks.
// A remote database needs --i-know-this-is-prod (prodGuard's writerDbUrl): Jonathan runs it, for one org
// he names. Never org_creo, never org_b72demo (seed-demo.js owns it). Nothing sends. Nothing runs at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo", "org_b72demo"];
const ACTOR = { id: "system:scripts/ops/numbers10-orphan-thanks", name: "Thank-yous with no gift repair (NUMBERS-10)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

const GONE = g => `NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = ${g})`;
// Binds: org or null.
const OPEN_SQL = `SELECT p.org_id, p.id, p.donor_id, p.template_name, d.name AS donor_name, s.label AS step
    FROM cultivation_plans p JOIN cultivation_plan_steps s ON s.plan_id = p.id AND s.status = 'open'
    LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
   WHERE p.status = 'active' AND ($1::text IS NULL OR p.org_id = $1)
     AND ((p.source_gift_id IS NOT NULL AND ${GONE("p.source_gift_id")})
       OR (p.trigger_event LIKE 'gift:%' AND ${GONE("substr(p.trigger_event, 6)")})
       OR (p.source_gift_id IS NULL AND p.trigger_key = 'first_gift'
           AND NOT EXISTS (SELECT 1 FROM gifts og WHERE og.org_id = p.org_id AND og.donor_id = p.donor_id AND og.amount > 0)))
   ORDER BY p.org_id, p.applied_on`;
const SILENT_SQL = `SELECT p.org_id, p.id, p.donor_id, p.template_name, d.name AS donor_name,
         (SELECT s.label FROM cultivation_plan_steps s WHERE s.plan_id = p.id AND s.skip_reason = 'Skipped, the gift was removed' ORDER BY s.seq LIMIT 1) AS step
    FROM cultivation_plans p LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
   WHERE p.status = 'abandoned' AND p.end_reason = 'gift_deleted' AND ($1::text IS NULL OR p.org_id = $1)
     AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.org_id = p.org_id AND i.donor_id = p.donor_id
                      AND i.metadata->>'via' IN ('gift_delete', 'numbers10_repair') AND i.note LIKE 'Thank-you cancelled:%')
   ORDER BY p.org_id, p.closed_at`;
const TASKS_SQL = `SELECT t.org_id, t.id, t.donor_id, t.title, d.name AS donor_name
    FROM tasks t LEFT JOIN donors d ON d.id = t.donor_id AND d.org_id = t.org_id
   WHERE t.voided_at IS NULL AND COALESCE(t.done, 0) = 0 AND ($1::text IS NULL OR t.org_id = $1)
     AND COALESCE(t.thanks_gift_id, t.source_gift_id) IS NOT NULL AND ${GONE("COALESCE(t.thanks_gift_id, t.source_gift_id)")}
   ORDER BY t.org_id, t.created_at`;

const lineOf = r => `Thank-you cancelled: the gift that started ${r.template_name || "this journey"} was removed, so ${r.step ? `${r.step} is cancelled` : "the journey is stopped"}.`;

async function main() {
  const { query, withTransaction } = require("../../db");
  const orgParam = ORG || null;
  const lists = {
    open: await query(OPEN_SQL, [orgParam]),
    silent: await query(SILENT_SQL, [orgParam]),
    tasks: await query(TASKS_SQL, [orgParam]),
  };
  const byOrg = new Map();
  for (const [k, rows] of Object.entries(lists)) for (const r of rows) {
    const o = byOrg.get(r.org_id) || { open: 0, silent: 0, tasks: 0 };
    o[k]++; byOrg.set(r.org_id, o);
  }
  const total = lists.open.length + lists.silent.length + lists.tasks.length;
  console.log(`Thank-yous with no gift behind them: ${total}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  console.log(`  ${"org".padEnd(28)} ${"open".padStart(5)} ${"silent".padStart(7)} ${"tasks".padStart(6)}`);
  for (const [org, o] of byOrg) console.log(`  ${org.padEnd(28)} ${String(o.open).padStart(5)} ${String(o.silent).padStart(7)} ${String(o.tasks).padStart(6)}${NEVER.includes(org) ? "  (never written here)" : ""}`);
  if (ORG) {
    for (const r of lists.open) console.log(`    open    ${r.donor_name || "(no person)"} · ${r.template_name} · "${r.step}" (${r.id})`);
    for (const r of lists.silent) console.log(`    silent  ${r.donor_name || "(no person)"} · ${r.template_name} (${r.id})`);
    for (const r of lists.tasks) console.log(`    task    ${r.donor_name || "(no person)"} · "${r.title}" (${r.id})`);
  }
  if (!APPLY) { console.log("\nDry run: nothing was written." + (total ? " Add --org <org> --apply to repair one org." : "")); return; }
  if (!total) { console.log("\nNothing to repair."); return; }
  const done = { stopped: 0, lines: 0, tasks: 0 };
  await withTransaction(async client => {
    const x = (sql, p) => client.query(sql, p);
    const [{ timezone } = {}] = (await x("SELECT timezone FROM orgs WHERE id = $1", [ORG])).rows;
    const day = require("../../orgTime").orgToday({ timezone });   // ORG_TZ_SEAM_OK (the org's civil today)
    const planIds = lists.open.map(r => r.id);
    if (planIds.length) {
      const steps = (await x(`SELECT id, thread_id, status FROM cultivation_plan_steps WHERE org_id = $1 AND plan_id = ANY($2::text[]) AND status IN ('open','pending')`, [ORG, planIds])).rows;
      const threads = steps.filter(s => s.status === "open" && s.thread_id).map(s => s.thread_id);
      if (threads.length) {
        done.tasks += (await x(`UPDATE tasks SET voided_at = NOW(), voided_reason = 'gift_deleted', updated_at = NOW()
                                 WHERE org_id = $1 AND thread_id = ANY($2::text[]) AND voided_at IS NULL AND COALESCE(done, 0) = 0`, [ORG, threads])).rowCount;
        await x(`UPDATE threads SET closed_at = NOW(), close_kind = 'dismissed', close_reason = 'gift_deleted' WHERE org_id = $1 AND id = ANY($2::text[]) AND closed_at IS NULL`, [ORG, threads]);
      }
      if (steps.length) await x(`UPDATE cultivation_plan_steps SET status = 'skipped', closed_at = NOW(), closed_by = $1, closed_by_name = $2, skip_reason = 'Skipped, the gift was removed'
                                  WHERE org_id = $3 AND id = ANY($4::text[])`, [ACTOR.id, ACTOR.name, ORG, steps.map(s => s.id)]);
      done.stopped = (await x(`UPDATE cultivation_plans SET status = 'abandoned', closed_at = NOW(), end_reason = 'gift_deleted' WHERE org_id = $1 AND id = ANY($2::text[]) AND status = 'active'`, [ORG, planIds])).rowCount;
    }
    for (const r of [...lists.open, ...lists.silent]) {
      if (!r.donor_id) continue;
      await x(`INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata) VALUES ($1,$2,$3,'activity',$4,$5,$6,$7,$8)`,
        [require("../../server/shared/newId").newId("i"), ORG, r.donor_id, lineOf(r), day, ACTOR.id, ACTOR.name,
         JSON.stringify({ via: "numbers10_repair", plan_id: r.id, line_key: `thanks-cancelled-plan:${r.id}` })]);
      done.lines++;
    }
    if (lists.tasks.length) done.tasks += (await x(`UPDATE tasks SET voided_at = NOW(), voided_reason = 'gift_deleted', updated_at = NOW()
                                                     WHERE org_id = $1 AND id = ANY($2::text[]) AND voided_at IS NULL`, [ORG, lists.tasks.map(r => r.id)])).rowCount;
    await x(`INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                        changes, before_fields, after_fields, summary, record_count, request_method, request_path)
             VALUES ($1,$2,$3,$4,$5,'numbers10 thank-yous with no gift','cultivation_plan',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/numbers10-orphan-thanks.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ open: lists.open.map(r => r.id), silent: lists.silent.map(r => r.id), tasks: lists.tasks.map(r => r.id) }),
       `Stopped ${done.stopped} ${done.stopped === 1 ? "journey" : "journeys"} whose gift is gone, wrote ${done.lines} timeline ${done.lines === 1 ? "line" : "lines"} saying a thank-you was cancelled, and voided ${done.tasks} ${done.tasks === 1 ? "task" : "tasks"}.`,
       done.stopped + done.lines + done.tasks]);
  });
  console.log(`\nIn one transaction: ${done.stopped} journeys stopped, ${done.lines} timeline lines written, ${done.tasks} tasks voided (reason gift_deleted). Audit row as ${ACTOR.id}.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { main, OPEN_SQL, SILENT_SQL, TASKS_SQL };
