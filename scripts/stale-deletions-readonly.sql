-- scripts/stale-deletions-readonly.sql · HARDEN-2 item 4. READ-ONLY.
-- Per org: how many people are live (donors.deleted_at IS NULL) but still
-- named by an open deletion record (deleted_records, table_name 'donors',
-- restored_at IS NULL). The same definition as personTrash.js
-- STALE_DELETIONS_SQL. It was check a of the nightly check (removed).
-- Org id and a count only: no names, no emails, no other donor data.
-- An archived person is counted here too: archive is not delete.
BEGIN TRANSACTION READ ONLY;
SELECT d.org_id, COUNT(DISTINCT d.id)::int AS people
  FROM donors d
  JOIN deleted_records r ON r.org_id = d.org_id AND r.table_name = 'donors'
                        AND r.record_id = d.id AND r.restored_at IS NULL
 WHERE d.deleted_at IS NULL
 GROUP BY d.org_id
 ORDER BY d.org_id;
ROLLBACK;
