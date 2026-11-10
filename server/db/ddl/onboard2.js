// server/db/ddl/onboard2.js · ONBOARD-2: the onboarding board. Additive only.
// Runs on the init session (lock_timeout and retry, schema.js ddlSession).
"use strict";

async function run(pool) {
  // ONBOARD-1 writes these two signals; declared here too (IF NOT EXISTS, the
  // same type) so the board reads them whichever build lands first.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS paper_done_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS data_in_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS billing_card_saved_at TIMESTAMPTZ`);

  // One row per org in onboarding. `stage`, `entered_at` and `blockers` are
  // WRITTEN ONLY BY THE RECOMPUTE (server/onboard/board.js), from signals.
  // The hand-entered facts are `verbal_yes_on` (starts the paper clock) and
  // `waiting_on` (words for Jonathan; never a gate). `stripe_ok_at` is Stripe's
  // own charges_enabled, asked by the worker; `home_opened_at` is the first
  // time a person at the org (not Steward) opened Home.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS org_onboarding (
      org_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL DEFAULT 'paper',
      entered_at JSONB NOT NULL DEFAULT '{}'::jsonb,
      blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
      flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      red BOOLEAN NOT NULL DEFAULT false,
      computed_at TIMESTAMPTZ,
      verbal_yes_on DATE,
      waiting_on TEXT,
      stripe_ok_at TIMESTAMPTZ,
      stripe_checked_at TIMESTAMPTZ,
      home_opened_at TIMESTAMPTZ,
      home_opened_by TEXT,
      flagged_day14_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      updated_by TEXT,
      updated_by_name TEXT
    )`);
  // Jonathan's morning line is sent once a day, whichever process wins.
  await pool.query(`CREATE TABLE IF NOT EXISTS onboarding_morning_sends (day DATE PRIMARY KEY, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), lines INTEGER NOT NULL)`);
}

module.exports = { run };
