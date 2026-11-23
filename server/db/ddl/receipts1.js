// server/db/ddl/receipts1.js · RECEIPTS-1. A GIFT OF PROPERTY IS DESCRIBED, NOT VALUED.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   gifts.property_description  what an in-kind (or stock) gift was, as the receipt
//                               states it ("Description of property"). Required on a new
//                               in-kind gift; an older one falls back to its notes.
//   gifts.stock_shares          how many shares, for a stock gift (when she knows it)
//   gifts.stock_ticker          the ticker, for a stock gift (when she knows it)
// No row is written here: scripts/ops/receipts1-org-address-receipts.js lists the
// receipts issued before this build that printed the org's address in the donor block.
async function run(pool) {
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS property_description TEXT`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS stock_shares NUMERIC`);
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS stock_ticker TEXT`);
}

module.exports = { run };
