// server/db/ddl/wealth1.js · WEALTH-1. THE WEALTH SCORE A PERSON SETS.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
//
// Why a new column and not donors.wealth_score: that column already holds an
// automatic 1 to 10 figure that calcWealthScore (server/donors/helpers.js)
// rewrites after gifts. Reusing it would show those numbers as scores nobody
// set, and a 1 to 5 check would fail on the rows that hold 6 to 10. The score
// a person sets lives here, and nothing but a person's click writes it.
async function run(pool) {
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_rating SMALLINT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_rating_set_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_rating_set_by TEXT`);
  await pool.query(`ALTER TABLE donors ADD COLUMN IF NOT EXISTS wealth_rating_set_by_name TEXT`);
  // The check, added NOT VALID then validated, so the add itself takes no scan.
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'donors_wealth_rating_1_to_5') THEN
      ALTER TABLE donors ADD CONSTRAINT donors_wealth_rating_1_to_5 CHECK (wealth_rating BETWEEN 1 AND 5) NOT VALID;
    END IF; END $$`);
  await pool.query(`ALTER TABLE donors VALIDATE CONSTRAINT donors_wealth_rating_1_to_5`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_wealth_rating ON donors (org_id, wealth_rating) WHERE wealth_rating IS NOT NULL`);
  // Settings: "Everyone on the team can see Wealth Scores". Off by default.
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS wealth_scores_team BOOLEAN NOT NULL DEFAULT false`);
}

module.exports = { run };
