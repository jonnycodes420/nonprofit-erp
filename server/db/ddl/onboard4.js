// server/db/ddl/onboard4.js · ONBOARD-4 Part A: the booking page and partner codes.
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession).
// Neither table has an org_id: a booking is a prospect's, before any Steward org exists,
// and a partner code is Steward's own. Read only by server/admin/sales/ and server/onboard/.
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;

async function run(pool) {
  // A partner code (Mission Increase Gulf Coast and the like): the code in /book?partner=<code>,
  // the name shown as "Recommended by <name>", and the market the give-back fund counts by.
  // No commission field, by decision: SALES-1's sales_partners holds payout terms; this does not.
  await pool.query(`CREATE TABLE IF NOT EXISTS partners (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL, deleted_at TIMESTAMPTZ, ${ACTOR})`);
  // One row per booking form sent from /book. The file (optional, at most 10 MB) is kept
  // here until onboarding picks it up; the answers are copied onto the deal as a note.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_bookings (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, org_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
    current_system TEXT, donor_count TEXT, worth_it TEXT, partner_code TEXT,
    file_name TEXT, file_type TEXT, file_size INTEGER, file_data BYTEA,
    sales_deal_id TEXT, sales_org_id TEXT, sales_contact_id TEXT, ip TEXT, ${ACTOR})`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_bookings_email ON sales_bookings (lower(email))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_bookings_org ON sales_bookings (sales_org_id)`);
  // The deal remembers the partner code it came in on (the market is the partner's).
  await pool.query(`ALTER TABLE sales_deals ADD COLUMN IF NOT EXISTS partner_code TEXT`);
}

module.exports = { run };
