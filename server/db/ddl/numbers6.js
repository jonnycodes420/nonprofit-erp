// server/db/ddl/numbers6.js · NUMBERS-6 item 6. THE NIGHTLY CHECK ON /ops, REAL ORGS FIRST.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a short
// lock_timeout and a retry, so an ALTER never queues in front of reads.
//
//   orgs.is_test_org        a super-admin marked this org as a test (POST
//                           /ops/numbers/test-org). One flag, read by /ops and
//                           the nightly digest line only; it changes no data.
//   number_checks.by_rule   the night's count per rule ({"donor-stored": 3}),
//                           so /ops shows problems by rule without parsing the line.
// number_checks itself is created here too (numberCheck.js also creates it, on
// first use, exactly the same). No row is written here.
async function run(pool) {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS is_test_org BOOLEAN`);
  await pool.query(`CREATE TABLE IF NOT EXISTS number_checks (
      id BIGSERIAL PRIMARY KEY, ran_on DATE NOT NULL, org_id TEXT NOT NULL, org_name TEXT,
      problems INT NOT NULL, line TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (ran_on, org_id))`);
  await pool.query(`ALTER TABLE number_checks ADD COLUMN IF NOT EXISTS by_rule JSONB`);
}

module.exports = { run };
