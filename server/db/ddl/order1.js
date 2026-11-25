// server/db/ddl/order1.js · ORDER-1: the order she reads and signs on the close link.
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession).
//
// An order is a start link (ONBOARD-1) that carries what Jonathan typed: the plan, the
// price and its cadence, the setup fee or "Waived", the free days, a note line and who
// signs. `order_json` holds those as typed; `order_number` is SW-YYYY-NNNN, once.
// The signature is `order_signatures`: the order exactly as shown (every line and figure),
// the Terms version, who, when, from where, and the SHA-256 of the snapshot. Append-only,
// like start_signatures: a signed order is never edited; a change is a new order.
"use strict";

async function run(pool) {
  await pool.query(`ALTER TABLE start_links ADD COLUMN IF NOT EXISTS order_number TEXT`);
  await pool.query(`ALTER TABLE start_links ADD COLUMN IF NOT EXISTS order_json JSONB`);
  await pool.query(`ALTER TABLE start_links ADD COLUMN IF NOT EXISTS order_version INTEGER`);
  await pool.query(`ALTER TABLE start_links ADD COLUMN IF NOT EXISTS order_updated_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE start_links ADD COLUMN IF NOT EXISTS deal_id TEXT`);
  await pool.query(`ALTER TABLE start_links ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE start_links ADD COLUMN IF NOT EXISTS copy_sent_at TIMESTAMPTZ`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_start_links_order_number ON start_links (order_number) WHERE order_number IS NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_signatures (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      start_link_id TEXT NOT NULL,
      order_number TEXT NOT NULL,
      order_version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      snapshot_sha256 TEXT NOT NULL,
      terms_version TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signer_title TEXT NOT NULL,
      signer_email TEXT NOT NULL,
      signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip TEXT,
      user_agent TEXT,
      first_charge_at TIMESTAMPTZ NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_order_signatures_link ON order_signatures (start_link_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_signatures_org ON order_signatures (org_id, signed_at DESC)`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION order_signatures_no_update() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'order_signatures is append-only'; END $$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_order_signatures_no_update ON order_signatures`);
  await pool.query(`CREATE TRIGGER trg_order_signatures_no_update BEFORE UPDATE ON order_signatures
                      FOR EACH ROW EXECUTE FUNCTION order_signatures_no_update()`);
}

module.exports = { run };
