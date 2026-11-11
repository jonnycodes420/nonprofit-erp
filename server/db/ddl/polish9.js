// server/db/ddl/polish9.js · POLISH-9. AN OLD IMPORT RECEIPT CAN BE ARCHIVED.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
// An archived import leaves the Imports list's main rows (it is still there
// under "Archived"); nothing about its gifts or people changes.
async function run(pool) {
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS archived_by TEXT`);
  await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS archived_by_name TEXT`);
}

module.exports = { run };
