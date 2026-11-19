// server/db/ddl/flows19.js · FLOWS-19 item 5. WHO WAS ON RE-ENGAGE, EACH DAY.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE never queues in front of reads.
//
//   reengage_snapshots   one row per org per org-day: who Re-engage held that
//                        day ({ id, last } each, `last` the giving unit's last
//                        gift), written once by the hourly job
//                        (server/donors/reengageChange.js), so the line under the
//                        count can say who moved since and why.
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS reengage_snapshots (
    org_id TEXT NOT NULL REFERENCES orgs(id),
    day TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    people JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, day)
  )`);
}

module.exports = { run };
