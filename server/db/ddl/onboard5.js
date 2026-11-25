// server/db/ddl/onboard5.js · ONBOARD-5: setup is one calm page at a time.
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession).
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;

async function run(pool) {
  // The page she was on (she comes back to it), the steps she confirmed by pressing
  // Continue (the two with nothing to connect: funds and how you talk), and when
  // "Go to Home" finished setup. Every other done-state is read, never stored.
  await pool.query(`ALTER TABLE onboard_guided ADD COLUMN IF NOT EXISTS current_step TEXT`);
  await pool.query(`ALTER TABLE onboard_guided ADD COLUMN IF NOT EXISTS confirmed JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE onboard_guided ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE onboard_guided ADD COLUMN IF NOT EXISTS finished_by TEXT`);
  await pool.query(`ALTER TABLE onboard_guided ADD COLUMN IF NOT EXISTS finished_by_name TEXT`);
  // How a couple is addressed (HOUSEHOLD-1's addressee): null is "Debbie and Jeff Vogel";
  // otherwise a pattern of {first1} {first2} {last} (shared/numbers/householdGiving.js).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS addressee_pattern TEXT`);
  // Her events each year: a name, the month it happens, and the month its tax letters go.
  await pool.query(`CREATE TABLE IF NOT EXISTS org_yearly_events (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), name TEXT NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12), letters_month INTEGER CHECK (letters_month BETWEEN 1 AND 12),
    deleted_at TIMESTAMPTZ, ${ACTOR})`);
  await pool.query(`CREATE INDEX IF NOT EXISTS org_yearly_events_org ON org_yearly_events (org_id)`);
}

module.exports = { run };
