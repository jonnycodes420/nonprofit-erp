// server/db/ddl/builds/2026-11-27-safeedit1.js · SAFE-EDIT-1. NO DOUBLE PEOPLE, AND A RESTORE RE-CHECKS.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short lock_timeout
// and a retry, so nothing here queues in front of live reads.
//
//   data_health_runs_trigger_check  rebuilt from server/dataHealth/triggers.js, so a
//                                   restore's re-check ("restore") is allowed. Widening a
//                                   CHECK refuses no row that is there today. Rebuilt only
//                                   when the stored definition is missing a word.
//   request_keys                    one row per create a double-click can repeat (a person,
//                                   a task): the key the browser sent with it and the row it
//                                   made, so the second click is answered with the first
//                                   row (server/shared/requestKey.js). Kept 2 days.
// No row is written here.
const { TRIGGERS, CHECK_SQL } = require("../../../dataHealth/triggers");

async function run(pool) {
  const [{ def } = {}] = (await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'data_health_runs_trigger_check'`)).rows || [];
  if (!def || TRIGGERS.some(t => !def.includes(`'${t}'`))) {
    await pool.query(`ALTER TABLE data_health_runs DROP CONSTRAINT IF EXISTS data_health_runs_trigger_check`);
    await pool.query(`ALTER TABLE data_health_runs ADD CONSTRAINT data_health_runs_trigger_check ${CHECK_SQL}`);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_keys (
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      record_id TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, kind, key)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_request_keys_created ON request_keys (created_at)`);
}

module.exports = { run };
