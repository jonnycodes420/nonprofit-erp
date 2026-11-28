// server/db/ddl/builds/2026-11-28-reports6.js · REPORTS-6. SCHEDULES TO NAMED PEOPLE, AND YOUR DASHBOARD.
//
// report_schedules         a saved report, the board pack or the board deck, sent weekly, monthly or
//                          quarterly on the org's day and hour to the addresses an admin typed
//                          (`recipients`, users or not). Soft-deleted (`deleted_at`), so Undo puts it back.
// report_schedule_sends    one row per schedule and period, RESERVED before the first email (the
//                          digest_sends discipline) and released when nothing was accepted. `sent_to`
//                          is who it went to; `held` is who it did not, each with the reason.
// report_schedule_unsubs   an address that pressed Unsubscribe on one schedule's email. That schedule
//                          never mails it again; nothing else changes.
// report_dashboard_tiles   the reports on one person's "Your dashboard", in order. No row is the
//                          default nine (shared list in server/reports/yourDashboard.js).
// report_action_batches    "Do something with these N people": what one press made (calls planned,
//                          a group, a mailing draft), so its Undo takes back exactly that.
// Additive; no row is written here.
"use strict";
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS report_schedules (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    target TEXT NOT NULL,
    target_name TEXT,
    frequency TEXT NOT NULL,
    day INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_sent_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    created_by_name TEXT
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS report_schedules_org ON report_schedules (org_id, target) WHERE deleted_at IS NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS report_schedule_sends (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    title TEXT,
    sent_to JSONB NOT NULL DEFAULT '[]'::jsonb,
    held JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    created_by_name TEXT
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS report_schedule_sends_once ON report_schedule_sends (schedule_id, period_key)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS report_schedule_unsubs (
    org_id TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    PRIMARY KEY (schedule_id, email)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS report_dashboard_tiles (
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    PRIMARY KEY (org_id, user_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS report_action_batches (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    report TEXT,
    count INTEGER NOT NULL DEFAULT 0,
    made JSONB NOT NULL DEFAULT '{}'::jsonb,
    undone_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    created_by_name TEXT
  )`);
}
module.exports = { run };
