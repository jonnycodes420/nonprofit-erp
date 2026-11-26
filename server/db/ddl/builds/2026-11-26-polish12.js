// server/db/ddl/builds/2026-11-26-polish12.js · POLISH-12 item 4. THE TOP 100 IS A SETTING, OFF UNLESS AN ORG TURNS IT ON.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
//   orgs.top100_enabled  false for every org until Jonathan (super admin) or
//                        the org's admin turns it on (server/org/menu.js).
// No row is written here: an org that already has people on its Top 100 is
// turned on by scripts/ops/polish12-top100-keep.js, which Jonathan runs.
async function run(pool) {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS top100_enabled BOOLEAN NOT NULL DEFAULT false`);
}

module.exports = { run };
