// server/db/ddl/sales1.js · SALES-1: Steward's own sales CRM, in /ops. Additive only.
// Runs on the init session (lock_timeout and retry, schema.js ddlSession).
//
// Every table is prefixed `sales_` and has NO org_id: sales data is no org's.
// No org export, seed, tenant query or org route reads these tables; only the
// /ops/sales routes do, behind the super-admin door (server/admin/sales/routes.js).
// tests/tenant-isolation.test.js keeps them on its allowlist and proves an org
// admin cannot reach them.
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;
const EDITED = `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_by_name TEXT`;

async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_orgs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, website TEXT, phone TEXT, address TEXT, city TEXT, state TEXT,
    revenue_band TEXT, current_crm TEXT, nonprofit_type TEXT, owner_id TEXT, steward_org_id TEXT,
    props JSONB NOT NULL DEFAULT '{}'::jsonb, import_id TEXT, deleted_at TIMESTAMPTZ, merged_into TEXT,
    ${ACTOR}, ${EDITED})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_contacts (
    id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT, title TEXT,
    emails JSONB NOT NULL DEFAULT '[]'::jsonb, phones JSONB NOT NULL DEFAULT '[]'::jsonb, role TEXT, owner_id TEXT,
    props JSONB NOT NULL DEFAULT '{}'::jsonb, import_id TEXT, deleted_at TIMESTAMPTZ, merged_into TEXT,
    ${ACTOR}, ${EDITED})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_pipelines (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, ${ACTOR})`);
  // kind: open | won | later | lost. `onboarding`: a deal at this stage shows ONBOARD-2's gates.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_stages (
    id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    probability INTEGER NOT NULL DEFAULT 0, limit_days INTEGER NOT NULL DEFAULT 21, kind TEXT NOT NULL DEFAULT 'open',
    onboarding BOOLEAN NOT NULL DEFAULT false, ${ACTOR})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_deals (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, pipeline_id TEXT, stage_id TEXT, value_cents BIGINT NOT NULL DEFAULT 0,
    close_date DATE, source TEXT, owner_id TEXT, lost_reason TEXT, next_step TEXT, next_step_on DATE, trial_ends_on DATE, revisit_on DATE,
    stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), won_at TIMESTAMPTZ, lost_at TIMESTAMPTZ,
    props JSONB NOT NULL DEFAULT '{}'::jsonb, import_id TEXT, deleted_at TIMESTAMPTZ,
    ${ACTOR}, ${EDITED})`);
  await pool.query(`ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS revisit_on DATE`);   // Later's revisit day
  // Associations, many to many. a/b are stored in one order per pair:
  // contact→org, deal→org, deal→contact. A deal has one primary org; a contact one primary org.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_links (
    id TEXT PRIMARY KEY, a_type TEXT NOT NULL, a_id TEXT NOT NULL, b_type TEXT NOT NULL, b_id TEXT NOT NULL,
    label TEXT, is_primary BOOLEAN NOT NULL DEFAULT false, import_id TEXT, ${ACTOR})`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_links_pair ON sales_links (a_type, a_id, b_type, b_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_links_b ON sales_links (b_type, b_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_properties (
    id TEXT PRIMARY KEY, object TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb, position INTEGER NOT NULL DEFAULT 0, ${ACTOR})`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_properties_key ON sales_properties (object, key)`);
  // kind: call | meeting | note | task. A task has due_on, and done_at once done.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_activities (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), body TEXT, owner_id TEXT,
    due_on DATE, done_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, ${ACTOR}, ${EDITED})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_activity_links (
    activity_id TEXT NOT NULL, record_type TEXT NOT NULL, record_id TEXT NOT NULL, ${ACTOR},
    PRIMARY KEY (activity_id, record_type, record_id))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_activity_links_rec ON sales_activity_links (record_type, record_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_stage_history (
    id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, from_stage_id TEXT, to_stage_id TEXT, from_name TEXT, to_name TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ${ACTOR})`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_stage_history_deal ON sales_stage_history (deal_id, at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_views (
    id TEXT PRIMARY KEY, object TEXT NOT NULL, name TEXT NOT NULL, config JSONB NOT NULL DEFAULT '{}'::jsonb, ${ACTOR})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_merges (
    id TEXT PRIMARY KEY, object TEXT NOT NULL, kept_id TEXT NOT NULL, gone_id TEXT NOT NULL,
    gone_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, moved JSONB NOT NULL DEFAULT '{}'::jsonb, ${ACTOR})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_imports (
    id TEXT PRIMARY KEY, object TEXT NOT NULL, file_name TEXT, mode TEXT NOT NULL, counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_before JSONB NOT NULL DEFAULT '[]'::jsonb, undone_at TIMESTAMPTZ, undone_by TEXT, ${ACTOR})`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_settings (
    key TEXT PRIMARY KEY, value JSONB NOT NULL, ${ACTOR}, ${EDITED})`);
}

module.exports = { run };
