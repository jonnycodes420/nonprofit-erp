// server/db/ddl/asks2.js · ASKS-2 item 3. A GROUP OF "MAY NOT BE GIFTS" ROWS, DECIDED AT ONCE.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   insight_reviews.batch_id    the one click that decided a group of rows
//                               (server/insights/reviewGroup.js); its one Undo
//                               puts back every row carrying it. NULL for a
//                               row decided on its own.
//   insight_reviews.roles_prev  the person's roles (donors.person_types) before
//                               a group's Not a gift left them with no gift and
//                               they became a contact; Undo gives them back.
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE insight_reviews ADD COLUMN IF NOT EXISTS batch_id TEXT`);
  await pool.query(`ALTER TABLE insight_reviews ADD COLUMN IF NOT EXISTS roles_prev JSONB`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_insight_reviews_batch ON insight_reviews (org_id, batch_id) WHERE batch_id IS NOT NULL`);
}

module.exports = { run };
