// server/db/scale4Indexes.js · SCALE-4. A GIFT'S DAY, INDEXED.
//
// Retention over two windows (figureSources "retention-window-prior" and
// "-kept", which Annual, Fundraising and the retention cards ask) reads gifts
// by LEFT(date, 10): a gift's civil day, whatever an import left after it. The
// (org_id, date) index cannot answer LEFT(date, 10), so each read went through
// every gift the org has: 146 and 168 ms of a 25,000-person org's Annual. An
// index on the same expression answers it from the window alone (~60 ms). The
// rule, the SQL and the answer are unchanged; only the plan is.
//
//   gifts_org_day   (org_id, LEFT(date, 10))
//
// HOW IT IS BUILT, SO A DEPLOY NEVER STALLS THE LIVE SITE OR CHANGES A ROW
// (LIST-5's way):
// - Additive only, CREATE INDEX CONCURRENTLY IF NOT EXISTS, outside any
//   transaction, on one session with lock_timeout; a busy lock waits and tries again.
// - Started after the schema and NOT awaited: boot never waits for it.
// - Then ANALYZE gifts, so the planner has the expression's statistics
//   (it takes no lock that stops a write).
// - A half-built (INVALID) index from an interrupted build is dropped and built again.
// - Errors are logged, never thrown.
"use strict";

const INDEXES = [{ name: "gifts_org_day", table: "gifts", sql: "(org_id, (LEFT(date, 10)))" }];
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

async function ensureScale4Indexes(pool) {
  const client = await pool.connect();
  const out = {};
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query("SELECT pg_advisory_lock(hashtext('scale4-indexes'))");
    for (const ix of INDEXES) {
      try {
        const [have] = (await client.query(
          `SELECT i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
            WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`, [ix.name])).rows;
        if (have && have.indisvalid) { out[ix.name] = "present"; continue; }
        if (have) await withRetry(client, `DROP INDEX CONCURRENTLY IF EXISTS ${ix.name}`);
        await withRetry(client, `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${ix.name} ON ${ix.table} ${ix.sql}`);
        await withRetry(client, `ANALYZE ${ix.table}`);
        out[ix.name] = "built";
      } catch (e) {
        console.error(`[scale4-indexes] ${ix.name}: ${e.message}`);
        out[ix.name] = `error: ${e.message}`;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('scale4-indexes'))").catch(() => {});
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
  return out;
}

module.exports = { ensureScale4Indexes, INDEXES };
