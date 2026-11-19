// server/db/ddl/onboard3.js · ONBOARD-3: onboarding that ends in a win. Additive only.
// Runs on the init session (lock_timeout and retry, schema.js ddlSession).
"use strict";

async function run(pool) {
  // When "Does this match your old system?" became due: the first donor file
  // into an org that has no data-in yet (server/onboard/totals.js markDue).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS totals_due_at TIMESTAMPTZ`);

  // "Looks right": the press that sets orgs.data_in_at, with what Steward
  // showed and what the director typed for each year (cents, or null).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboard_totals_checks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      years JSONB NOT NULL DEFAULT '[]'::jsonb,
      asked_jonathan JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS onboard_totals_checks_org ON onboard_totals_checks (org_id, created_at DESC)`);

  // "Your first 30 minutes" on Home: seen, dismissed (comes back until done),
  // done, and the one time "done" was said.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboard_first_session (
      org_id TEXT PRIMARY KEY,
      seen_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      done_at TIMESTAMPTZ,
      done_told_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL
    )`);

  // Part B: the day-30 readout, dismissed from Home (it stays on /ops).
  await pool.query(`ALTER TABLE onboard_first_session ADD COLUMN IF NOT EXISTS readout_dismissed_at TIMESTAMPTZ`);

  // The day-one list (Part B): who was lapsed or lapsing at data-in, with
  // their last-12-months giving then. One row per person; written once.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboard_snapshots (
      org_id TEXT NOT NULL,
      donor_id TEXT NOT NULL,
      state TEXT NOT NULL,
      last12_cents BIGINT NOT NULL DEFAULT 0,
      taken_on DATE NOT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      PRIMARY KEY (org_id, donor_id)
    )`);
}

module.exports = { run };
