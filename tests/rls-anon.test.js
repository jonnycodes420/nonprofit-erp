// tests/rls-anon.test.js · SECURE-3 item 3. A LEAKED PUBLIC KEY READS NOTHING.
// Run: node tests/rls-anon.test.js   (scratch Postgres, tests/README.md)
//
// Supabase serves every table in `public` through its REST API as the roles
// `anon` and `authenticated`, and grants them ALL on every new table by
// default. Steward never uses that API, so the database must refuse it on its
// own (server/admin/dbLock.js, run last by db.js initSchema on every boot).
//
// This builds a Supabase-shaped database from nothing, on the scratch cluster:
//   · the roles anon, authenticated and service_role (cluster-wide, so made
//     idempotently and left in place: they mean nothing to plain Postgres);
//   · a NON-superuser owner that logs in, like Supabase's `postgres` (a
//     superuser would bypass RLS and prove nothing about the owner path);
//   · Supabase's default privileges: everything that owner creates in public
//     is granted to the three API roles;
// then boots the real schema build against it as that owner, twice (a full
// init, then the unchanged-schema fast path), with a table created in between
// the way a module creates one lazily after boot. Then:
//   §1 every public table has RLS on and NOT forced, and carries the deny policy
//   §2 as anon and as authenticated, every table is refused or reads zero rows
//   §3 no table, sequence or function is granted to an API role
//   §4 the owner still reads every table, and the seeded rows are there
//   §5 a table created after a boot is closed at once (default privileges)
//      and has RLS by the next boot
//
// Red before SECURE-3: with initSchema not calling the lock, anon reads the
// seeded orgs (and every other table) through Supabase's default grants, so
// §1 to §3 and §5 fail. A FORCE on any table turns §1 and §4 red.

const { Client } = require("pg");
const crypto = require("crypto");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const ADMIN_URL = process.env.DATABASE_URL || "postgresql://steward@localhost:5544/steward_loadtest";
const admin = new URL(ADMIN_URL);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(admin.hostname)) {
  console.error("Refusing to run: DATABASE_URL must be loopback (got host " + admin.hostname + ")");
  process.exit(1);
}
const ssl = process.env.DB_SSL === "disable" || !process.env.DB_SSL ? false : { rejectUnauthorized: false };

const TAG = crypto.randomBytes(4).toString("hex");
const DB = `steward_rls_${TAG}`;
const OWNER = `steward_rls_owner_${TAG}`;
const OWNER_PW = "rls-owner-local-only-" + TAG;   // a throwaway role on the scratch cluster, dropped below
const API_ROLES = ["anon", "authenticated", "service_role"];

const urlFor = (db, user, pw) => {
  const u = new URL(ADMIN_URL);
  u.pathname = "/" + db;
  if (user) { u.username = user; u.password = pw || ""; }
  return u.toString();
};
const connect = async (db, user, pw) => {
  const c = new Client({ connectionString: urlFor(db, user, pw), ssl });
  await c.connect();
  return c;
};

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 600) : "")); }
};

function bootSchema(label) {
  const env = { ...process.env, DATABASE_URL: urlFor(DB, OWNER, OWNER_PW), DB_SSL: ssl ? "" : "disable", TEST_MODE: "1" };
  try {
    execFileSync("node", ["-e", "require('./db').getDb().then(() => process.exit(0), e => { console.error(e); process.exit(1); })"],
      { cwd: root, env, stdio: "pipe", encoding: "utf8", timeout: 240000 });
    return true;
  } catch (e) {
    console.log(`  (${label} output)\n` + String(e.stdout || "").slice(-1500) + String(e.stderr || "").slice(-1500));
    return false;
  }
}

const publicTables = async c => (await c.query(
  `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
          EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'steward_deny_supabase_api') AS deny
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`)).rows;

// Reads every table as `role`. Returns the tables that handed back a row.
async function readsAs(c, role, tables) {
  const leaked = [];
  let refused = 0, empty = 0;
  for (const t of tables) {
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL ROLE ${role}`);
      const r = await c.query(`SELECT 1 FROM public."${t.replace(/"/g, '""')}" LIMIT 1`);
      if (r.rows.length) leaked.push(t); else empty++;
    } catch (e) {
      if (e.code === "42501") refused++; else leaked.push(t + " (" + e.code + " " + e.message + ")");
    } finally { await c.query("ROLLBACK"); }
  }
  return { leaked, refused, empty };
}

(async () => {
  console.log(`SECURE-3 · RLS: a Supabase-shaped database (${DB}) refuses anon and authenticated\n`);
  const boss = await connect(admin.pathname.slice(1) || "postgres");
  try {
    // ── the cluster-wide roles, made the way Supabase has them ──────────────
    for (const r of API_ROLES) {
      await boss.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN
          CREATE ROLE ${r} NOLOGIN${r === "service_role" ? " BYPASSRLS" : ""};
        END IF;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
    }
    await boss.query(`CREATE ROLE ${OWNER} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE PASSWORD '${OWNER_PW}'`);
    await boss.query(`CREATE DATABASE ${DB} OWNER ${OWNER}`);

    const sup = await connect(DB);   // the scratch superuser, inside the new database
    try {
      await sup.query(`GRANT USAGE ON SCHEMA public TO ${API_ROLES.join(", ")}`);
      await sup.query(`GRANT ALL ON SCHEMA public TO ${OWNER}`);
      for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
        await sup.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA public GRANT ALL ON ${kind} TO ${API_ROLES.join(", ")}`);
      }
    } finally { await sup.end(); }

    // ── boot 1: the full schema build, as the owner ─────────────────────────
    ok("the schema builds on a Supabase-shaped database as a non-superuser owner", bootSchema("boot 1"));

    // A table a module creates lazily after boot (routes/crm.js board_reports,
    // numberCheck.js, setup.js do this), with a row in it.
    const own = await connect(DB, OWNER, OWNER_PW);
    try {
      await own.query(`CREATE TABLE zz_secure3_lazy (id INT PRIMARY KEY, note TEXT)`);
      await own.query(`INSERT INTO zz_secure3_lazy VALUES (1, 'created after boot')`);
    } finally { await own.end(); }
    {
      const c = await connect(DB);
      try {
        const r = await readsAs(c, "anon", ["zz_secure3_lazy"]);
        ok("§5 a table created after boot is closed to anon at once (no default grant)", r.leaked.length === 0 && r.refused === 1, r);
      } finally { await c.end(); }
    }

    // ── boot 2: the unchanged-schema fast path ──────────────────────────────
    ok("the second boot (unchanged schema) runs", bootSchema("boot 2"));

    const c = await connect(DB);
    try {
      const tables = await publicTables(c);
      const names = tables.map(t => t.relname);
      ok("the schema built its tables", tables.length >= 200, tables.length);

      // §1
      const noRls = tables.filter(t => !t.rls).map(t => t.relname);
      ok("§1 every public table has row-level security on", noRls.length === 0, noRls);
      const forced = tables.filter(t => t.forced).map(t => t.relname);
      ok("§1 no table FORCEs row-level security (the owner must not be bound by it)", forced.length === 0, forced);
      const noDeny = tables.filter(t => !t.deny).map(t => t.relname);
      ok("§1 every public table carries the deny policy for the API roles", noDeny.length === 0, noDeny);
      ok("§5 the lazily created table has RLS and the deny policy by the next boot",
        tables.some(t => t.relname === "zz_secure3_lazy" && t.rls && t.deny && !t.forced));

      // §2
      for (const role of ["anon", "authenticated"]) {
        const r = await readsAs(c, role, names);
        ok(`§2 as ${role}, every table is refused or reads nothing (${r.refused} refused, ${r.empty} empty)`, r.leaked.length === 0, r.leaked);
      }

      // §2 · RLS holds on its own, even if a grant comes back (Supabase's
      // dashboard or a hand-run GRANT): granted SELECT on orgs, anon still
      // reads zero rows. Inside a transaction that is rolled back.
      await c.query("BEGIN");
      try {
        await c.query(`GRANT SELECT ON public.orgs TO anon`);
        await c.query(`SET LOCAL ROLE anon`);
        const n = (await c.query(`SELECT COUNT(*)::int AS n FROM public.orgs`)).rows[0].n;
        ok("§2 even with SELECT granted back, anon reads zero orgs (the deny policy holds on its own)", n === 0, n);
      } finally { await c.query("ROLLBACK"); }

      // §3
      const grants = (await c.query(
        `SELECT c.relname, c.relkind, r.rolname
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
           JOIN pg_roles r ON r.oid = a.grantee
          WHERE n.nspname = 'public' AND r.rolname = ANY($1)`, [API_ROLES])).rows;
      ok("§3 no table or sequence in public is granted to anon, authenticated or service_role", grants.length === 0, grants.slice(0, 10));
      const fnGrants = (await c.query(
        `SELECT p.proname, r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, LATERAL aclexplode(p.proacl) a
           JOIN pg_roles r ON r.oid = a.grantee WHERE n.nspname = 'public' AND r.rolname = ANY($1)`, [API_ROLES])).rows;
      ok("§3 no function in public is granted to an API role", fnGrants.length === 0, fnGrants.slice(0, 10));
      const defaults = (await c.query(
        `SELECT d.defaclobjtype, r.rolname FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
           JOIN pg_roles r ON r.oid = a.grantee
          WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $2) AND r.rolname = ANY($1)`, [API_ROLES, OWNER])).rows;
      ok("§3 the owner's default privileges grant nothing to an API role", defaults.length === 0, defaults);
      const definer = (await c.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef`)).rows;
      ok("§3 no SECURITY DEFINER function in public (one would run past RLS for whoever may call it)", definer.length === 0, definer);
    } finally { await c.end(); }

    // §4
    const o = await connect(DB, OWNER, OWNER_PW);
    try {
      const me = (await o.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0];
      ok("§4 the owner is an ordinary role (no superuser, no BYPASSRLS), like Supabase's postgres", !me.rolsuper && !me.rolbypassrls, me);
      const names = (await publicTables(o)).map(t => t.relname);
      const broke = [];
      for (const t of names) {
        try { await o.query(`SELECT 1 FROM public."${t.replace(/"/g, '""')}" LIMIT 1`); }
        catch (e) { broke.push(t + " " + e.code); }
      }
      ok("§4 the owner reads every table", broke.length === 0, broke);
      const orgs = (await o.query(`SELECT COUNT(*)::int AS n FROM orgs`)).rows[0].n;
      const users = (await o.query(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n;
      ok("§4 the owner sees the seeded rows (orgs and users)", orgs > 0 && users > 0, { orgs, users });
      const lazy = (await o.query(`SELECT COUNT(*)::int AS n FROM zz_secure3_lazy`)).rows[0].n;
      ok("§4 the owner still reads the lazily created table after RLS went on", lazy === 1, lazy);
      // and writes: a row in, a row out
      await o.query(`INSERT INTO zz_secure3_lazy VALUES (2, 'written after RLS')`);
      await o.query(`DELETE FROM zz_secure3_lazy WHERE id = 2`);
      ok("§4 the owner still writes after RLS went on", true);
      // PROVEN ABLE TO FAIL: FORCE on orgs (rolled back) and the owner reads
      // nothing, which is the outage §1's FORCE check and §4 stand against.
      await o.query("BEGIN");
      try {
        await o.query(`ALTER TABLE public.orgs FORCE ROW LEVEL SECURITY`);
        const n = (await o.query(`SELECT COUNT(*)::int AS n FROM orgs`)).rows[0].n;
        ok("§4 planted: with FORCE on, the owner would read zero orgs (so FORCE is never used)", n === 0 && orgs > 0, { n, orgs });
      } finally { await o.query("ROLLBACK"); }
    } finally { await o.end(); }
  } finally {
    await boss.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(e => console.log("  (cleanup) " + e.message));
    await boss.query(`DROP ROLE IF EXISTS ${OWNER}`).catch(e => console.log("  (cleanup) " + e.message));
    await boss.end();
  }
})().catch(e => ok("the RLS suite ran to the end", false, e.stack)).finally(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
