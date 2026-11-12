// server/db/ddl/sales2b.js · SALES-2 Part B: cadences, partner referral links, customer referrals.
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession). Every table
// is prefixed `sales_` and has NO org_id: sales data is no org's (tenant-isolation allowlist).
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;
const EDITED = `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_by_name TEXT`;

async function run(pool) {
  // A cadence: a named list of steps, each { day, action: call|email|linkedin|custom, template?, text? }.
  // `builtin`: "customer_asks" for the one started when a deal reaches Paying.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_cadences (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, steps JSONB NOT NULL DEFAULT '[]'::jsonb, builtin TEXT, deleted_at TIMESTAMPTZ, ${ACTOR}, ${EDITED})`);
  // One contact in one cadence. Ended by a reply, a Connected outcome, a booked meeting, Do not
  // contact, or by hand (end_reason); its open step tasks are closed then.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_cadence_enrollments (
    id TEXT PRIMARY KEY, cadence_id TEXT NOT NULL, contact_id TEXT NOT NULL, deal_id TEXT, started_on DATE NOT NULL,
    ended_at TIMESTAMPTZ, end_reason TEXT, ${ACTOR})`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_cadence_enrollments_contact ON sales_cadence_enrollments (contact_id) WHERE ended_at IS NULL`);
  // A step task knows its enrollment and its action.
  for (const col of ["enrollment_id TEXT", "step_action TEXT"]) await pool.query(`ALTER TABLE sales_activities ADD COLUMN IF NOT EXISTS ${col}`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_activities_enrollment ON sales_activities (enrollment_id) WHERE enrollment_id IS NOT NULL`);
  // A partner's private referral link: only the token's hash is kept.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_referral_links (
    id TEXT PRIMARY KEY, partner_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, revoked_at TIMESTAMPTZ, ${ACTOR})`);
  // Where a deal came from: a partner's link, or a customer who referred it.
  for (const col of ["referral_link_id TEXT", "referred_by_sales_org_id TEXT"]) await pool.query(`ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS ${col}`);
}

module.exports = { run };
