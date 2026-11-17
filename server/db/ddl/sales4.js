// server/db/ddl/sales4.js · SALES-4: meetings read from the sales calendar, the stage moves they
// make (each with an Undo), and the prospect search's EIN and source link on an organization.
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession). The sales_
// tables have NO org_id (tenant-isolation allowlist).
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;

async function run(pool) {
  // A meeting read from the sales mailbox's calendar keeps the provider's event id, so a second
  // read updates the same activity rather than logging it twice.
  for (const col of ["provider_event_id TEXT", "source TEXT"]) await pool.query(`ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS ${col}`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_activities_event ON sales_activities (provider_event_id) WHERE provider_event_id IS NOT NULL`);
  // A stage move Steward made on its own (a calendar meeting moved a deal to Meeting booked).
  // undone_at is set when Jonathan presses Undo; the deal goes back to from_stage_id.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_auto_moves (
    id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, activity_id TEXT, from_stage_id TEXT, to_stage_id TEXT NOT NULL,
    from_name TEXT, to_name TEXT, why TEXT NOT NULL, undone_at TIMESTAMPTZ, undone_by TEXT, undone_by_name TEXT, ${ACTOR})`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_auto_moves_recent ON sales_auto_moves (created_at DESC) WHERE undone_at IS NULL`);
  // Part B: where a prospect row came from (ein and address are SALES-1 columns already).
  for (const col of ["source_url TEXT", "zip TEXT"]) await pool.query(`ALTER TABLE sales_orgs ADD COLUMN IF NOT EXISTS ${col}`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_orgs_ein ON sales_orgs (ein) WHERE ein IS NOT NULL AND deleted_at IS NULL`);
}

module.exports = { run };
