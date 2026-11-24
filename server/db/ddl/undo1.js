// server/db/ddl/undo1.js · UNDO-1. EVERY SIDE EFFECT RECORDS HOW TO TAKE IT BACK.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE never queues in front of reads.
//
//   write_effects   one row per side effect a write caused, and one header row
//                   (kind 'write') per write that has an Undo (server/effects/
//                   writeEffects.js). A side effect row holds the table, the row
//                   and its value BEFORE the write (NULL when the write created
//                   the row), so the one reverse helper can put it back, newest
//                   first. `cause_thread_id` names the next step whose close
//                   moved a journey on, so reopening that step moves it back.
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS write_effects (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    parent_kind TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    table_name TEXT,
    row_id TEXT,
    before JSONB,
    after JSONB,
    cause_thread_id TEXT,
    donor_id TEXT,
    sentence TEXT,
    undo JSONB,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    undone_at TIMESTAMPTZ,
    undone_by TEXT,
    undone_by_name TEXT,
    undo_reason TEXT
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS write_effects_parent ON write_effects (org_id, parent_kind, parent_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS write_effects_cause_thread ON write_effects (org_id, cause_thread_id) WHERE cause_thread_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS write_effects_recent ON write_effects (org_id, created_by, created_at DESC) WHERE kind = 'write'`);
}

module.exports = { run };
