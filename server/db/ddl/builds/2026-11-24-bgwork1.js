// server/db/ddl/builds/2026-11-24-bgwork1.js · BGWORK-1. A TEST ORG WHOSE BACKGROUND WORK RUNS ON PURPOSE.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   orgs.run_background_work   true: the super admin's "Run background work for
//                              this test org" switch (Admin → the org). SCALE-5's
//                              live-org list (server/orgs/liveOrgs.js) keeps the
//                              org whatever its kind, so its mailbox is read and
//                              its stale alarm is checked. NULL/false: its kind decides.
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS run_background_work BOOLEAN`);
}

module.exports = { run };
