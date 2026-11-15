// server/db/ddl/flows11.js · FLOWS-11 items 3 and 6. A HOUSEHOLD'S STATEMENT; A JOURNEY KNOWS THE
// GIFT THAT STARTED IT.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   cultivation_plans.source_gift_id   the gift whose arrival started this journey
//                                      (journeyStart.js, opts.giftId). Deleting that
//                                      gift stops the journey and voids its open
//                                      thank-you (server/donors/giftThanks.js). NULL for
//                                      a journey no gift started, and for one started
//                                      before this column (the dry run lists those).
//   receipts.household_id              a household's one year-end statement (type
//                                      household_year_end, server/receipts/householdStatement.js).
//                                      Tax receipts stay per giver; this is the statement only.
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS household_id TEXT`);
  await pool.query(`ALTER TABLE cultivation_plans ADD COLUMN IF NOT EXISTS source_gift_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_cultivation_plans_source_gift ON cultivation_plans (org_id, source_gift_id) WHERE source_gift_id IS NOT NULL`);
}

module.exports = { run };
