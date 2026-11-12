// SPLIT-2: moved VERBATIM from db.js (the boot DDL). db.js re-exports it, so no caller changed.
// Each "SPLIT-2 db.js piece N" block is db.js's own text; tests read db.js through
// readSource("db.js"), which puts the pieces back in order.
const { pool } = require("./pool");
const { SCHEMA_HASH } = require("./schemaHash");

// SPLIT-2 db.js piece 35

async function schemaUnchanged() {
  if (process.env.SCHEMA_INIT_FORCE === "1") return false;
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  const r = await pool.query(`SELECT schema_hash FROM schema_meta WHERE id = 1`);
  return r.rows.length > 0 && r.rows[0].schema_hash === SCHEMA_HASH;
}
// SPLIT-2 end
// SPLIT-2 db.js piece 36

// FIX-20 Part 10: schema init runs while the OLD instance is still serving
// (Railway now waits for /ready before it switches). An ALTER TABLE queued
// behind a long read holds every later read on that table behind it, so a
// deploy could stall the live site. Init therefore runs on ONE session with a
// short lock_timeout: a statement that cannot take its lock at once gives up,
// waits, and tries again, and never sits in the queue in front of live reads.
const DDL_LOCK_TIMEOUT = "1s";
// SPLIT-2 end
// SPLIT-2 db.js piece 37
const DDL_RETRIES = 40;
// SPLIT-2 end
// SPLIT-2 db.js piece 38
async function ddlSession() {
  const client = await pool.connect();
  await client.query(`SET lock_timeout = '${DDL_LOCK_TIMEOUT}'`);
  return {
    async query(sql, params) {
      for (let attempt = 1; ; attempt++) {
        try { return await client.query(sql, params); }
        catch (e) {
          if (e.code !== "55P03" || attempt >= DDL_RETRIES) throw e;   // 55P03: lock_not_available
          console.warn(`[schema] a lock was busy (attempt ${attempt}); waiting so live reads go first`);
          await new Promise(r => setTimeout(r, Math.min(5000, 250 * attempt)));
        }
      }
    },
    async release() {
      await client.query("RESET lock_timeout").catch(() => {});
      client.release();
    },
  };
}
// SPLIT-2 end
// SPLIT-2 db.js piece 39

// Returns true when the DDL ran, false when the unchanged hash skipped it.
async function initSchemaNow() {
  if (await schemaUnchanged()) {
    // SCALE-2: the change triggers follow orgSummary.js, not this file's
    // hash, so a boot on an unchanged schema still brings them up to date
    // (one read when nothing is missing).
    const s = await ddlSession();
    try { await require("../../orgSummary").installTriggers(s); await lockDb(s); } finally { await s.release(); }
    return false;
  }
  const ddl = await ddlSession();
  try { await runSchemaInit(ddl); await lockDb(ddl); }
  finally { await ddl.release(); }
  return true;
}
// SPLIT-2 end
// SPLIT-2 db.js piece 40

// SECURE-3 · the database's own lock (server/admin/dbLock.js): RLS on every
// public table, nothing granted to Supabase's API roles. LAST, on every boot,
// so a table created since the last one is covered. A failure is loud and the
// server still boots: the API never depended on it, only a leaked key would.
async function lockDb(session) {
  try { await require("../admin/dbLock").lockPublicSchema(session); }
  catch (e) { console.error("[db-lock] CRITICAL: the database lock did not run:", e.message); }
}
// SPLIT-2 end
// SPLIT-2 db.js piece 41

// The DDL itself. `pool` here is the init session above, not the module pool.
async function runSchemaInit(pool) {
// SPLIT-2 end
  await require("./ddl/part1").run(pool);
  await require("./ddl/part2").run(pool);
  await require("./ddl/part3").run(pool);
  await require("./ddl/part4").run(pool);
  await require("./ddl/part5").run(pool);
  await require("./ddl/part6").run(pool);
  await require("./ddl/onboard1").run(pool);   // ONBOARD-1: start links, signatures, staged imports
  await require("./ddl/part7").run(pool);
  await require("./ddl/onboard2").run(pool);   // ONBOARD-2: the onboarding board
  await require("./ddl/sales1").run(pool);   // SALES-1: the sales CRM in /ops (no org_id, super-admin only)
  await require("./ddl/sales1b").run(pool);   // SALES-1 Part B: the sales mailbox, partners and payouts
  await require("./ddl/sales2").run(pool);   // SALES-2: prospect lists, fit, call mode, Do not contact, meetings
  await require("./ddl/sales2b").run(pool);   // SALES-2 Part B: cadences, partner referral links, customer referrals
// SPLIT-2 db.js piece 49
}
// SPLIT-2 end

// RACE-1: after the schema, changed or not, the unique indexes behind the
// write-once paths, built CONCURRENTLY (server/db/race1Indexes.js). Never fails boot.
async function initSchema() {
  const ran = await initSchemaNow();
  await require("./race1Indexes").ensureRace1Indexes(pool)
    .catch(err => console.error("[race1-indexes] not built (server continues):", err.message));
  // LIST-5: the Donors list's index, built in the background; boot never waits for it.
  require("./list5Indexes").ensureList5Indexes(pool)
    .catch(err => console.error("[list5-indexes] not built (server continues):", err.message));
  return ran;
}
module.exports = { initSchema, runSchemaInit };
