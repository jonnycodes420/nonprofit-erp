#!/usr/bin/env node
// VOL-3 items 2 and 3 · VOLUNTEER RECORDS KEPT AS MADE-UP APPLICATIONS, AND APPLICATIONS LEFT BY AN ERASE.
//
// Before VOL-3, "Add a volunteer" and "Make a volunteer" wrote an Approved application nobody sent
// (volunteer_applications, via staff or agent) to hold hours a week, days and roles, and erasing a
// person left their applications behind with the name still on them. Since VOL-3 the record is a
// volunteer_records row, the Applications list shows only what came through the volunteer page,
// erase takes every application that is theirs, and an approved application whose person is gone
// shows a Delete. The OLD rows are still there. This lists them, per org:
//
//   staff   an approved application with via staff/agent whose person is on file: --apply copies
//           its hours a week, days and roles into their volunteer record (when they have none) and
//           deletes the application.
//   gone    an approved application whose person is erased, deleted or purged: --apply deletes it
//           (and its answers).
//
// DRY RUN BY DEFAULT, read only: counts per org; with --org, each row (no names for "gone" rows).
//
//   DATABASE_URL=… node scripts/ops/vol3-staff-records.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/vol3-staff-records.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply acts on one org in one transaction and writes one audit row as system:vol3-staff-records.
// A remote database needs --i-know-this-is-prod (prodGuard's writerDbUrl). Never org_creo, never
// org_b72demo. Nothing runs at deploy. Nothing sends.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_creo", "org_b72demo"];
const ACTOR = { id: "system:vol3-staff-records", name: "Volunteer records kept as applications (VOL-3)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

const GONE = `NOT EXISTS (SELECT 1 FROM donors gd WHERE gd.id = a.person_id AND gd.org_id = a.org_id AND gd.deleted_at IS NULL AND gd.erased_at IS NULL)`;

async function main() {
  const { query, withTransaction } = require("../../db");
  const rows = await query(
    `SELECT a.id, a.org_id, a.person_id, a.via, a.hours_per_week, a.availability, a.roles, a.created_by, a.created_by_name,
            CASE WHEN ${GONE} THEN 'gone' ELSE 'staff' END AS kind,
            CASE WHEN ${GONE} THEN NULL ELSE (SELECT d.name FROM donors d WHERE d.id = a.person_id) END AS name
       FROM volunteer_applications a
      WHERE a.status = 'approved' AND (COALESCE(a.via,'page') IN ('staff','agent') OR ${GONE})
        AND ($1::text IS NULL OR a.org_id = $1) AND NOT (a.org_id = ANY($2))
      ORDER BY a.org_id, a.submitted_at`, [ORG || null, NEVER]);
  const byOrg = new Map();
  for (const r of rows) { const o = byOrg.get(r.org_id) || { staff: 0, gone: 0 }; o[r.kind]++; byOrg.set(r.org_id, o); }
  console.log(`Approved applications that are not applications: ${rows.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, n] of byOrg) console.log(`  ${org.padEnd(28)} staff-made ${String(n.staff).padStart(4)}   person gone ${String(n.gone).padStart(4)}`);
  if (ORG) for (const r of rows) console.log(`    ${r.kind === "gone" ? "person gone" : `staff-made for ${r.name}`} (${r.id})`);
  if (!APPLY) { console.log("\nDry run: nothing was written." + (rows.length ? " Add --org <org> --apply to move and delete them." : "")); return; }
  if (!rows.length) { console.log("\nNothing to do."); return; }
  let moved = 0, deleted = 0;
  await withTransaction(async client => {
    for (const r of rows) {
      if (r.kind === "staff") {
        const ins = await client.query(
          `INSERT INTO volunteer_records (id,org_id,person_id,hours_per_week,availability,roles,status,created_by,created_by_name)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'active',$7,$8) ON CONFLICT (org_id, person_id) DO NOTHING`,
          ["vrec_" + crypto.randomBytes(10).toString("hex"), r.org_id, r.person_id, r.hours_per_week,
           JSON.stringify(r.availability || []), JSON.stringify(r.roles || []), r.created_by || ACTOR.id, r.created_by_name || ACTOR.name]);
        moved += ins.rowCount;
      }
      deleted += (await client.query(`DELETE FROM volunteer_applications WHERE id = $1 AND org_id = $2`, [r.id, r.org_id])).rowCount;
    }
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'vol3 staff records','volunteer_application',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/vol3-staff-records.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ deleted: rows.map(r => ({ id: r.id, kind: r.kind })), moved }),
       `Moved ${moved} volunteer record${moved === 1 ? "" : "s"} off made-up applications; deleted ${deleted} application${deleted === 1 ? "" : "s"}`, deleted]);
  });
  console.log(`\nMoved ${moved} into volunteer records; deleted ${deleted} applications. Nothing was sent.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
