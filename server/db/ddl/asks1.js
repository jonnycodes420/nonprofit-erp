// server/db/ddl/asks1.js · ASKS-1. AN AUCTION SHEET, IMPORTED.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
//
// An auction sheet's purchases are gifts with their import run (gifts.import_id);
// the items they bought are placed in the event's auction. An item or an
// auction the import MADE carries the run too, so Undo takes it away with the
// gifts, and an item that was already there is only unmarked as paid.
async function run(pool) {
  await pool.query(`ALTER TABLE auction_items ADD COLUMN IF NOT EXISTS import_id TEXT`);
  await pool.query(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS import_id TEXT`);
}

module.exports = { run };
