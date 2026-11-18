// server/db/ddl/edit2.js · EDIT-2 item 3. ONE TOUCH, LOGGED TO MANY PEOPLE AT ONCE.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   touch_batches               one row per "Log a touch" to many people
//                               (server/donors/touchBatch.js): what, when, who,
//                               how many, and when it was undone.
//   interactions.touch_batch_id the batch a logged touch came in on; its one
//                               Undo takes back every row carrying it. NULL for a
//                               touch logged on its own.
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS touch_batches (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    touch_kind TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT,
    date TEXT NOT NULL,
    people INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    follow_up_due TEXT,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by TEXT,
    undone_by_name TEXT
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_touch_batches_org ON touch_batches (org_id, created_at DESC)`);
  await pool.query(`ALTER TABLE interactions ADD COLUMN IF NOT EXISTS touch_batch_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_touch_batch ON interactions (org_id, touch_batch_id) WHERE touch_batch_id IS NOT NULL`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS touch_batch_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_touch_batch ON tasks (org_id, touch_batch_id) WHERE touch_batch_id IS NOT NULL`);
}

module.exports = { run };
