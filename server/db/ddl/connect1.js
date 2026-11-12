// server/db/ddl/connect1.js · CONNECT-1. WHO BROUGHT WHOM.
//
// Additive only. `pool` is part7's DDL session (schema.js ddlSession): a
// short lock_timeout and a retry, so an ALTER never queues in front of reads.
// A Guest of link may name the event the guest came to (nullable: a Guest of
// link made on the profile need not). Introduced by and Guest of are stored
// newcomer first (donor_id_a), the connector second (server/donors/connections.js).
async function run(pool) {
  await pool.query(`ALTER TABLE donor_relationships ADD COLUMN IF NOT EXISTS event_id TEXT`);
  // "Brought in" reads a connector's links by donor_id_b and type.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_donor_rel_connect ON donor_relationships (org_id, relationship_type, donor_id_b)
                     WHERE relationship_type IN ('introduced_by', 'guest_of')`);
}

module.exports = { run };
