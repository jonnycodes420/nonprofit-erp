-- scripts/import5-pledges-from-import-day-readonly.sql · READ-ONLY (IMPORT-5).
-- Before IMPORT-5, a spreadsheet pledge with no date in its file and no event
-- date answered was due from the day of the import (a made-up day), and its
-- note says so: "Your file gave no date, so its due dates count from
-- YYYY-MM-DD". IMPORT-5 changes no rows at deploy; this only counts them, per
-- org, so Jonathan can decide whether anyone should fix them by hand.
-- "From the import day" = the date in the note is the day the pledge was
-- written (UTC, or the day either side, so an org's time zone cannot hide one).
-- Org id and counts only: no names, no emails, no donor data.
BEGIN TRANSACTION READ ONLY;
WITH noted AS (
  SELECT p.org_id, p.id, p.status, p.amount, p.import_id, p.created_at,
         (regexp_match(p.notes, 'due dates count from (\d{4}-\d{2}-\d{2})'))[1] AS counted_from
    FROM pledges p
   WHERE p.notes LIKE '%Your file gave no date, so its due dates count from%'
)
SELECT org_id,
       COUNT(*)::int AS pledges_noted,
       COUNT(*) FILTER (WHERE ABS(counted_from::date - (created_at AT TIME ZONE 'UTC')::date) <= 1)::int AS from_import_day,
       COUNT(*) FILTER (WHERE ABS(counted_from::date - (created_at AT TIME ZONE 'UTC')::date) <= 1 AND status = 'open')::int AS still_open,
       ROUND(SUM(amount) FILTER (WHERE ABS(counted_from::date - (created_at AT TIME ZONE 'UTC')::date) <= 1), 2) AS dollars,
       COUNT(DISTINCT import_id) FILTER (WHERE ABS(counted_from::date - (created_at AT TIME ZONE 'UTC')::date) <= 1)::int AS imports
  FROM noted
 GROUP BY org_id
 ORDER BY from_import_day DESC, org_id;
ROLLBACK;
