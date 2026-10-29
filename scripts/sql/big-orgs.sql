-- scripts/sql/big-orgs.sql · FIX-57 item 8
--
-- READ-ONLY. One SELECT; it writes nothing, locks nothing it keeps, and is safe
-- to run twice. Jonathan runs it by hand against production (Supabase SQL
-- editor or psql, read-only role where possible). No build, script or suite
-- runs it against prod; it was checked only on a scratch database.
--
-- What it answers: which orgs hold more than 10,000 people, and are they live.
--   people          rows in `donors` (donors, organisations and non-donor
--                   people are all rows there) with deleted_at IS NULL
--   kind            orgs.org_kind as SET in the console. NULL means nobody set
--                   it and the console infers it (orgKind.js inferKind), which
--                   SQL cannot repeat; the column says so.
--   created         orgs.created_at
--   last_sign_in    the newest staff sign-in: each sign-in writes one
--                   user_sessions row (twoFactor.js createSession), so this is
--                   MAX(created_at) there. A super-admin opening the org may
--                   count too.
--   last_active     the newest request on any staff session
--   imports         rows in `imports` for the org; imports_undone of them were
--                   reversed (reversed_at set)
-- Ordered by people, most first.

SELECT o.id                                         AS org_id,
       o.name                                       AS org_name,
       COALESCE(o.org_kind, '(not set, inferred)')  AS kind,
       o.created_at                                 AS created,
       p.people,
       s.last_sign_in,
       s.last_active,
       COALESCE(i.imports, 0)                       AS imports,
       COALESCE(i.imports_undone, 0)                AS imports_undone
  FROM orgs o
  JOIN (SELECT org_id, COUNT(*) AS people
          FROM donors
         WHERE deleted_at IS NULL
         GROUP BY org_id
        HAVING COUNT(*) > 10000) p ON p.org_id = o.id
  LEFT JOIN (SELECT org_id, MAX(created_at) AS last_sign_in, MAX(last_active_at) AS last_active
               FROM user_sessions
              GROUP BY org_id) s ON s.org_id = o.id
  LEFT JOIN (SELECT org_id, COUNT(*) AS imports, COUNT(reversed_at) AS imports_undone
               FROM imports
              GROUP BY org_id) i ON i.org_id = o.id
 ORDER BY p.people DESC, o.name;
