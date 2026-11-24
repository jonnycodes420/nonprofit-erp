// server/db/ddl/thanks1.js · THANKS-1. A RECEIPT IS NOT A THANK-YOU.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so nothing queues in front of reads.
//
//   idx_receipts_org_gift   shared/numbers/thanks.js asks, per gift, "was a receipt
//                           ever made for it?" (live or voided), which tells a
//                           legacy thank-you mark from a receipt's. The partial
//                           unique index covers live receipts only.
// No row is written here.
async function run(pool) {
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_receipts_org_gift ON receipts (org_id, gift_id) WHERE gift_id IS NOT NULL`);
}

module.exports = { run };
