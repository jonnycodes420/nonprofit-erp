-- scripts/ops/polish13-leftovers-readonly.sql · POLISH-13. READ-ONLY. What the fixes don't reach:
-- rows that already exist from before them. Counts by org id only, never a name.
--
--   1. W-1126-Donors-09: a funder organization a grant made, still live after its grant was deleted,
--      nobody's since (no gift, pledge, conversation, task, relationship, household or other grant;
--      never edited). These count on Everyone and Contacts. The grant's delete now takes it (server/
--      grants/funderMade.js); these are from before. The fix is REPAIR-1's: trash each through
--      personTrash.trashPeople (Undo-able), never a DELETE.
--   2. W-1126-Finance-03: a gift's own timeline line (interactions.type 'gift') whose gift is gone.
--      A gift's delete now takes it (server/donors/giftDeleteUndo.js TIMELINE_SQL).
--
-- Run: psql "$DATABASE_URL" -f scripts/ops/polish13-leftovers-readonly.sql
BEGIN READ ONLY;

SELECT 'funder org left by a deleted grant' AS what, d.org_id, COUNT(*) AS n
  FROM donors d
 WHERE d.deleted_at IS NULL AND d.erased_at IS NULL
   AND LOWER(COALESCE(d.kind, '')) IN ('organisation', 'organization')
   AND d.person_types = '["other"]'::jsonb AND d.household_id IS NULL
   AND d.updated_at <= d.created_at + INTERVAL '1 second'
   AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.org_id = d.org_id AND g.funder_donor_id = d.id)
   AND EXISTS (SELECT 1 FROM deleted_records r WHERE r.org_id = d.org_id AND r.table_name = 'grants'
                AND r.row_data->>'funder_donor_id' = d.id)
   AND NOT EXISTS (SELECT 1 FROM gifts x WHERE x.org_id = d.org_id AND x.donor_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM pledges x WHERE x.org_id = d.org_id AND x.donor_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM interactions x WHERE x.org_id = d.org_id AND x.donor_id = d.id AND COALESCE(x.metadata->>'via', '') <> 'grant')   -- a grant's own stage lines don't count
   AND NOT EXISTS (SELECT 1 FROM tasks x WHERE x.org_id = d.org_id AND x.donor_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM donor_relationships x WHERE x.org_id = d.org_id AND (x.donor_id_a = d.id OR x.donor_id_b = d.id))
 GROUP BY d.org_id ORDER BY n DESC;

SELECT 'gift timeline line whose gift is gone' AS what, i.org_id, COUNT(*) AS n
  FROM interactions i
 WHERE i.type = 'gift' AND i.gift_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM gifts g WHERE g.id = i.gift_id)
 GROUP BY i.org_id ORDER BY n DESC;

ROLLBACK;
