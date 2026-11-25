// server/db/ddl/builds/2026-11-25-builder3.js · BUILDER-3. WORKING ON AN EMAIL TOGETHER.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so a CREATE or an ALTER never queues in front of reads.
//
//   email_templates.rev          a counter every save of the blocks moves by one. A save says
//                                which rev it started from; one that started from an older rev
//                                is merged block by block (shared/emailMerge.js), never laid over.
//   email_editor_presence        who has an email open now, the block each has selected, and the
//                                block each is typing in (the lock, freed after 30 s idle). One
//                                row a person per email, replaced by each heartbeat; a silent
//                                table (shared/changeTopics.cjs).
//   email_comments               a thread pinned to one block of one email. Never part of the
//                                blocks, so never in a send or the rendered HTML. Resolve hides it.
//   email_comment_mentions       one row per person @mentioned: the bell lists it until it is
//                                dismissed or its thread resolved (in the app only; no email).
//   email_review_links           Share: a review link for someone in the org (signed in) or a
//                                private view-only link for an outside reviewer, expiring in 7 days.
//                                Only the token's SHA-256 is kept.
//   portal_settings.email_style  the house style for every email of the org (Styles tab): fonts,
//                                sizes, link colour and button shape, read at render time.
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS rev INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_editor_presence (
    org_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    block_id TEXT,
    editing_block_id TEXT,
    edited_at TIMESTAMPTZ,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (template_id, user_id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_editor_presence_org ON email_editor_presence (org_id, template_id, seen_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_comments (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    template_id TEXT NOT NULL,
    block_id TEXT NOT NULL,
    parent_id TEXT,
    body TEXT NOT NULL,
    author_name TEXT NOT NULL,
    review_link_id TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolved_by_name TEXT,
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_comments_template ON email_comments (org_id, template_id, created_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_comment_mentions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    dismissed_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_comment_mentions_user ON email_comment_mentions (org_id, user_id) WHERE dismissed_at IS NULL`);
  await pool.query(`CREATE TABLE IF NOT EXISTS email_review_links (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    template_id TEXT NOT NULL,
    audience TEXT NOT NULL,
    token_hash TEXT,
    preview_as TEXT,
    allow_comments BOOLEAN NOT NULL DEFAULT false,
    reviewer_name TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_email_review_links_token ON email_review_links (token_hash) WHERE token_hash IS NOT NULL`);
  await pool.query(`ALTER TABLE portal_settings ADD COLUMN IF NOT EXISTS email_style JSONB`);
}

module.exports = { run };
