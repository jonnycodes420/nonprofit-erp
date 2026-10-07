#!/usr/bin/env node
// scripts/clean1-orphan-report.js · CLEAN-1 follow-up. READ ONLY.
//
// The July merge (BUILD-08, replaced by CLEAN-1 on 2026-10-03) moved a
// hand-kept list of tables and soft-deleted the record it folded away. Every
// other column that points at a person kept pointing at that soft-deleted
// record. This counts those rows, per org and per table, so we know whether a
// repair is needed. It prints counts only: never a name, an email, an id of a
// person, or any other donor data.
//
// WHO THE OLD MERGE FOLDED AWAY. It did not record the id. It did, in ONE
// transaction, set the folded record's deleted_at = NOW() and insert a note
// on the kept record reading `Merged duplicate record "<name>" ...`, whose
// created_at defaulted to the same NOW(). So a folded record is a soft-deleted
// donor with a note in the same org whose created_at EQUALS its deleted_at to
// the microsecond and whose text names it. A record deleted from the trash or
// merged by the new merge (whose note reads `Merged "<name>" ...`) never
// matches.
//
// SAFETY. One `BEGIN TRANSACTION READ ONLY`, ended by ROLLBACK; Postgres
// itself refuses any write inside it. The script has no INSERT, UPDATE or
// DELETE. Statement timeout 60s.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/clean1-orphan-report.js [--all]
//   --all  also count the columns the old merge DID move in its final form,
//          because earlier versions of it moved fewer (tribute notices, shifts
//          and volunteer notes were added later).
"use strict";
const { Client } = require("pg");
const { MERGE_REFS, REF_SHAPE } = require("../routes/dataHealth");

// What the old merge moved, as of the version CLEAN-1 replaced.
const OLD_MOVED = new Set([
  "gifts.donor_id", "interactions.donor_id", "pledges.donor_id", "receipts.donor_id", "milestone_drafts.donor_id",
  "note_reminders.donor_id", "donor_materials.donor_id", "planned_gifts.donor_id", "payment_recovery_events.donor_id",
  "recurring_subscriptions.donor_id", "tasks.donor_id", "volunteers.donor_id", "campaign_recipients.donor_id",
  "tribute_notices.donor_id", "interaction_attachments.donor_id", "custom_field_values.donor_id",
  "sequence_enrollments.donor_id", "event_attendees.donor_id", "gift_soft_credits.donor_id",
  "donor_relationships.donor_id_a", "donor_relationships.donor_id_b", "volunteer_shifts.person_id",
  "volunteer_notes.person_id", "volunteer_applications.person_id", "volunteer_qualifications.person_id",
  "gifts.tribute_donor_id", "gifts.match_employer_id",
]);
// Tables CLEAN-1 itself created: nothing the old merge did can point into them.
const NEW_IN_CLEAN1 = new Set(["donor_address_history.donor_id", "ncoa_moves.donor_id"]);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Set DATABASE_URL."); process.exit(1); }
  const all = process.argv.includes("--all");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const client = new Client({ connectionString: url, ssl: local || process.env.DB_SSL === "disable" ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const [{ db, ro }] = (await client.query("SELECT current_database() AS db, current_setting('transaction_read_only') AS ro")).rows;
    if (ro !== "on") throw new Error("the transaction is not read-only; stopping before any query");
    console.log(`database: ${db} · transaction_read_only: ${ro}\n`);

    // The folded records: ids stay in memory, never printed.
    const victims = (await client.query(`
      SELECT d.org_id, d.id
        FROM donors d
       WHERE d.deleted_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM interactions i
                      WHERE i.org_id = d.org_id
                        AND i.created_at = d.deleted_at
                        AND i.note LIKE 'Merged duplicate record "%'
                        AND substr(i.note, 26, length(d.name) + 1) = d.name || '"')`)).rows;
    const softDeleted = (await client.query(`SELECT org_id, COUNT(*)::int AS n FROM donors WHERE deleted_at IS NOT NULL GROUP BY org_id`)).rows;
    const ids = victims.map(v => v.id);
    const perOrg = new Map();
    for (const v of victims) perOrg.set(v.org_id, (perOrg.get(v.org_id) || 0) + 1);
    console.log(`records folded away by the old merge: ${ids.length} in ${perOrg.size} org(s)`);
    for (const r of softDeleted.sort((a, b) => a.org_id.localeCompare(b.org_id))) {
      if (perOrg.has(r.org_id)) console.log(`  ${r.org_id}  ${perOrg.get(r.org_id)} folded by a merge, of ${r.n} soft-deleted`);
    }
    if (!ids.length) { console.log("\nNothing to count."); return; }

    const existing = new Set((await client.query(
      `SELECT table_name || '.' || column_name AS k FROM information_schema.columns WHERE table_schema = current_schema()`)).rows.map(r => r.k));
    const sections = [["Columns the old merge never moved", MERGE_REFS.filter(([t, c]) => !OLD_MOVED.has(`${t}.${c}`) && !NEW_IN_CLEAN1.has(`${t}.${c}`))]];
    if (all) sections.push(["Columns the old merge moved in its final form (earlier versions may have missed them)", MERGE_REFS.filter(([t, c]) => OLD_MOVED.has(`${t}.${c}`))]);

    for (const [title, refs] of sections) {
      console.log(`\n── ${title} ──`);
      const rows = [];
      for (const [t, c] of refs) {
        if (!existing.has(`${t}.${c}`)) { console.log(`  (${t}.${c} is not in this database; skipped)`); continue; }
        const shape = REF_SHAPE[`${t}.${c}`] || {};
        const where = shape.array ? `${c} && $1::text[]` : `${c} = ANY($1)${shape.where ? ` AND ${shape.where}` : ""}`;
        const r = (await client.query(`SELECT org_id, COUNT(*)::int AS n FROM ${t} WHERE ${where} GROUP BY org_id`, [ids])).rows;
        for (const x of r) rows.push({ org: x.org_id, col: `${t}.${c}`, n: x.n });
      }
      if (!rows.length) { console.log("  none: no row in these columns points at a folded record"); continue; }
      rows.sort((a, b) => a.org.localeCompare(b.org) || b.n - a.n || a.col.localeCompare(b.col));
      let org = null;
      for (const r of rows) {
        if (r.org !== org) { org = r.org; console.log(`  ${org}`); }
        console.log(`    ${r.col.padEnd(42)} ${String(r.n).padStart(6)}`);
      }
      const byCol = new Map();
      for (const r of rows) byCol.set(r.col, (byCol.get(r.col) || 0) + r.n);
      console.log(`  total: ${rows.reduce((a, r) => a + r.n, 0)} rows in ${byCol.size} column(s) across ${new Set(rows.map(r => r.org)).size} org(s)`);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

main().catch(e => { console.error("stopped:", e.message); process.exit(1); });
