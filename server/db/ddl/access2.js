// server/db/ddl/access2.js · ACCESS-2. WHO A STAFF MEMBER SEES.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
//
// `sees` is 'everyone' (the default, every account today) or 'assigned': only
// the people whose owner (donors.assigned_to) they are, and the members of a
// household whose primary person they own. An admin always sees everyone,
// whatever the column says (server/auth/portfolio.js). `can_export` and
// `can_wealth` are the Campaign cabinet preset's two other switches. The home
// org's setting is on users; a further org's is on its membership row, since a
// role (and so a scope) is per org (ACCESS-1).
async function run(pool) {
  const COLS = `ADD COLUMN IF NOT EXISTS sees TEXT NOT NULL DEFAULT 'everyone',
                ADD COLUMN IF NOT EXISTS can_export BOOLEAN NOT NULL DEFAULT true,
                ADD COLUMN IF NOT EXISTS can_wealth BOOLEAN NOT NULL DEFAULT true`;
  await pool.query(`ALTER TABLE users ${COLS}`);
  await pool.query(`ALTER TABLE org_memberships ${COLS}`);
  await pool.query(`ALTER TABLE invites ${COLS}`);
  // The portfolio read: a person's owner, inside one org.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donors_org_assigned ON donors (org_id, assigned_to) WHERE assigned_to IS NOT NULL`);
}

module.exports = { run };
