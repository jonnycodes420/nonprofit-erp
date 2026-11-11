// server/db/ddl/sales1b.js · SALES-1 Part B: the sales mailbox, partners and payouts. Additive only.
// Runs on the init session (lock_timeout and retry, schema.js ddlSession).
// Like Part A's tables: `sales_` prefix, NO org_id, read only by server/admin/sales/.
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;

async function run(pool) {
  // Jonathan's own mailbox, connected under Sales settings. The permission is
  // sealed (shared/secretBox.js, aad "sales"); nothing here is any org's.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_mailboxes (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, address TEXT NOT NULL, user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', credentials_sealed TEXT, token_expires_at TIMESTAMPTZ,
    last_ok_at TIMESTAMPTZ, last_error TEXT, last_error_at TIMESTAMPTZ, found_last INTEGER,
    ${ACTOR}, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_mailboxes_live ON sales_mailboxes (provider, address) WHERE status <> 'disconnected'`);
  // Only mail to or from a sales contact's address, or a prospect domain, is
  // ever stored (server/admin/sales/email.js keeps()). The body is sealed.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_emails (
    id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL, provider_message_id TEXT NOT NULL, thread_id TEXT,
    subject TEXT, from_addr TEXT, to_addrs JSONB NOT NULL DEFAULT '[]'::jsonb, cc_addrs JSONB NOT NULL DEFAULT '[]'::jsonb,
    sent_at TIMESTAMPTZ NOT NULL, direction TEXT NOT NULL, body_sealed TEXT, ${ACTOR})`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_emails_msg ON sales_emails (mailbox_id, provider_message_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_email_links (
    email_id TEXT NOT NULL, record_type TEXT NOT NULL, record_id TEXT NOT NULL, ${ACTOR},
    PRIMARY KEY (email_id, record_type, record_id))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_email_links_rec ON sales_email_links (record_type, record_id)`);

  // Channel partners. `terms_stack` false: only one of the partner's terms applies to a deal.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_partners (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, contact_name TEXT, contact_email TEXT, phone TEXT, notes TEXT,
    terms_stack BOOLEAN NOT NULL DEFAULT false, deleted_at TIMESTAMPTZ,
    ${ACTOR}, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_by_name TEXT)`);
  // kind: finder | closer | reseller | custom (custom_name). percent OR flat_cents.
  // months NULL: no end. cap_cents NULL: no cap.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_partner_terms (
    id TEXT PRIMARY KEY, partner_id TEXT NOT NULL, kind TEXT NOT NULL, custom_name TEXT,
    percent NUMERIC(6,3), flat_cents BIGINT, recurring BOOLEAN NOT NULL DEFAULT true, months INTEGER, cap_cents BIGINT,
    deleted_at TIMESTAMPTZ, ${ACTOR})`);
  // A deal's partner and the term that applies, with any per-deal override.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_deal_partners (
    id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, partner_id TEXT NOT NULL, term_id TEXT NOT NULL,
    override_percent NUMERIC(6,3), override_flat_cents BIGINT, override_months INTEGER, override_cap_cents BIGINT, ${ACTOR})`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_deal_partners_one ON sales_deal_partners (deal_id, term_id)`);
  // A month marked paid: the amount as it was owed then, the day and a note.
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_payouts (
    id TEXT PRIMARY KEY, deal_partner_id TEXT NOT NULL, partner_id TEXT NOT NULL, deal_id TEXT NOT NULL, month TEXT NOT NULL,
    amount_cents BIGINT NOT NULL, paid_on DATE NOT NULL, note TEXT, ${ACTOR})`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_payouts_month ON sales_payouts (deal_partner_id, month)`);
}

module.exports = { run };
