// server/db/ddl/sales2.js · SALES-2 Part A: prospect lists, fit, call mode, Do not contact,
// email drafts and booked meetings. Additive only, on the init session (lock_timeout and
// retry, schema.js ddlSession). Every table is prefixed `sales_` and has NO org_id: sales data
// is no org's, and tests/tenant-isolation.test.js keeps it on its allowlist.
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;
const EDITED = `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_by_name TEXT`;

async function run(pool) {
  // An org: its EIN and revenue in whole dollars (the fit rule reads the number, not the band),
  // Do not contact (with reason, day and who), a "not a fit" close from call mode, and the
  // numbers call mode found to be wrong.
  for (const col of ["ein TEXT", "revenue BIGINT", "dnc_at TIMESTAMPTZ", "dnc_reason TEXT", "dnc_by_name TEXT",
    "lost_at TIMESTAMPTZ", "lost_reason TEXT", "bad_phones JSONB NOT NULL DEFAULT '[]'::jsonb"]) {
    await pool.query(`ALTER TABLE sales_orgs ADD COLUMN IF NOT EXISTS ${col}`);
  }
  for (const col of ["dnc_at TIMESTAMPTZ", "dnc_reason TEXT", "dnc_by_name TEXT", "bad_phones JSONB NOT NULL DEFAULT '[]'::jsonb"]) {
    await pool.query(`ALTER TABLE sales_contacts ADD COLUMN IF NOT EXISTS ${col}`);
  }
  // A call's outcome (call mode), the list it was dialled from, and a meeting's details
  // ({ date, time, place, attendees }) and its "How did it go?" answer (outcome).
  for (const col of ["outcome TEXT", "list_id TEXT", "meeting JSONB"]) {
    await pool.query(`ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_activities_kind_at ON sales_activities (kind, at)`);
  // A prospect list: a saved view (config: { filters, sort }) plus its own membership.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_lists (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, config JSONB NOT NULL DEFAULT '{}'::jsonb, deleted_at TIMESTAMPTZ, ${ACTOR}, ${EDITED})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_list_members (
    list_id TEXT NOT NULL, org_id TEXT NOT NULL, import_id TEXT, ${ACTOR}, PRIMARY KEY (list_id, org_id))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_list_members_org ON sales_list_members (org_id)`);
  await pool.query(`ALTER TABLE sales_imports ADD COLUMN IF NOT EXISTS list_id TEXT`);
}

module.exports = { run };
