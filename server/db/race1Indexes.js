// server/db/race1Indexes.js · RACE-1. THE UNIQUE INDEXES BEHIND THE WRITE-ONCE PATHS.
//
// Each write-once path takes its turn under server/shared/personLock.js; the
// index is the database saying the same rule, so a writer that forgets the
// lock still cannot make a second row.
//
//   tasks_one_repeat_per_parent        a done repeating task makes one next one
//   receipts_number_once               a receipt number is never used twice in an org
//   milestone_drafts_journey_step_once one draft per journey step
//   tasks_one_thanks_per_gift          one thank-you task per gift (SENDS-1)
//   invites_one_pending_per_email      one pending invite per address in an org (INTEGRITY-1)
//
// HOW IT IS BUILT, SO A DEPLOY NEVER STALLS THE LIVE SITE OR CHANGES A ROW:
// - Additive only, CREATE UNIQUE INDEX CONCURRENTLY, outside any transaction,
//   on one session with lock_timeout (the ddlSession rule in schema.js); a
//   busy lock waits and tries again.
// - An index whose rows already break the rule is NOT built and no row is
//   touched: the boot log names it and how many keys repeat. A person decides.
// - A half-built (INVALID) index from an interrupted build is dropped and built again.
// - Errors are logged, never thrown: the server boots either way.
"use strict";

const INDEXES = [
  { name: "tasks_one_repeat_per_parent", table: "tasks",
    cols: "(org_id, recur_parent_id)", where: "recur_parent_id IS NOT NULL" },
  { name: "receipts_number_once", table: "receipts",
    cols: "(org_id, receipt_number)", where: "receipt_number IS NOT NULL" },
  { name: "milestone_drafts_journey_step_once", table: "milestone_drafts",
    cols: "(org_id, milestone_key)", where: "milestone_key LIKE 'journey-step:%'" },
  // SENDS-1: one thank-you task per gift (server/shared/thankYouOnce.js).
  { name: "tasks_one_thanks_per_gift", table: "tasks",
    cols: "(org_id, thanks_gift_id)", where: "thanks_gift_id IS NOT NULL AND voided_at IS NULL" },
  // INTEGRITY-1 (W-1107-Atlas-27X): one pending invite per address in an org. WALKB-2's
  // guard checked, then inserted; two presses at once made two. Until
  // scripts/ops/integrity1-duplicate-invites.js has revoked the extras, the
  // boot log says it was not built, and no row is changed.
  { name: "invites_one_pending_per_email", table: "invites",
    cols: "(org_id, lower(email))", where: "accepted_at IS NULL AND revoked_at IS NULL" },
];

const LOCK_TIMEOUT = "1s";
const RETRIES = 20;

async function withRetry(client, sql, params) {
  for (let attempt = 1; ; attempt++) {
    try { return await client.query(sql, params); }
    catch (e) {
      if (e.code !== "55P03" || attempt >= RETRIES) throw e;   // lock_not_available
      await new Promise(r => setTimeout(r, Math.min(3000, 200 * attempt)));
    }
  }
}

async function ensureRace1Indexes(pool) {
  const client = await pool.connect();
  const out = {};
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    // One booting instance builds them; a second one waits, then finds them built.
    await client.query("SELECT pg_advisory_lock(hashtext('race1-indexes'))");
    for (const ix of INDEXES) {
      try {
        const [have] = (await client.query(
          `SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`, [ix.name])).rows;
        if (have && have.indisvalid) { out[ix.name] = "present"; continue; }
        if (have) await withRetry(client, `DROP INDEX CONCURRENTLY IF EXISTS ${ix.name}`);
        const [dup] = (await client.query(
          `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM ${ix.table} WHERE ${ix.where}
             GROUP BY ${ix.cols.slice(1, -1)} HAVING COUNT(*) > 1) d`)).rows;
        if (dup.n > 0) {
          console.warn(`[race1-indexes] ${ix.name} NOT built: ${dup.n} key(s) already repeat in ${ix.table}. No row was changed.`);
          out[ix.name] = `skipped: ${dup.n} repeated`;
          continue;
        }
        await withRetry(client, `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${ix.name} ON ${ix.table} ${ix.cols} WHERE ${ix.where}`);
        out[ix.name] = "built";
      } catch (e) {
        console.error(`[race1-indexes] ${ix.name}: ${e.message}`);
        out[ix.name] = `error: ${e.message}`;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('race1-indexes'))").catch(() => {});
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
  return out;
}

module.exports = { ensureRace1Indexes, INDEXES };
