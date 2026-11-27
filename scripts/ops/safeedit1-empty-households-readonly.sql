-- scripts/ops/safeedit1-empty-households-readonly.sql · READ-ONLY. SAFE-EDIT-1 item 3 (Duet m15).
-- Since SAFE-EDIT-1 a household goes to the trash with its last member and comes back with a
-- restore (server/donors/householdTrash.js). Households emptied BEFORE that build stayed behind,
-- listed with 0 members. This counts them per org: households with no live member and at least
-- one member whose trash row still names the household (so a Restore would rejoin them).
--   empty_with_trashed   such households (the dry run of a repair; REPAIR-1 owns the apply)
--   empty_no_one         households with no member at all, live or in the trash (nobody to restore)
-- Org id and counts only: no names, no addresses, no donor data.
BEGIN TRANSACTION READ ONLY;
WITH live AS (
  SELECT DISTINCT org_id, household_id FROM donors WHERE household_id IS NOT NULL AND deleted_at IS NULL
), held AS (
  SELECT DISTINCT r.org_id, r.row_data -> '__links' ->> 'household' AS household_id
    FROM deleted_records r
   WHERE r.table_name = 'donors' AND r.restored_at IS NULL AND (r.row_data -> '__links' ->> 'household') IS NOT NULL
)
SELECT h.org_id,
       COUNT(*) FILTER (WHERE x.household_id IS NOT NULL)::int AS empty_with_trashed,
       COUNT(*) FILTER (WHERE x.household_id IS NULL)::int AS empty_no_one
  FROM households h
  LEFT JOIN live l ON l.org_id = h.org_id AND l.household_id = h.id
  LEFT JOIN held x ON x.org_id = h.org_id AND x.household_id = h.id
 WHERE l.household_id IS NULL
 GROUP BY h.org_id
 ORDER BY h.org_id;
COMMIT;
