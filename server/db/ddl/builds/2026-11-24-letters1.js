// server/db/ddl/builds/2026-11-24-letters1.js · LETTERS-1. HER OWN LETTER, HER OWN SIGNATURE.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   ack_letter_templates.layout        a letter uploaded from Word: its page,
//                                      letterhead, body and footer as blocks
//                                      (server/receipts/letterDoc.js). NULL for
//                                      a words-only template, as before.
//   ack_letter_templates.source_name   the Word file's name, shown beside it.
//   ack_letter_templates.not_carried   what did not carry over from Word, in
//                                      sentences, kept so the editor can say so.
//   orgs.receipt_signature_image       the receipt signer's signature (PNG data
//                                      URI, transparent ground), Settings → Tax receipts.
//   users.signature_image              each person's own, from their profile; it
//                                      signs when no receipt signer is set.
//   campaign_merges                    item 4: two campaigns of one name merged, and
//                                      every row moved, so Undo puts each one back
//                                      (server/outreach/campaignMerge.js).
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE ack_letter_templates ADD COLUMN IF NOT EXISTS layout JSONB`);
  await pool.query(`ALTER TABLE ack_letter_templates ADD COLUMN IF NOT EXISTS source_name TEXT`);
  await pool.query(`ALTER TABLE ack_letter_templates ADD COLUMN IF NOT EXISTS not_carried JSONB`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS receipt_signature_image TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_image TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaign_merges (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    keep_id TEXT NOT NULL,
    merged_ids JSONB NOT NULL,
    detail JSONB NOT NULL,
    moved JSONB NOT NULL,
    created_by TEXT NOT NULL, created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    undone_at TIMESTAMPTZ, undone_by TEXT, undone_by_name TEXT
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaign_merges_org ON campaign_merges (org_id, created_at DESC)`);
}

module.exports = { run };
