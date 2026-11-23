// server/db/ddl/ledger3.js · LEDGER-3. ONE DEFAULT FUND, AND A WAITING GIFT CAN POST.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   orgs.default_fund_by           who set default_fund_id: a user, or
//                                  'system:defaultFund' when shared/numbers/
//                                  defaultFund.js stamped the oldest unrestricted
//                                  fund. Null on rows set before (a person's choice).
//   ledger_post_batches            one row per "Post to the books": what it posted,
//                                  counted, and when it was undone.
//   fin_transactions.post_batch_id the batch that wrote the row, so Undo removes
//                                  exactly that batch.
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS default_fund_by TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ledger_post_batches (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id),
    groups JSONB NOT NULL DEFAULT '[]'::jsonb,
    gift_count INTEGER NOT NULL DEFAULT 0,
    cents BIGINT NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    undone_at TIMESTAMPTZ,
    undone_by TEXT,
    undone_by_name TEXT
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ledger_post_batches_org ON ledger_post_batches (org_id, created_at DESC)`);
  await pool.query(`ALTER TABLE fin_transactions ADD COLUMN IF NOT EXISTS post_batch_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS fin_transactions_post_batch ON fin_transactions (org_id, post_batch_id) WHERE post_batch_id IS NOT NULL`);
}

module.exports = { run };
