# MANUAL-STEPS — BUILD-38 things code can't do

These require dashboard/console access. Do them from the UI/CLI as yourself; they
are NOT attempted from code (per the build's rules of engagement).

## 1. Branch protection on `main` (make CI a required check)

The CI workflow (`.github/workflows/ci.yml`) runs on every push/PR but does not
by itself block anything. Require it:

1. GitHub → repo → **Settings → Branches → Add branch ruleset** (or "Add rule")
   targeting `main`.
2. Enable **Require status checks to pass before merging** → add the **`test`**
   job (from the `CI` workflow) as required.
3. Enable **Require branches to be up to date before merging**.
4. (Solo-repo caveat) You currently push straight to `main`. Either start using
   PRs so the required check gates merges, or rely on the **pre-push hook** below
   as the pre-deploy gate for direct pushes. CI-on-push runs *after* the push and
   races the deploy — it catches regressions but doesn't prevent the bad deploy.

## 2. Block deploy when CI hasn't passed (Vercel Ignored Build Step)

Auto-deploy on push to `main` will otherwise ship a red commit before CI finishes.

- Vercel → Project → **Settings → Git → Ignored Build Step** → set a command that
  exits non-zero unless the commit's CI succeeded. Simplest robust option:
  **only deploy the commit CI has blessed.** Options, easiest first:
  - Use the **GitHub Deployments / Checks integration**: in Vercel Git settings,
    require the GitHub check to be successful before deploying (if available on
    the plan).
  - Or an Ignored Build Step script that queries the GitHub API for the head
    commit's `CI / test` check-run conclusion and `exit 1` unless it's `success`.
- Railway (backend) has no native "wait for CI" gate. Enable the pre-push hook
  (below) so the suite runs before the push that triggers Railway's deploy.

## 3. Enable the local pre-push gate (do this now, once)

```
npm run setup:hooks   # sets core.hooksPath=.githooks
```

Then every `git push` runs the full suite first and blocks on failure. It assumes
the local scratch stack is up (scratch Postgres :5544 + the API server booted per
`tests/README.md`, with `SESSION_CACHE_TTL_MS=0`). Emergency bypass:
`git push --no-verify` (don't make it a habit).

## 4. Pin GitHub Actions to commit SHAs (supply-chain hardening)

`ci.yml` pins `actions/checkout@v4` and `actions/setup-node@v4` to tags. Tags are
mutable; convert to immutable SHAs when you can resolve them:

```
gh api repos/actions/checkout/git/refs/tags/v4 --jq .object.sha
gh api repos/actions/setup-node/git/refs/tags/v4 --jq .object.sha
```

Replace `@v4` with `@<sha>  # v4` in `ci.yml`.

## 5. First CI run — watch it

CI could not be executed from this environment (no GitHub runner here). The
workflow is correct by construction and mirrors the local boot recipe, but the
first run on GitHub should be watched: the likely first-run snags are the
Postgres service readiness and the server-boot wait loop. The full suite is
proven green locally (56 suites) with the same env the workflow sets.

## 6. Tigris bucket versioning on `steward-portal-assets` (BUILD-56, belt-and-braces)

BUILD-56 makes asset destruction impossible-by-default in the APP (soft delete +
90-day retention + pointer history + restore script). Bucket versioning is the
storage-layer BELT on top — it does NOT substitute for any of that (opaque S3
version IDs with no pointer history are not a recovery path), but it means even
a bug inside the destruction seam can't permanently lose S3 bytes.

Console path (Railway buckets are Tigris under the hood):

1. Railway dashboard → project **nonprofit-erp** → prod environment → bucket
   **steward-portal-assets** → open the Tigris console/storage settings for the
   bucket (Railway surfaces a "Open in Tigris" / storage settings link).
2. Enable **Object Versioning** on the bucket.
3. Add a **lifecycle rule** to expire *noncurrent versions* after **180 days**
   (double the app's 90-day window, so the belt outlives the suspenders; keeps
   storage bounded).

CLI alternative (Tigris speaks the S3 API; use the `PORTAL_ASSETS_S3_*` creds):

```
aws s3api put-bucket-versioning --bucket steward-portal-assets \
  --endpoint-url https://t3.storageapi.dev \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket steward-portal-assets \
  --endpoint-url https://t3.storageapi.dev \
  --lifecycle-configuration '{"Rules":[{"ID":"expire-noncurrent","Status":"Enabled",
    "Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":180}}]}'
```

Verify: `aws s3api get-bucket-versioning --bucket steward-portal-assets
--endpoint-url https://t3.storageapi.dev` → `"Status": "Enabled"`.
