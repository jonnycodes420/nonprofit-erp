// server/db/ddl/quickadd1.js · QUICKADD-1. AN APPEAL ON A GIFT.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
//
// A campaign is the goal a gift counts toward (Good Giving Challenge 2026); an
// appeal is the ask that brought it in (the November letter, the challenge's
// match day). Bloomerang, DonorPerfect and Little Green Light keep the two
// apart, and a gift typed from a challenge needs both. An appeal may sit under
// a campaign; it moves no thermometer and no total of its own.
async function run(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      campaign_id TEXT,
      archived_at TIMESTAMPTZ,
      created_by TEXT,
      created_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS appeals_org_name_uk ON appeals (org_id, lower(name)) WHERE archived_at IS NULL`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS appeal_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifts_appeal ON gifts (org_id, appeal_id) WHERE appeal_id IS NOT NULL`);
}

module.exports = { run };
