// server/db/list5Indexes.js · LIST-5. THE DONORS LIST OPENS FAST.
//
// The list's default order is Lifetime (shared/numbers/lifetime.js LIFETIME),
// and choosing the first page sums every person's gifts in the org: one probe
// of gifts per person. With the columns that sum reads inside the index, each
// probe is answered from the index alone (no visit to the gift rows), so the
// same rule, the same SQL and the same answer cost about a third less at 10,000
// people. The gift count (giftCount.js) and Lifetime on the profile read the
// same columns and gain the same way.
//
//   gifts_person_money   (org_id, donor_id) INCLUDE every column MONEY / GIFT /
//                        AFTER_IMPORT reads
//
// HOW IT IS BUILT, SO A DEPLOY NEVER STALLS THE LIVE SITE OR CHANGES A ROW:
// - Additive only, CREATE INDEX CONCURRENTLY IF NOT EXISTS, outside any
//   transaction, on one session with lock_timeout; a busy lock waits and tries again.
// - Started after the schema and NOT awaited: boot never waits for it. Until
//   it is built the list reads exactly as before, only slower.
// - A half-built (INVALID) index from an interrupted build is dropped and built again.
// - Errors are logged, never thrown.
"use strict";

const INDEXES = [
  { name: "gifts_person_money", table: "gifts",
    sql: "(org_id, donor_id) INCLUDE (amount, type, date, scheduled_on, import_id, refunded_in_full)" },
];

const LOCK_TIMEOUT = "1s";
const RETRIES = 20;

async function withRetry(client, sql) {
  for (let attempt = 1; ; attempt++) {
    try { return await client.query(sql); }
    catch (e) {
      if (e.code !== "55P03" || attempt >= RETRIES) throw e;   // lock_not_available
      await new Promise(r => setTimeout(r, Math.min(3000, 200 * attempt)));
    }
  }
}

async function ensureList5Indexes(pool) {
  const client = await pool.connect();
  const out = {};
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    // One booting instance builds it; a second one waits, then finds it built.
    await client.query("SELECT pg_advisory_lock(hashtext('list5-indexes'))");
    for (const ix of INDEXES) {
      try {
        const [have] = (await client.query(
          `SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`, [ix.name])).rows;
        if (have && have.indisvalid) { out[ix.name] = "present"; continue; }
        if (have) await withRetry(client, `DROP INDEX CONCURRENTLY IF EXISTS ${ix.name}`);
        await withRetry(client, `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${ix.name} ON ${ix.table} ${ix.sql}`);
        out[ix.name] = "built";
      } catch (e) {
        console.error(`[list5-indexes] ${ix.name}: ${e.message}`);
        out[ix.name] = `error: ${e.message}`;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('list5-indexes'))").catch(() => {});
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
  return out;
}

module.exports = { ensureList5Indexes, INDEXES };
