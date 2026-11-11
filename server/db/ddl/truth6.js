// server/db/ddl/truth6.js · TRUTH-6. A GIFT DATED AFTER TODAY IS SCHEDULED.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   gifts.scheduled_on  the day a postdated gift is for (YYYY-MM-DD), written
//                       when the gift is recorded (by hand or by an import)
//                       with a date after the org's today. NULL = an ordinary
//                       gift. It counts nowhere until that day
//                       (shared/numbers/scheduled.js).
// No row is written here: scripts/ops/truth6-zero-receipts.js lists the
// gifts written before this build that are dated after today.
async function run(pool) {
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS scheduled_on TEXT`);
}

module.exports = { run };
