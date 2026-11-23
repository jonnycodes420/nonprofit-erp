// server/db/ddl/gifts3.js · GIFTS-3. A GIFT CAN BE ANONYMOUS.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   gifts.anonymous   the donor asked not to be named for this gift. The gift is
//                     still theirs (their total, their receipt, their timeline);
//                     public recognition and acknowledgment lists say "Anonymous".
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE gifts ADD COLUMN IF NOT EXISTS anonymous BOOLEAN NOT NULL DEFAULT FALSE`);
}
module.exports = { run };
