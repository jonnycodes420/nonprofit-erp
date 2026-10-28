-- scripts/cross-org-import-readonly.sql · READ-ONLY. Once check e of the
-- nightly check (removed): no customer holds rows from a file previewed in
-- another org. A commit's audit row (routes/sheetImport.js) carries the
-- import id, the file's fingerprint (its cells, not its name) and the org the
-- page said it previewed in; a preview's audit row carries the fingerprint.
-- Per customer org (orgs.org_kind = 'customer'): the imports whose file was
-- previewed in a different org (the one the page named, else the file's first
-- preview anywhere) and that still hold people or gifts.
-- Org ids and counts only: no names, no file contents, no donor data.
BEGIN TRANSACTION READ ONLY;
WITH commits AS (
  SELECT a.org_id, a.after_fields->>'importId' AS import_id, a.after_fields->>'file' AS file,
         NULLIF(a.after_fields->>'previewOrgId', '') AS said
    FROM fin_audit_log a JOIN orgs o ON o.id = a.org_id
   WHERE a.request_path = '/sheet-import/commit' AND o.org_kind = 'customer'
     AND a.after_fields->>'file' IS NOT NULL AND a.after_fields->>'importId' IS NOT NULL),
first_preview AS (
  SELECT DISTINCT ON (a.after_fields->>'file') a.after_fields->>'file' AS file, a.org_id
    FROM fin_audit_log a
   WHERE a.request_path = '/sheet-import/understand' AND a.after_fields->>'file' IS NOT NULL
   ORDER BY a.after_fields->>'file', a.created_at, a.id),
crossed AS (
  SELECT c.org_id, c.import_id,
         CASE WHEN c.said IS NOT NULL AND c.said <> c.org_id THEN c.said ELSE f.org_id END AS previewed_in
    FROM commits c LEFT JOIN first_preview f ON f.file = c.file)
SELECT x.org_id, x.previewed_in, COUNT(*)::int AS imports,
       SUM((SELECT COUNT(*) FROM donors d WHERE d.org_id = x.org_id AND d.created_import_id = x.import_id))::int AS people,
       SUM((SELECT COUNT(*) FROM gifts g WHERE g.org_id = x.org_id AND g.import_id = x.import_id))::int AS gifts
  FROM crossed x
 WHERE x.previewed_in IS NOT NULL AND x.previewed_in <> x.org_id
   AND (EXISTS (SELECT 1 FROM donors d WHERE d.org_id = x.org_id AND d.created_import_id = x.import_id)
        OR EXISTS (SELECT 1 FROM gifts g WHERE g.org_id = x.org_id AND g.import_id = x.import_id))
 GROUP BY x.org_id, x.previewed_in
 ORDER BY x.org_id;
ROLLBACK;
