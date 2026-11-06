## STAGE-1 · Turn on staging (2026-11-06)

Nothing changes until step 9. Until `STAGING_ENABLED` is set, a merge deploys to prod exactly as today. Do the steps in order. No value is written here: each line says where a value comes from, and whether it is a **new secret**, **safe to reuse** from prod, or **test-only**.

Muse already made Railway's `staging` environment in project `nonprofit-erp`, with `Postgres`, `web` and `worker` (no variables yet; `web` shows Failed and `worker` Crashed, which is expected).

### 1. Railway, project nonprofit-erp, environment staging: the services (no cost of its own)

1. **`web` and `worker`, Settings, Source: Disconnect the repo.** Both are connected to `main` right now, so every merge would auto-deploy them before CI has run. CI deploys them with `railway up` (Git auto-deploy stays off, as on prod).
2. **`Postgres`, Settings, Region: move it to US East (Virginia)**, where `web` and `worker` run. It is in `sfo` now, which puts about 70 ms on every query. It is empty, so moving it loses nothing.
3. **`web`, Settings, Deploy:** start command `node server.js`, healthcheck path `/ready`, replicas 1 (the same as prod). **Networking: Generate Domain.** That `https://…up.railway.app` address is **STAGING_API_URL** in steps 5 to 8.
4. **`worker`, Settings, Deploy:** start command `node server.js`, healthcheck path `/health`, replicas 1. **No domain.**

### 2. Railway, staging: variables

Put the common ones in **staging, Shared Variables**, then add the two per-service lines.

| Variable | Value comes from | Kind |
|---|---|---|
| `STEWARD_ENV` | the word `staging` | new, not secret. Turns on the guards: a live Stripe key stops the boot, and every email goes to the capture table `staging_mail_capture` |
| `DATABASE_URL` | Railway reference `${{Postgres.DATABASE_URL}}` (staging's own Postgres) | Railway reference. **Never prod's** |
| `DATABASE_PUBLIC_URL` | Railway reference `${{Postgres.DATABASE_PUBLIC_URL}}` | Railway reference, for the rebuild command below |
| `JWT_SECRET` | generate: `openssl rand -hex 32` | **new secret.** Never prod's, or a prod session would work on staging |
| `STEWARD_CREDENTIAL_KEY` | generate: `openssl rand -hex 32` | **new secret** |
| `STAGING_WALK_PASSWORD` | generate: `openssl rand -base64 24` | **new secret**, the same value also goes in GitHub (step 6) |
| `CORS_ORIGIN` | `https://staging.stewardapp.dev` | new, not secret |
| `FRONTEND_URL` and `APP_URL` | `https://staging.stewardapp.dev` | new, not secret (links in captured mail point at staging) |
| `RESEND_API_KEY` | any placeholder, e.g. `re_staging_capture` | **test-only.** Never prod's key. It only makes the send paths run; the capture answers them |
| `DEMO_SMTP_FROM`, `FOUNDER_EMAIL`, `DEMO_NOTIFY_EMAIL` | prod's values | safe to reuse (addresses, not secrets; nothing is delivered) |
| `NODE_ENV`, `DONOR_ACCOUNTS_ENABLED`, `NETWORK_SIGNUP_ENABLED`, `RESEND_DOMAIN_VERIFIED`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | prod's values | safe to reuse (switches) |
| `STRIPE_SECRET_KEY` | Stripe dashboard, **Test mode**, Developers, API keys, the `sk_test_` key | **test-only** |
| `STRIPE_BILLING_SECRET_KEY` | the same `sk_test_` key (or the billing account's test key) | **test-only** |
| `STRIPE_WEBHOOK_SECRET` | Stripe **Test mode**, Webhooks, Add endpoint `STAGING_API_URL/stripe/webhook`, the same events as prod's endpoint, then its signing secret | **test-only** |
| `STRIPE_BILLING_WEBHOOK_SECRET` | the same for `STAGING_API_URL/billing/webhook` | **test-only** |
| `STRIPE_PRICE_*` (the same names prod has) | Stripe **Test mode**, Products: the test copies of each price (Stripe's "Copy to live/test" on each product) | **test-only** |
| `ANTHROPIC_API_KEY` | optional. A **new** key in its own Anthropic workspace with a monthly spend limit (about $10). Leave unset and AI is off on staging, as in the tests | **new secret**, optional |

Per service: **`web`** add `STEWARD_PROCESS=web`; **`worker`** add `STEWARD_PROCESS=worker`.

**Leave unset on staging:** `SENTRY_DSN` (or staging errors land in prod's Sentry), `RESEND_WEBHOOK_SECRET`, every `INBOUND_EMAIL_*`, `GOOGLE_*`, `MICROSOFT_*`, `INTUIT_*`, `XERO_*`, `MAILCHIMP_*`, `PAYPAL_*`, `SQUARE_*`, `PORTAL_ASSETS_S3_*` (files go in staging's Postgres), `DEMO_SMTP_HOST/PORT/USER/PASS` (staging drops them anyway), `MIGC_*`, `OPS_GITHUB_TOKEN`, `OPS_SHIP_TOKEN`, `WORKER`, `RESEND_BASE_URL`. No staging variable ever holds a `sk_live_`, `rk_live_` or `pk_live_` key: the boot refuses it.

### 3. Railway: a deploy token for staging only (free)

Project nonprofit-erp, Settings, Tokens, **New token**, environment **staging**, name `github-actions-staging`. A token scoped to staging cannot deploy prod. It becomes the GitHub secret `RAILWAY_STAGING_TOKEN` (step 6).

### 4. Vercel: a second project for staging.stewardapp.dev (no extra cost on the existing team)

1. Team `jonnycodes420`'s team (the one holding the Steward project), **Add New, Project**, name `steward-staging`. Do **not** connect the Git repository (CI deploys it with the CLI). If the screen insists on a repo, connect it and then Settings, Git, **Disconnect**.
2. Settings, General: Framework **Other**, root directory `./`. Build and output come from the config CI writes (`vercel.staging.json`).
3. Settings, Domains: add **`staging.stewardapp.dev`**, and the DNS record it asks for (a CNAME to `cname.vercel-dns.com`) where stewardapp.dev's DNS lives.
4. Settings, Deployment Protection: leave **Standard**. It does not cover a project's production domain, so staging.stewardapp.dev stays reachable for Muse. It holds only made-up people and sends `noindex`.
5. Copy the **Project ID** (Settings, General). It becomes the GitHub variable `VERCEL_STAGING_PROJECT_ID`. The existing `VERCEL_TOKEN` secret deploys both projects.

### 5. GitHub: a token for the Ship button (free)

github.com, Settings, Developer settings, **Fine-grained tokens**, Generate: name `steward-ops-ship`, expiry 90 days, repository access **only `jonnycodes420/nonprofit-erp`**, repository permissions **Actions: Read and write** (Metadata read is added for you). Nothing else. It goes on prod's web service only (step 7).

### 6. GitHub repo, Settings, Secrets and variables, Actions

- **Secrets:** `RAILWAY_STAGING_TOKEN` (step 3, **new secret**), `STAGING_WALK_PASSWORD` (the same value as on staging, **new secret**). `VERCEL_TOKEN` and `RAILWAY_TOKEN` are reused as they are.
- **Variables:** `STAGING_API_URL` = the web domain from step 1.3 (`https://…`, no trailing slash); `VERCEL_STAGING_PROJECT_ID` (step 4.5). Optional, defaults shown: `STAGING_APP_URL` = `https://staging.stewardapp.dev`, `RAILWAY_STAGING_WEB_SERVICE` = `web`, `RAILWAY_STAGING_WORKER_SERVICE` = `worker`.
- **Issues, Labels:** create the label **`hotfix`**.

### 7. Railway, production, `nonprofit-erp` (prod web): two variables for /ops

- `STAGING_API_URL` = the same staging web address (not secret). Optional `STAGING_FRONTEND_URL` (defaults to `https://staging.stewardapp.dev`).
- `OPS_SHIP_TOKEN` = the token from step 5 (**new secret**). Without it the Ship button says so and does nothing.

### 8. Build staging's data, once (and any time you want it fresh)

From your checkout of main (after `npm ci` and `npm --prefix client ci`), with the Railway CLI logged in (`railway link` to nonprofit-erp once). Railway passes staging's variables in; nothing is copied:

`BASE=<STAGING_API_URL> railway run --environment staging --service web -- node scripts/ops/staging-seed.js --staging`

It refuses anything whose /health does not say `env: "staging"`. It rebuilds the Harborlight demo (Muse walks it), the walk org and the real-shaped fixtures (made-up names), then scans for real names and stops on any. A second run gives the same rows. To also scan against customer org names, add `STAGING_REAL_NAMES="Name One,Name Two"` before `railway run`; never put that list in a file.

The first time, push or re-run CI after step 9 first, so staging is running the code this needs.

### 9. Switch it on

GitHub variable **`STAGING_ENABLED` = `true`**. From the next merge: CI deploys staging and walks it; prod moves only when you press **Ship to customers** on /ops. To go back to merge-deploys-prod, delete the variable.

### What it costs

- **Railway:** usage-based on the plan you already have. A mostly idle web and worker and a small Postgres with a 5 GB volume: roughly $10 to $20 a month together. The token is free.
- **Vercel:** a second project on the existing Pro team: no seat or project fee; its builds and traffic count against the same included usage.
- **GitHub Actions:** each merge adds a staging deploy and walk, about 10 to 15 runner minutes. Ship runs add about 8 minutes each.
- **Stripe test mode:** free. **Anthropic (optional):** capped by the spend limit you set, about $10.
