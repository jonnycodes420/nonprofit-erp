// server/db/ddl/touch1.js · TOUCH-1. AN ORG'S OWN KINDS OF TOUCH.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
//
// "Log a touch" offers Call, Handwritten note, Email, Visit, Meeting, Gift
// sent, Event invite, Text and Other (shared/touchKinds.js). An org adds its
// own in Settings ("Board tour", "Birthday card"): one row each. Taking one
// away archives it, so a touch already logged as it keeps its words.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS org_touch_types (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      label TEXT NOT NULL,
      archived_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_touch_types_label ON org_touch_types (org_id, lower(label)) WHERE archived_at IS NULL`);
}

module.exports = { run };
