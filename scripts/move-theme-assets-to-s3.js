#!/usr/bin/env node
// FIX-58 item 6 · Move the stored files that fell back to Postgres into S3.
//
// Before FIX-58, an upload whose S3 put failed every try was kept in Postgres
// (portal_assets.storage 'db', s3_fallback) and held /health's
// themeAssets.dbFallbackRows above zero. FIX-58 refuses such an upload instead,
// so no new rows appear; this script moves the ones already there. It is the
// same move as assetStore.moveFallbackAssetsToS3: put, read back, compare the
// bytes, and only then switch the row to S3 and clear its Postgres copy. The id
// and URL never change. org_creo is never touched.
//
// DRY RUN BY DEFAULT. It prints what it would move (org, kind, count, bytes)
// and writes nothing. Only `--apply` moves anything. Jonathan runs it; a build
// never runs it against production.
//
//   DATABASE_URL=… PORTAL_ASSETS_S3_ENDPOINT=… PORTAL_ASSETS_S3_KEY=… \
//   PORTAL_ASSETS_S3_SECRET=… PORTAL_ASSETS_S3_BUCKET=… \
//     node scripts/move-theme-assets-to-s3.js            # dry run
//     node scripts/move-theme-assets-to-s3.js --apply    # move, 50 at a time
//
// The read-only count is scripts/sql/theme-fallback-rows.sql.
const apply = process.argv.includes("--apply");
const batchArg = process.argv.find(a => a.startsWith("--batch="));
const BATCH = Math.max(1, Math.min(500, parseInt(batchArg ? batchArg.slice(8) : "50", 10) || 50));

(async () => {
  const AS = require("../assetStore");
  const { query } = require("../db");
  if (!AS.s3Config()) {
    console.error("S3 is not configured (PORTAL_ASSETS_S3_*). Nothing to move to; nothing was changed.");
    process.exit(2);
  }
  const skip = AS.ASSET_MOVE_SKIP_ORGS;
  const rows = await query(
    `SELECT org_id, kind, COUNT(*)::int AS n, COALESCE(SUM(bytes),0)::bigint AS bytes
       FROM portal_assets
      WHERE storage = 'db' AND s3_fallback AND deleted_at IS NULL AND NOT (org_id = ANY(?))
      GROUP BY org_id, kind ORDER BY org_id, kind`, [skip]);
  const total = rows.reduce((s, r) => s + r.n, 0);
  console.log(`${apply ? "APPLY" : "DRY RUN"} · ${total} file(s) in Postgres after a failed S3 put (skipping ${skip.join(", ")})`);
  for (const r of rows) console.log(`  ${r.org_id}  ${r.kind}  ${r.n} file(s)  ${Number(r.bytes)} bytes`);
  if (!apply) {
    console.log(total ? "Nothing was changed. Run again with --apply to move them." : "Nothing to move.");
    process.exit(0);
  }
  let moved = 0, failed = 0;
  for (;;) {
    const out = await AS.moveFallbackAssetsToS3({ limit: BATCH });
    moved += out.moved; failed += out.failed;
    if (!out.moved) break;   // nothing more moved this pass (done, or only failures left)
  }
  console.log(`Moved ${moved} file(s) to S3. ${failed ? `${failed} failed attempt(s); those files stay in Postgres, run again later.` : "None failed."}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
