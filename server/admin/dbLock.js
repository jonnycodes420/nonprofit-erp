// server/admin/dbLock.js · SECURE-3 item 3. THE DATABASE'S OWN LOCK.
//
// Nothing in the browser talks to Supabase: the client calls Steward's API and
// only the server holds a database connection. But a Supabase project also
// serves every table in `public` through its REST API to the `anon` and
// `authenticated` roles, keyed by the project's public key. If that key ever
// leaked, the database itself has to say no. This makes it say no:
//
//   1. row-level security ON for every table in public (never FORCE). The app
//      connects as the tables' owner (`postgres` on Supabase, `steward`
//      locally), and an owner is not subject to its own table's RLS unless
//      FORCE is set, so the app reads and writes exactly as before;
//   2. one RESTRICTIVE policy per table that denies anon and authenticated
//      everything (USING false). With RLS on and no permissive policy they
//      already see nothing; the restrictive one keeps it so even if someone
//      later adds a permissive policy by hand;
//   3. every grant on public's tables, sequences and functions taken back from
//      anon, authenticated and service_role, and the default privileges
//      changed so a table created later is not granted to them either.
//
// Schema only: no row is read or written. Idempotent, and cheap when there is
// nothing to do (one catalog read per step). db.js initSchema runs it LAST on
// every boot, the unchanged-schema fast path included, so a table some module
// created lazily since the last boot is locked on the next one, and step 3's
// default privileges keep it ungranted in the meantime.
//
// On plain Postgres (the scratch stack, CI) the Supabase roles do not exist:
// steps 2 and 3 are skipped for a missing role, step 1 still runs.
//
// A table this connection does not own (or have its owner's privileges over)
// is SKIPPED and named: turning RLS on there would lock the app itself out.

// Roles that get the deny policy: the two roles Supabase's REST API runs as.
const DENY_ROLES = ["anon", "authenticated"];
// Roles whose grants are taken back. service_role bypasses RLS by design, so a
// policy does nothing against it; taking its grants away is what stops a
// leaked service key. Steward never uses any of the three.
const REVOKE_ROLES = ["anon", "authenticated", "service_role"];
const POLICY = "steward_deny_supabase_api";

const qi = name => '"' + String(name).replace(/"/g, '""') + '"';

// `db` is anything with query(sql, params) -> { rows } (a pg client, a pool,
// or db.js's ddl session).
async function lockPublicSchema(db) {
  const out = { rlsEnabled: [], policiesAdded: 0, revoked: false, skippedNotOwner: [], roles: [] };
  const present = new Set((await db.query(
    `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)`, [REVOKE_ROLES])).rows.map(r => r.rolname));
  out.roles = REVOKE_ROLES.filter(r => present.has(r));
  const me = (await db.query(`SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`)).rows[0];
  const bypass = !!(me && me.bypass);

  // ── 1. RLS on, never FORCE ────────────────────────────────────────────────
  const off = (await db.query(
    `SELECT c.relname, pg_has_role(current_user, c.relowner, 'USAGE') AS mine
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
      ORDER BY c.relname`)).rows;
  for (const t of off) {
    // RLS does not bind the table's owner (no FORCE) or a role that bypasses it.
    if (!t.mine && !bypass) { out.skippedNotOwner.push(t.relname); continue; }
    await db.query(`ALTER TABLE public.${qi(t.relname)} ENABLE ROW LEVEL SECURITY`);   // nosemgrep: javascript.express.security.injection.tainted-sql-string.tainted-sql-string -- a pg_class name, quoted by qi
    out.rlsEnabled.push(t.relname);
  }

  // ── 2. the deny policy, for the roles that exist ──────────────────────────
  const deny = DENY_ROLES.filter(r => present.has(r));
  if (deny.length) {
    const missing = (await db.query(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
          AND (pg_has_role(current_user, c.relowner, 'USAGE') OR $2::boolean)
          AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = $1)
        ORDER BY c.relname`, [POLICY, bypass])).rows;
    for (const t of missing) {
      await db.query(`CREATE POLICY ${qi(POLICY)} ON public.${qi(t.relname)} AS RESTRICTIVE FOR ALL
                      TO ${deny.map(qi).join(", ")} USING (false) WITH CHECK (false)`);
      out.policiesAdded++;
    }
  }

  // ── 3. no grants to the API roles, now or later ───────────────────────────
  if (out.roles.length) {
    const who = out.roles.map(qi).join(", ");
    const granted = (await db.query(
      `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
                             LATERAL aclexplode(c.relacl) a
                       WHERE n.nspname = 'public' AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1)))
           OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
                             LATERAL aclexplode(p.proacl) a
                       WHERE n.nspname = 'public' AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1)))
           OR EXISTS (SELECT 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
                       WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                         AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1))) AS any`,
      [out.roles])).rows[0].any;
    if (granted) {
      await db.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${who}`);
      await db.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${who}`);
      await db.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${who}`);
      for (const scope of ["IN SCHEMA public ", ""]) {
        for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
          await db.query(`ALTER DEFAULT PRIVILEGES ${scope}REVOKE ALL ON ${kind} FROM ${who}`);
        }
      }
      out.revoked = true;
    }
  }

  if (out.skippedNotOwner.length) {
    console.error(`[db-lock] CRITICAL: row-level security NOT turned on for ${out.skippedNotOwner.length} table(s) this connection does not own: ${out.skippedNotOwner.join(", ")}`);
  }
  if (out.rlsEnabled.length || out.policiesAdded || out.revoked) {
    console.log(`[db-lock] row-level security on for ${out.rlsEnabled.length} table(s), ${out.policiesAdded} deny polic(ies) added, grants taken back: ${out.revoked ? out.roles.join(", ") : "none needed"}`);
  }
  return out;
}

module.exports = { lockPublicSchema, DENY_ROLES, REVOKE_ROLES, POLICY };
