-- scripts/sql/rls-status.sql · SECURE-3 item 3. READ-ONLY. Is the database locked?
--
-- Jonathan runs this with psql (the \echo lines are psql commands; in the
-- Supabase SQL editor, paste one numbered SELECT at a time):
--   psql "$DATABASE_URL" -f scripts/sql/rls-status.sql
-- A builder never runs it against prod (docs/security/builder-access.md).
-- SELECTs only: it reads the catalog, never a row of customer data.
--
-- What "locked" means (server/admin/dbLock.js does it at every boot):
--   every table in public has row-level security ON and NOT forced, carries
--   the policy steward_deny_supabase_api, and nothing in public is granted to
--   anon, authenticated or service_role. Every query below should return
--   ZERO rows, except the last, which is the one-line summary.

\echo '1. Tables in public WITHOUT row-level security (should be none)'
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
 ORDER BY 1;

\echo '2. Tables that FORCE row-level security (should be none: FORCE locks the app out)'
SELECT c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relforcerowsecurity
 ORDER BY 1;

\echo '3. Tables without the deny policy (should be none where anon exists)'
SELECT c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
   AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'steward_deny_supabase_api')
 ORDER BY 1;

\echo '4. Policies that let an API role in (any permissive policy naming anon, authenticated or public)'
SELECT p.tablename, p.policyname, p.permissive, p.roles, p.cmd
  FROM pg_policies p
 WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
   AND p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
 ORDER BY 1, 2;

\echo '5. Grants on tables, views and sequences in public to an API role (should be none)'
SELECT c.relname AS object_name, c.relkind AS kind, r.rolname AS grantee, a.privilege_type
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
       LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
 WHERE n.nspname = 'public' AND r.rolname IN ('anon', 'authenticated', 'service_role')
 ORDER BY 1, 3, 4;

\echo '6. Grants on functions in public to an API role (should be none)'
SELECT p.proname AS function_name, r.rolname AS grantee, a.privilege_type
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
       LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
 WHERE n.nspname = 'public' AND r.rolname IN ('anon', 'authenticated', 'service_role')
 ORDER BY 1, 2;

\echo '7. Default privileges that would grant a NEW object to an API role (should be none for the app role)'
SELECT pg_get_userbyid(d.defaclrole) AS creator, COALESCE(n.nspname, '(all schemas)') AS in_schema,
       d.defaclobjtype AS kind, r.rolname AS grantee, a.privilege_type
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
       LATERAL aclexplode(d.defaclacl) a JOIN pg_roles r ON r.oid = a.grantee
 WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
   AND (n.nspname IS NULL OR n.nspname = 'public')
 ORDER BY 1, 2, 3, 4;

\echo '8. Summary'
SELECT
  (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))                                   AS public_tables,
  (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity)              AS with_rls,
  (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relforcerowsecurity)         AS forced,
  (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
          LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'public' AND r.rolname IN ('anon', 'authenticated', 'service_role'))   AS api_role_grants,
  current_user                                                                                AS checked_as;
