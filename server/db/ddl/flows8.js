// server/db/ddl/flows8.js · FLOWS-8 (W-1112-Volunteers-34X). A GROUP SAVED FROM A REPORT REMEMBERS WHICH.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   audiences.source_report  the list report a hand-kept group was frozen from
//                            ("lybunt", "sybunt", "std:lapsed-24"); NULL for any other group
//   audiences.source_at      the org's day it was frozen (YYYY-MM-DD), the day its
//                            "N people have changed since" counts from
// No row is written here: groups saved before this build carry no source and
// show no drift line (they say nothing they can't show).
async function run(pool) {
  await pool.query(`ALTER TABLE audiences ADD COLUMN IF NOT EXISTS source_report TEXT`);
  await pool.query(`ALTER TABLE audiences ADD COLUMN IF NOT EXISTS source_at TEXT`);
}

module.exports = { run };
