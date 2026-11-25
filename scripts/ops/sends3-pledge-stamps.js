#!/usr/bin/env node
// SENDS-3 item 1 · PLEDGE REMINDER STAMPS THE ONE OVERDUE RULE DISAGREES WITH.
//
// Before SENDS-3 the pledge reminder job stamped `pledges.first_overdue_at`
// from the pledge's single due_date and reminded from that stamp. Since
// SENDS-3 it asks pledgeSchedule.overdueOf (server/pledges/overdueNow.js), so
// a stamped pledge with nothing past due gets no reminder. The stamps are
// still there: this finds an open pledge whose stamp says "overdue" while its
// schedule says nothing is past due today (the org's own day).
//
// DRY RUN BY DEFAULT, read only: per org, how many; with --org, each one.
//
//   DATABASE_URL=… node scripts/ops/sends3-pledge-stamps.js [--org <org id>]
//   DATABASE_URL=… node scripts/ops/sends3-pledge-stamps.js --org <org id> --apply [--i-know-this-is-prod]
//
// --apply, for that one org, in one transaction: the stamp, the next reminder
// time and the step are cleared (first_overdue_at, next_reminder_at NULL,
// reminder_step 0), so the job starts the cadence afresh if one of its
// installments falls overdue later. One audit row as
// system:sends3-pledge-stamps. A remote database needs --i-know-this-is-prod
// (prodGuard's writerDbUrl). Never org_b72demo (only the seed writes it).
// Nothing is sent. Nothing runs at deploy.
"use strict";
const crypto = require("crypto");

const argv = process.argv.slice(2);
const flag = k => argv.includes(k);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ORG = val("--org");
const APPLY = flag("--apply");
const NEVER = ["org_b72demo"];
const ACTOR = { id: "system:sends3-pledge-stamps", name: "Stale pledge reminder stamps cleared (SENDS-3)", kind: "system" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (ORG && NEVER.includes(ORG)) refuse(`${ORG} is never written by this script.`);
if (APPLY && !ORG) refuse("--apply acts on one org: name it with --org.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

const STAMPED_SQL = `
  SELECT p.id, p.org_id, p.amount, p.due_date, p.first_overdue_at, p.reminder_step, d.name AS donor_name, o.timezone
    FROM pledges p
    JOIN orgs o ON o.id = p.org_id
    LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
   WHERE p.status = 'open' AND p.first_overdue_at IS NOT NULL
     AND (?::text IS NULL OR p.org_id = ?) AND NOT (p.org_id = ANY(?))
   ORDER BY p.org_id, d.name, p.id`;

// -> [{ ...pledge, overdue }] the stamped pledges whose schedule has nothing past due.
async function staleStamps(query, org = null) {
  const orgTime = require("../../orgTime");
  const ON = require("../../server/pledges/overdueNow");
  const rows = await query(STAMPED_SQL, [org, org, NEVER]);
  const out = [];
  for (const o of [...new Set(rows.map(r => r.org_id))]) {
    const mine = rows.filter(r => r.org_id === o);
    const today = orgTime.orgToday({ timezone: mine[0].timezone });   // ORG_TZ_SEAM_OK
    const od = await ON.overdueByPledge(query, o, mine, today);
    for (const r of mine) if (!(od.get(r.id) || {}).overdue) out.push({ ...r, today });
  }
  return out;
}

async function main() {
  const { query, withTransaction } = require("../../db");
  const rows = await staleStamps(query, ORG || null);
  const byOrg = new Map();
  for (const r of rows) byOrg.set(r.org_id, (byOrg.get(r.org_id) || 0) + 1);
  console.log(`Open pledges stamped overdue with nothing past due on their schedule: ${rows.length}${ORG ? ` in ${ORG}` : ` in ${byOrg.size} ${byOrg.size === 1 ? "org" : "orgs"}`}.`);
  for (const [org, n] of byOrg) console.log(`  ${org.padEnd(28)} ${String(n).padStart(4)}`);
  if (ORG) for (const r of rows) console.log(`    ${r.donor_name || "(no name)"} · pledge ${r.id} · $${Number(r.amount).toLocaleString("en-US")} · stamped ${new Date(r.first_overdue_at).toISOString().slice(0, 10)} · reminder step ${r.reminder_step}`);
  if (!APPLY) { console.log("\nDry run: nothing was written." + (rows.length ? " Add --org <org> --apply to clear these stamps." : "")); return; }
  if (!rows.length) { console.log("\nNothing to clear."); return; }
  let cleared = 0;
  await withTransaction(async client => {
    for (const r of rows) {
      cleared += (await client.query(`UPDATE pledges SET first_overdue_at = NULL, next_reminder_at = NULL, reminder_step = 0, updated_at = NOW()
                                       WHERE id = $1 AND org_id = $2 AND status = 'open' AND first_overdue_at IS NOT NULL`, [r.id, ORG])).rowCount;
    }
    await client.query(
      `INSERT INTO fin_audit_log (id, org_id, user_id, user_name, actor_kind, action, entity_type, entity_id,
                                  changes, before_fields, after_fields, summary, record_count, request_method, request_path)
       VALUES ($1,$2,$3,$4,$5,'sends3 pledge stamps','pledge',NULL,$6,NULL,NULL,$7,$8,'SCRIPT','scripts/ops/sends3-pledge-stamps.js')`,
      ["al_" + crypto.randomBytes(10).toString("hex"), ORG, ACTOR.id, ACTOR.name, ACTOR.kind,
       JSON.stringify({ cleared: rows.map(r => ({ pledge: r.id, stamped: r.first_overdue_at, step: r.reminder_step })) }),
       `Cleared ${cleared} pledge reminder stamp${cleared === 1 ? "" : "s"} with nothing past due on the schedule`, cleared]);
  });
  console.log(`\nCleared ${cleared} stamp${cleared === 1 ? "" : "s"}. Nothing was sent.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
module.exports = { staleStamps, STAMPED_SQL };
