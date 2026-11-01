## SECURE-3 · after the deploy (2026-11-01)

1. **Point the app at api.stewardapp.dev, after this deploy** (the CSP must allow it first): Vercel → Settings → Environment Variables → `VITE_API_URL=https://api.stewardapp.dev` (Production). Then re-run the `deploy-vercel` job of the latest main CI run. CORS and Railway need no change.
2. **Release B** (a later brief) no sooner than 7 days after step 1.
3. **Back up `STEWARD_CREDENTIAL_KEY`.** It now also opens synced mail (key `k1`). Never rotate it without first pinning `STEWARD_MAIL_KEYS="k2:<new>,k1:<current>"` (docs: `scripts/ops/seal-synced-mail.js` header).
4. **Seal mail synced before today:** `node scripts/ops/seal-synced-mail.js` (dry run, prod env via `railway run`), then `--apply --i-know-this-is-prod`.
5. **Check the database lock:** run `scripts/sql/rls-status.sql` in the Supabase SQL editor. Every section should be empty.
6. **Take prod away from the build Mac** (docs/security/builder-access.md): `railway logout`; `claude mcp remove railway -s user`; `vercel logout`; revoke Supabase access tokens; rotate the Supabase DB password and update Railway's `DATABASE_URL`; turn off the Supabase Data API, or remove `public` from Exposed schemas. Optional: move `RAILWAY_TOKEN` and `VERCEL_TOKEN` into a `production` GitHub Environment limited to main. Then tell a build to flip `MACHINE_LOGIN_FATAL`.
7. **Run the restore drill once** with Muse: `scripts/ops/restore-drill.js` against a new `steward-restore-…` project (set `PROD_SUPABASE_REF`; point-in-time recovery needs the Pro plan and the add-on). Write the counts in `docs/security/restore-steps.md`.
