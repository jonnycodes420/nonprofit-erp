// server/db/ddl/polish11.js · POLISH-11: when a volunteer's status last changed, so its Undo
// window (a day) can be read back. Additive only, on the init session.
"use strict";

async function run(pool) {
  await pool.query(`ALTER TABLE volunteer_records ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ`);
}

module.exports = { run };
