// server/db/ddl/sends2.js · SENDS-2. A SEND TO MORE THAN ONE PERSON HAS A PLAN.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE never queues in front of reads.
//
//   send_plans            one row per list a person was shown before a bulk send
//                         (server/mail/sendPlan.js): who, which subject, what will
//                         be refused and why. Committed once, by the same person,
//                         within 10 minutes; `items` is exactly what may go.
//   send_confirms.plan_id the plan a confirm was minted under, so a confirm for
//                         the second person in one request always names the list
//                         she saw (null for a one-person send).
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS send_plans (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    refused JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    committed_at TIMESTAMPTZ,
    committed_by TEXT,
    result JSONB
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS send_plans_org_created ON send_plans (org_id, created_at DESC)`);
  await pool.query(`ALTER TABLE send_confirms ADD COLUMN IF NOT EXISTS plan_id TEXT`);
}

module.exports = { run };
