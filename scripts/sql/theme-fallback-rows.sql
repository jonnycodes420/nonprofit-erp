-- scripts/sql/theme-fallback-rows.sql · FIX-58 item 6. READ-ONLY.
-- The rows behind /health's themeAssets.dbFallbackRows: stored files whose S3
-- put failed every try, so their bytes sit in Postgres (portal_assets.storage
-- 'db', s3_fallback, not soft-deleted). The same definition as
-- assetStore.refreshAssetFallbackCount. FIX-58 stops new ones; these are the
-- ones already there. Per org and kind: a count, the bytes, and the first and
-- last upload day. Org ids only: no file contents, no names, no emails.
-- To move them: scripts/move-theme-assets-to-s3.js (dry run by default).
BEGIN TRANSACTION READ ONLY;
SELECT org_id, kind, COUNT(*)::int AS rows, SUM(bytes)::bigint AS bytes,
       MIN(created_at)::date AS first_uploaded, MAX(created_at)::date AS last_uploaded
  FROM portal_assets
 WHERE storage = 'db' AND s3_fallback AND deleted_at IS NULL
 GROUP BY org_id, kind
 ORDER BY org_id, kind;
SELECT COUNT(*)::int AS total_rows, COUNT(DISTINCT org_id)::int AS orgs
  FROM portal_assets
 WHERE storage = 'db' AND s3_fallback AND deleted_at IS NULL;
ROLLBACK;
