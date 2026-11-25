// server/db/ddl/builds/2026-11-24-builder2a.js · BUILDER-2A. SAVED EMAIL BLOCKS AND SOCIAL LINKS.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE or an ALTER never queues in front of reads.
//
//   email_saved_blocks          a block, or a run of blocks, an org saved to use
//                               again (server/mail/savedBlocks.js). `blocks` passed
//                               validateEmailBlocks; `preview_html` is the email
//                               those blocks render to, in the org's brand, when
//                               saved. Using one hands back a copy with fresh ids,
//                               never a link to this row. Removed through the one
//                               Remove (removal.js kind saved_block), so Undo is exact.
//   portal_settings.social_links  the org's social links, set in Brand, read by the
//                               email's Social block at render time
//                               ({ facebook, instagram, x, linkedin, youtube, tiktok, website }).
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS email_saved_blocks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    name TEXT NOT NULL,
    blocks JSONB NOT NULL,
    preview_html TEXT,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT,
    updated_by_name TEXT
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_saved_blocks_org ON email_saved_blocks (org_id, updated_at DESC)`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS social_links JSONB`);
}

module.exports = { run };
