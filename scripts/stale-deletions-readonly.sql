-- scripts/stale-deletions-readonly.sql · HARDEN-2 item 4. READ-ONLY.
-- Per org: how many people are live (donors.deleted_at IS NULL) but still
-- named by an open deletion record (deleted_records, table_name 'donors',
-- restored_at IS NULL). The same definition as the nightly check's check a
-- (nightlyCheck.js deletedAmong) and personTrash.js STALE_DELETIONS_SQL.
-- Org id and a count only: no names, no emails, no other donor data.
-- Check a reports such a person only where a list shows them (the Donors
-- list, a group, a guest list), so an archived one is counted here but not there.
BEGIN TRANSACTION READ ONLY;
SELECT d.org_id, COUNT(DISTINCT d.id)::int AS people
  FROM donors d
  JOIN deleted_records r ON r.org_id = d.org_id AND r.table_name = 'donors'
                        AND r.record_id = d.id AND r.restored_at IS NULL
 WHERE d.deleted_at IS NULL
 GROUP BY d.org_id
 ORDER BY d.org_id;
ROLLBACK;
