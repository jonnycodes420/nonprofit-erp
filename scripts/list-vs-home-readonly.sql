-- scripts/list-vs-home-readonly.sql · READ-ONLY. Once check d of the nightly
-- check (removed): the Donors list and Home count the same people.
-- Home's "N people on file" (GET /org/setup-status, routes/crm.js) counts
-- donors with deleted_at IS NULL and is_sample IS NOT TRUE; the Donors list
-- plus the archived list count the same rows. They can only disagree when
-- Home is answered from a STALE stored answer (orgSummary.js, org_summary).
-- Per org: the stored Home answers that would still be served (no change
-- since their mark, not below the org's floor, not expired, made in the last
-- day) whose people count differs from the live count. An org holding sample
-- people is left out, as the check left it out.
-- Org id and counts only: no names, no emails, no donor data.
BEGIN TRANSACTION READ ONLY;
WITH served AS (
  SELECT s.org_key, (item->>'count')::int AS home_says
    FROM org_summary s, jsonb_array_elements(s.body::jsonb->'items') item
   WHERE s.key LIKE 'setup-status|%' AND item->>'key' = 'donors'
     AND s.computed_for >= to_char(NOW() - INTERVAL '1 day', 'YYYY-MM-DD')
     AND (s.valid_until IS NULL OR s.valid_until > NOW())
     AND s.snap_xmin >= COALESCE((SELECT f.xid FROM org_changes_floor f WHERE f.org_key = s.org_key), '0'::xid8)
     AND NOT EXISTS (SELECT 1 FROM org_changes c WHERE c.org_key = s.org_key AND c.xid >= s.snap_xmin))
SELECT v.org_key AS org_id, v.home_says,
       (SELECT COUNT(*) FROM donors d WHERE d.org_id = v.org_key AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE)::int AS live
  FROM served v
 WHERE NOT EXISTS (SELECT 1 FROM donors d WHERE d.org_id = v.org_key AND d.deleted_at IS NULL AND d.is_sample IS TRUE)
   AND v.home_says <> (SELECT COUNT(*) FROM donors d WHERE d.org_id = v.org_key AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE)
 ORDER BY v.org_key;
ROLLBACK;
