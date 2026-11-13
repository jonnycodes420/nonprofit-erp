// server/db/ddl/sales3.js · SALES-3 Part A: quotes on a deal, their private links and signatures.
// Additive only, on the init session (lock_timeout and retry, schema.js ddlSession). Every table
// is prefixed `sales_` and has NO org_id: sales data is no org's (tenant-isolation allowlist).
// `steward_org_id` names the Steward org a quote bills, the way sales_orgs does.
"use strict";

const ACTOR = `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL, created_by_name TEXT NOT NULL`;
const EDITED = `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_by_name TEXT`;

async function run(pool) {
  // One version of a quote on a deal. A new version supersedes the open ones before it (their
  // links stop). Once one is accepted the deal's quote is settled: no new version.
  //   status   draft | sent | accepted | superseded   (expired is read from expires_at)
  //   token_hash  sha256 of the private link's token; the token itself is shown once, never kept
  //   rendered_text / text_sha256  exactly what the signer was shown, kept with the signature
  //   pdf      the signed agreement as a PDF snapshot, made once at acceptance
  //   billing_*  what scheduling the subscription did (or why it couldn't), for the deal page
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_quotes (
    id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, version INTEGER NOT NULL,
    plan_key TEXT NOT NULL, plan_name TEXT NOT NULL, tier_id TEXT, addons JSONB NOT NULL DEFAULT '[]'::jsonb,
    includes JSONB NOT NULL DEFAULT '[]'::jsonb,
    list_cents INTEGER NOT NULL, price_cents INTEGER NOT NULL, below_list_reason TEXT,
    start_on DATE NOT NULL, setup_fee_cents INTEGER NOT NULL DEFAULT 0, term TEXT NOT NULL DEFAULT 'month_to_month',
    status TEXT NOT NULL DEFAULT 'draft',
    token_hash TEXT UNIQUE, link_made_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    steward_org_id TEXT, org_name TEXT,
    accepted_at TIMESTAMPTZ, signer_name TEXT, signer_title TEXT, signer_email TEXT, signer_ip TEXT, signer_ua TEXT,
    agreement_version TEXT, text_sha256 TEXT, rendered_text TEXT, pdf BYTEA,
    card_saved_at TIMESTAMPTZ, card_brand TEXT, card_last4 TEXT, stripe_session_id TEXT,
    stripe_subscription_id TEXT, billing_scheduled_at TIMESTAMPTZ, billing_starts_at TIMESTAMPTZ, billing_error TEXT,
    ${ACTOR}, ${EDITED})`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_quotes_deal_version ON sales_quotes (deal_id, version)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_quotes_deal ON sales_quotes (deal_id, version DESC)`);
}

module.exports = { run };
