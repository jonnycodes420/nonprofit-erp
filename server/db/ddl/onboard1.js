// server/db/ddl/onboard1.js · ONBOARD-1: the start link, the signature and the
// staged import. Additive only. Runs on the init session (lock_timeout and
// retry, schema.js ddlSession), BEFORE part 7 so its org triggers see these
// tables too.
"use strict";

async function run(pool) {
  // Stage 1 · one row per start link Jonathan raises for an existing org. The
  // token is stored only as its hash: the link in the email is the secret.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS start_links (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      contact_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      price_basis TEXT NOT NULL,
      tier_id TEXT,
      charge_mode TEXT NOT NULL,
      first_charge_on DATE,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      expires_at TIMESTAMPTZ NOT NULL,
      signed_at TIMESTAMPTZ,
      signature_id TEXT,
      first_charge_at TIMESTAMPTZ,
      stripe_session_id TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_start_links_org ON start_links (org_id, created_at DESC)`);

  // The click-wrap record: who, when, from where, and the SHA-256 of the exact
  // text on her screen, with the text itself so it can be shown back. Written
  // once; the trigger refuses any UPDATE, so what she signed cannot be edited.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS start_signatures (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      start_link_id TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signer_title TEXT NOT NULL,
      signer_email TEXT NOT NULL,
      signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip TEXT,
      user_agent TEXT,
      agreement_version TEXT NOT NULL,
      text_sha256 TEXT NOT NULL,
      rendered_text TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      first_charge_at TIMESTAMPTZ NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL
    )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_start_signatures_link ON start_signatures (start_link_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_start_signatures_org ON start_signatures (org_id, signed_at DESC)`);
  await pool.query(`
    CREATE OR REPLACE FUNCTION start_signatures_no_update() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'start_signatures is append-only'; END $$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS trg_start_signatures_no_update ON start_signatures`);
  await pool.query(`CREATE TRIGGER trg_start_signatures_no_update BEFORE UPDATE ON start_signatures
                      FOR EACH ROW EXECUTE FUNCTION start_signatures_no_update()`);

  // The two onboarding signals ONBOARD-2 reads. Stamped once, by code, from
  // evidence: paper_done_at when a signature AND a saved card both exist,
  // data_in_at when the customer accepts a staged import.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS paper_done_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS data_in_at TIMESTAMPTZ`);
  // A $0 start link saves a card with no subscription (setup mode).
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS billing_card_saved_at TIMESTAMPTZ`);

  // Stage 2 · a staged import. Its people are written soft-deleted and tagged
  // with the run, so every count and list (all of which already leave out a
  // deleted person and that person's gifts) leaves them out too, until Accept.
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS staged_import_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_staged_import ON donors (org_id, staged_import_id) WHERE staged_import_id IS NOT NULL`);
  for (const col of [
    "staged_at TIMESTAMPTZ", "accepted_at TIMESTAMPTZ", "accepted_by TEXT", "accepted_by_name TEXT",
    "accept_reason TEXT", "accepted_on_behalf BOOLEAN", "flagged_at TIMESTAMPTZ", "flagged_by TEXT",
    "flagged_by_name TEXT", "flag_note TEXT",
  ]) await pool.query(`ALTER TABLE imports ADD COLUMN IF NOT EXISTS ${col}`);
}

module.exports = { run };
