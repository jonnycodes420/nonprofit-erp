## 0-ARCH-1 · THE SCRIPTS MOVED; TWO STILL WAIT ON YOU, AND TWENTY TO DECIDE (2026-11-01)

- **The theme files that fell back to Postgres (FIX-58), new paths.** Count them (read-only): `psql "$PROD_DATABASE_URL" -f scripts/sql/theme-fallback-rows.sql`. Then move them, dry run first: `DATABASE_URL=… PORTAL_ASSETS_S3_ENDPOINT=… PORTAL_ASSETS_S3_KEY=… PORTAL_ASSETS_S3_SECRET=… PORTAL_ASSETS_S3_BUCKET=… node scripts/ops/move-theme-assets-to-s3.js`, then the same with `--apply --i-know-this-is-prod`.
- **Every script you run moved** to `scripts/ops/` (or `scripts/ci/`); `scripts/README.md` has each one's command. `npm run status` is unchanged.
- **Twenty one-time scripts in `scripts/once/`** change data or read prod, and no record says they ran there (list in `scripts/README.md`). For each: if it ran, or never needs to, say so and the next build deletes it.
- **`shared/publicSources.js`** is a policy file nothing imports. Keep or delete?
