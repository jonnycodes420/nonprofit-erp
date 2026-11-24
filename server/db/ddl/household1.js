// server/db/ddl/household1.js · HOUSEHOLD-1. A HOUSEHOLD CAN BE A ROW ON THE TOP 100.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   portfolio_members.household_id   the household this place on the list is
//                                    for. A member is a person (donor_id) or a
//                                    household (household_id), never both and
//                                    never neither: the CHECK below. donor_id
//                                    loses NOT NULL for it; every row written
//                                    before has a donor_id and keeps it.
//   uq_portfolio_member_household    a household holds one place per list.
//   donor_list_layouts.households_together  "Show households together" on the
//                                    Donors list, remembered per person.
// Deleting a household takes its place off the list (CASCADE on the place
// only; the people, their gifts and their own places are untouched).
// No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE portfolio_members ADD COLUMN IF NOT EXISTS household_id TEXT REFERENCES households(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE portfolio_members ALTER COLUMN donor_id DROP NOT NULL`);
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_portfolio_member_one') THEN
      ALTER TABLE portfolio_members ADD CONSTRAINT ck_portfolio_member_one CHECK ((donor_id IS NULL) <> (household_id IS NULL)) NOT VALID;
    END IF; END $$`);
  await pool.query(`ALTER TABLE donor_list_layouts ADD COLUMN IF NOT EXISTS households_together BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_member_household ON portfolio_members (list_id, household_id) WHERE household_id IS NOT NULL`);
}

module.exports = { run };
