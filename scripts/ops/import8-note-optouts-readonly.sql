-- scripts/ops/import8-note-optouts-readonly.sql · READ-ONLY (IMPORT-8).
-- Before IMPORT-8, "Import a spreadsheet" read a note anywhere on a row as an
-- opt-out ("Asked for no more mail, email only" → Opted out of email), set
-- do_not_email and added an email suppression. Each one left a timeline line
-- (interactions, metadata kind "preference", preference "optOut") naming the
-- column it came from. A column that names no choice (About them, Notes) is a
-- note. This counts, per org and import, the people still blocked that way and
-- how many of them have no choice column behind the block. Org and import ids
-- and counts only: no names, no emails, no donor data. Changes nothing.
BEGIN TRANSACTION READ ONLY;
WITH note_optouts AS (
  SELECT i.org_id, i.import_id, i.donor_id, i.metadata->>'header' AS header
    FROM interactions i
   WHERE i.metadata->>'source' = 'sheet-import' AND i.metadata->>'kind' = 'preference' AND i.metadata->>'preference' = 'optOut'
     AND LOWER(COALESCE(i.metadata->>'header', '')) !~ '(mailing|newsletter|e-?news|opt|unsub|subscri|email list|do not|no e-?mail|dne|dnc|restrict)'
), backed AS (
  SELECT DISTINCT i.donor_id FROM interactions i
   WHERE i.metadata->>'source' = 'sheet-import' AND i.metadata->>'kind' = 'preference'
     AND i.metadata->>'preference' IN ('optOut', 'doNotEmail', 'doNotContact')
     AND LOWER(COALESCE(i.metadata->>'header', '')) ~ '(mailing|newsletter|e-?news|opt|unsub|subscri|email list|do not|no e-?mail|dne|dnc|restrict)'
)
SELECT n.org_id, n.import_id,
       COUNT(DISTINCT n.donor_id)::int AS people_from_a_note,
       COUNT(DISTINCT n.donor_id) FILTER (WHERE d.do_not_email)::int AS still_blocked,
       COUNT(DISTINCT n.donor_id) FILTER (WHERE d.do_not_email AND b.donor_id IS NULL)::int AS blocked_by_the_note_alone,
       STRING_AGG(DISTINCT n.header, ', ') AS note_columns
  FROM note_optouts n
  JOIN donors d ON d.id = n.donor_id AND d.org_id = n.org_id AND d.deleted_at IS NULL
  LEFT JOIN backed b ON b.donor_id = n.donor_id
 GROUP BY n.org_id, n.import_id
 ORDER BY blocked_by_the_note_alone DESC, n.org_id;
ROLLBACK;
