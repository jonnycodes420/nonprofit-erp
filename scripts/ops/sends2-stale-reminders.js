#!/usr/bin/env node
// SENDS-2 item 3 · VOLUNTEER REMINDERS FOR A SHIFT THAT IS NOT TOMORROW.
//
// Before SENDS-2 a "Reminder for tomorrow" draft waited in To send forever: keyed by sign-up and
// never expired (Jarvis, 22 Nov: 33 of them for shifts already past). Since SENDS-2 the list hides
// them on read, a send refuses them, and the hourly volunteer sweep sets them `expired` on its own
// (server/volunteers/toSend.js expireReminders). This lists the rows still waiting, by the same rule
// (toSend.SHIFT_DATE_SQL: the draft's slot, or its sign-up's), so Jonathan can see them before the
// sweep reaches them or set one org's aside at once.
//
// DRY RUN BY DEFAULT, read only: per org, how many; with --org, each person and shift date.
//
//   DATABASE_URL=… node scripts/ops/sends2-stale-reminders.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/sends2-stale-reminders.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply sets that one org's listed drafts to `expired` (never deleted; nothing is sent) in one
// transaction and writes one audit row as system:sends2-stale-reminders. A remote database needs
// --i-know-this-is-prod (prodGuard's writerDbUrl). Never org_creo, never org_b72demo. Nothing runs
// at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo", "org_b72demo"];
const ACTOR = { id: "system:sends2-stale-reminders", name: "Out-of-date volunteer reminders (SENDS-2)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

async function main() {
  const { query, withTransaction } = require("../../db");
  const { SHIFT_DATE_SQL } = require("../../server/volunteers/toSend");
  const { orgTzSql } = require("../../orgTime");
  // Tomorrow in each org's own zone, in SQL, so one statement reads every org.
  const rows = await query(
    `SELECT md.id, md.org_id, d.name, ${SHIFT_DATE_SQL} AS shift_date,
            to_char((NOW() AT TIME ZONE ${orgTzSql("md.org_id")})::date + 1, 'YYYY-MM-DD') AS tomorrow
       FROM milestone_drafts md JOIN donors d ON d.id = md.donor_id AND d.org_id = md.org_id
      WHERE md.status = 'pending_review' AND md.source = 'volunteer_reminder'
        AND ($1::text IS NULL OR md.org_id = $1) AND NOT (md.org_id = ANY($2))
      ORDER BY md.org_id, md.created_at`, [ORG || null, NEVER]);
  const stale = rows.filter(r => r.shift_date !== r.tomorrow);
  const byOrg = new Map();
  for (const r of stale) byOrg.set(r.org_id, (byOrg.get(r.org_id) || 0) + 1);
  console.log(`Waiting volunteer reminders whose shift is not tomorrow: ${stale.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, n] of byOrg) console.log(`  ${org.padEnd(28)} ${String(n).padStart(4)}`);
  if (ORG) for (const r of stale) console.log(`    ${r.name} · shift ${r.shift_date || "(no longer on the schedule)"} (${r.id})`);
  if (!APPLY) { console.log("\nDry run: nothing was written." + (stale.length ? " Add --org <org> --apply to set them aside." : "")); return; }
  if (!stale.length) { console.log("\nNothing to set aside."); return; }
  const ids = stale.map(r => r.id);
  let done = [];
  await withTransaction(async client => {
    done = (await client.query(`UPDATE milestone_drafts SET status = 'expired' WHERE org_id = $1 AND id = ANY($2) AND status = 'pending_review' RETURNING id`, [ORG, ids])).rows.map(r => r.id);
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'sends2 out-of-date reminders','milestone_draft',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/sends2-stale-reminders.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ expired: stale.filter(r => done.includes(r.id)).map(r => ({ id: r.id, shift: r.shift_date })) }),
       `Set aside ${done.length} volunteer reminder${done.length === 1 ? "" : "s"} for shifts that were not tomorrow`, done.length]);
  });
  console.log(`\nSet aside ${done.length}. Nothing was sent.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
