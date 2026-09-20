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

## Founding-partner onboarding call — verify the org's sending domain (BUILD-88c C.1)

Add to the import call, after the file is in and before the first appeal goes out:

1. Settings → **Send from your own address** → type the address donors should
   see (`ada@theircharity.org`) → **Use this address**.
2. Steward shows the three DNS records Resend asked for (DKIM TXT, an MX and a
   TXT for the return path). Copy each and give them to whoever runs the
   organisation's DNS — usually their web host, sometimes a volunteer.
3. Press **Check** when they say it is published. Records usually propagate in
   minutes; occasionally hours. **Nothing is blocked while it is pending** —
   appeals, receipts and reconnect links all still send on Steward's shared
   domain with the org's name on them and a Reply-To that reaches them.
4. When it flips to **Verified**, send yourself one test from Communications and
   read it on a phone: the From should be their address at their domain, and
   nothing in the header should say Steward.

Why it is on the call and not left to them: an unfamiliar sending domain costs
deliverability, and a receipt in a donor's spam folder becomes a support ticket
the donor opens **with the organisation**. It is fifteen minutes on a call and
it is the difference between their mail arriving and their mail arriving
sometimes.

## §7 — STEWARD_CREDENTIAL_KEY (BUILD-89S 89a, 2026-09-20)

**Required before any organisation can connect a giving source (PayPal, Zeffy,
Stripe, Givebutter).** A provider credential is a key to the organisation's own
money, so Steward refuses to store one unless it can seal it.

1. Generate a key (at least 32 characters):
   ```
   openssl rand -base64 32
   ```
2. Railway → the `nonprofit-erp` service → Variables → add
   `STEWARD_CREDENTIAL_KEY=<the value>`. Redeploy.
3. Confirm: `GET /giving-sources/providers` as any signed-in user returns
   `"credentialsReady": true`.

Until it is set, every connect attempt answers 503 with a sentence naming the
variable, and nothing is written — the feature is unavailable rather than
insecure.

**Rotating this key orphans every stored credential** (there is no re-seal path
yet — see BLOCKED-build89a.md §1). After a rotation every source must be
disconnected and connected again.

## §8 — THE THREE LIVE STRIPE PRICES (BUILD-90, 2026-09-20)

The close link is the only door a customer comes through, and it refuses to
mint a Checkout session for a plan with no Stripe price id configured. That is
deliberate — a link that cannot charge beats one that quietly charges the wrong
amount — but it means **nobody can be closed until these three exist**.

Amounts: Founding **$199**, Core **$249**, Team **$499**.

```bash
STRIPE_BILLING_SECRET_KEY=sk_test_… node scripts/create-billing-products.js          # test first
STRIPE_BILLING_SECRET_KEY=sk_live_… node scripts/create-billing-products.js --live   # then live
```

Paste the printed `STRIPE_PRICE_FOUNDING` / `STRIPE_PRICE_CORE` /
`STRIPE_PRICE_TEAM` into Railway, and set `FOUNDER_EMAIL` to a **verified
Resend sender** — it is the From on the welcome email and on the seven-day
pre-charge reminder, both of which should read as coming from Jonathan.

Then run one real close link on prod with your own card, confirm Stripe shows
a trialing subscription with no charge, and cancel it. Full checklist and the
reasoning: `BLOCKED-build90.md`.

**Never set `STRIPE_BILLING_API_BASE` in production** — it is the local-test
seam that points the billing client at a mock.
