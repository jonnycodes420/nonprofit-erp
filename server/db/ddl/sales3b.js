// server/db/ddl/sales3b.js · SALES-3 Part B: the customer-success board, nurture, proof.
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession). The sales_
// tables have NO org_id (tenant-isolation allowlist). ops_checks gains one nullable column so a
// customer's "bug" line lands on /ops's board named as the customer's.
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;
const EDITED = `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_by_name TEXT`;

async function run(pool) {
  // Proof, one row per customer (a sales organization): the testimonial and the references owed.
  //   testimonial_state  none | asked | received | approved
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_customer_proof (
    sales_org_id TEXT PRIMARY KEY, testimonial_state TEXT NOT NULL DEFAULT 'none', testimonial_text TEXT,
    testimonial_asked_on DATE, testimonial_received_on DATE, testimonial_approved_on DATE,
    references_asked INTEGER NOT NULL DEFAULT 0, ${ACTOR}, ${EDITED})`);
  // A customer's nurture rhythm: weekly check-in tasks until billing starts and a 30-day review.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_nurture (
    id TEXT PRIMARY KEY, sales_org_id TEXT NOT NULL, deal_id TEXT, started_on DATE NOT NULL, until_on DATE NOT NULL,
    ended_at TIMESTAMPTZ, ${ACTOR})`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_nurture_org ON sales_nurture (sales_org_id) WHERE ended_at IS NULL`);
  // /ops's board: ops_checks is made by its routes on first boot (opsMapRoutes.ensureTable, same
  // shape); made here too so the column can be added in this boot's order.
  await pool.query(`CREATE TABLE IF NOT EXISTS ops_checks (
      id TEXT PRIMARY KEY, seq BIGSERIAL, area_id TEXT NOT NULL, check_id TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail')), note TEXT, shot TEXT,
      created_at TIMESTAMPTZ NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT NOT NULL)`);
  await pool.query(`ALTER TABLE ops_checks ADD COLUMN IF NOT EXISTS customer TEXT`);
}

module.exports = { run };
