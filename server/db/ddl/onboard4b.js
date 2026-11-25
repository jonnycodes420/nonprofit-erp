// server/db/ddl/onboard4b.js · ONBOARD-4 Part B: the guided setup on Home and "Send it to us".
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession).
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;

async function run(pool) {
  // The guided setup's one stored fact per org: the steps she chose to skip for now
  // (a skipped step comes back with one click). Every done-state is read, never stored.
  await pool.query(`CREATE TABLE IF NOT EXISTS onboard_guided (
    org_id TEXT PRIMARY KEY REFERENCES orgs(id), skipped JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_by_name TEXT, ${ACTOR})`);
  // "Send it to us": her donor file, kept until a person on /ops presses Load. The mapper's
  // first pass is `mapping` (what the importer understood) and `sheets` (the cells it read,
  // so Load writes exactly what was reviewed). Load runs the spreadsheet import, whose run
  // id is `import_id` and whose Undo is the import's own.
  await pool.query(`CREATE TABLE IF NOT EXISTS onboard_concierge_jobs (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), source TEXT NOT NULL DEFAULT 'upload',
    booking_id TEXT, file_name TEXT NOT NULL, file_type TEXT, file_size INTEGER, file_data BYTEA,
    note TEXT, sheets JSONB, mapping JSONB, mapped_at TIMESTAMPTZ, mapped_by TEXT, mapped_by_name TEXT, map_error TEXT,
    loaded_at TIMESTAMPTZ, loaded_by TEXT, loaded_by_name TEXT, load_error TEXT, import_id TEXT, ${ACTOR})`);
  await pool.query(`CREATE INDEX IF NOT EXISTS onboard_concierge_jobs_org ON onboard_concierge_jobs (org_id, created_at)`);
  // A booking's file becomes one job, once.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS onboard_concierge_jobs_booking ON onboard_concierge_jobs (booking_id) WHERE booking_id IS NOT NULL`);
}

module.exports = { run };
