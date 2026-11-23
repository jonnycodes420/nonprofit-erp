// server/db/ddl/atlas8.js · ATLAS-8 item 6. ATLAS IS AUDITABLE: THE QUESTION IS KEPT.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   atlas_actions.question   what she asked, as she typed or said it, on every
//                            line that request wrote (server/atlas/auditQuestion.js
//                            redacts it by the audit's rules first). NULL on a
//                            line written before this column, and on a line no
//                            question made (the daily job that closes questions).
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE atlas_actions ADD COLUMN IF NOT EXISTS question TEXT`);
}

module.exports = { run };
