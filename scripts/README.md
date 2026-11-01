# scripts/

ARCH-1 (1 Nov 2026) sorted this folder. Nothing new goes in the root (`scripts/ci/arch-check.js`
fails if it does).

| Folder | What lives there |
|---|---|
| `ops/` | What Jonathan runs by hand: prod checks, drills, read-only SQL, Stripe setup |
| `ci/` | What CI, the battery, a git hook or a test runs |
| `once/` | One-time scripts. Each is deleted after it has run on prod and Jonathan says so |
| `sql/` | Read-only SQL Jonathan pastes into a database console |
| `lib/`, `seed/`, `load/`, `nightly-ai/`, `demo-sites/`, `demo-assets/`, `fixtures/` | Shared helpers, the demo seed's parts, the load rig, the nightly AI eval, fixtures |

Deleted scripts are listed in `docs/architecture/scripts-removed.md`, with how to bring one back.

Every script that can write resolves its target through `scripts/lib/prodGuard.js`: it defaults
to the local scratch stack, and a remote `BASE` or `DATABASE_URL` also needs
`--i-know-this-is-prod`. `tests/script-guards.test.js` holds every script to that.

## Waiting on Jonathan now (FIX-58)

| Script | What it does | Command |
|---|---|---|
| `sql/theme-fallback-rows.sql` | READ-ONLY. Counts the stored theme files whose S3 upload failed and whose bytes sit in Postgres (`/health` `themeAssets.dbFallbackRows`), per org | `psql "$DATABASE_URL" -f scripts/sql/theme-fallback-rows.sql` |
| `ops/move-theme-assets-to-s3.js` | Moves those files into S3 (put, read back, compare, then switch the row). Dry run by default | `DATABASE_URL=… PORTAL_ASSETS_S3_ENDPOINT=… PORTAL_ASSETS_S3_KEY=… PORTAL_ASSETS_S3_SECRET=… PORTAL_ASSETS_S3_BUCKET=… node scripts/ops/move-theme-assets-to-s3.js` then the same with `--apply --i-know-this-is-prod` |

## What Jonathan runs (`ops/`)

Read-only SQL (paste into a console or `psql "$DATABASE_URL" -f <file>`):

| Script | What it does |
|---|---|
| `ops/auto-mail-switches-readonly.sql` | No automatic donor mail went out past a switch that is off (last 25 hours) |
| `ops/cross-org-import-readonly.sql` | No customer holds rows from a file previewed in another org |
| `ops/import-receipts-readonly.sql` | Every import receipt foots against its gifts, to the cent |
| `ops/import5-pledges-from-import-day-readonly.sql` | Pledges that were due from the day of their import (IMPORT-5) |
| `ops/list-vs-home-readonly.sql` | The Donors list and Home count the same people |
| `ops/stale-deletions-readonly.sql` | People live again but still named by an open deletion record |
| `sql/big-orgs.sql` | The largest orgs by rows, for scale planning |
| `sql/rls-status.sql` | SECURE-3: every public table has row-level security on (not forced) and the deny policy, and nothing is granted to anon, authenticated or service_role. Every section should be empty. psql only (`\echo`); Jonathan runs it, never a builder |

Node scripts:

| Script | What it does | Command |
|---|---|---|
| `ops/restore-drill.js` | SECURE-3: the restore drill (docs/security/restore-steps.md). Read-only SQL on a restored copy, then a scratch backend against it, the smoke and the truth check, counts only. Dry run by default; refuses prod. Jonathan only, against a `steward-restore-` project | `node scripts/ops/restore-drill.js` (dry run), then `RESTORE_DATABASE_URL=… node scripts/ops/restore-drill.js --run --project steward-restore-… --i-am-jonathan` |
| `ops/check-webhook-subscriptions.js` | READ-ONLY. Compares the Stripe webhook subscriptions with the events the code handles | `node scripts/ops/check-webhook-subscriptions.js` |
| `ops/verify-paypal.js` | READ-ONLY. One PayPal token, then a transaction search; counts only | `railway run node scripts/ops/verify-paypal.js --i-know-this-is-prod` |
| `ops/consistency-audit.js` | READ-ONLY cross-surface consistency audit (also `npm run test:audit`) | `node scripts/ops/consistency-audit.js` |
| `ops/landing-prod-verify.js` | The marketing site's prod honesty and quality check | `node scripts/ops/landing-prod-verify.js` |
| `ops/stripe-live-prices.js` | Creates the record-band prices in Stripe (test first; live needs `--live`) | `STRIPE_BILLING_SECRET_KEY=… node scripts/ops/stripe-live-prices.js` |
| `ops/numbers1-campaign-window.js` | Moves gifts credited outside their campaign's dates to no campaign. Dry run by default | `node scripts/ops/numbers1-campaign-window.js --org <id>` then `--apply` |
| `ops/seal-synced-mail.js` | SECURE-3. Seals synced email bodies and attachments stored before sealing, and rewraps rows under a rotated mail key. Counts only, never content. Dry run by default; never at deploy | `DATABASE_URL=… STEWARD_CREDENTIAL_KEY=… node scripts/ops/seal-synced-mail.js` then the same with `--apply --i-know-this-is-prod` (add `PORTAL_ASSETS_S3_*` when S3 is in use; `STEWARD_MAIL_KEYS` while rotating) |
| `ops/backfill-campaign-attribution.js` | Backfills `campaign_id` on historical gifts. Dry run by default | `node scripts/ops/backfill-campaign-attribution.js` then `--apply` |
| `ops/restore-asset.js` | Brings back a soft-deleted portal asset and its pointer | `node scripts/ops/restore-asset.js list <orgId>` / `restore <pa_id> [--repoint]` |
| `ops/load-irs-ein-registry.js` | Loads the IRS Pub 78 list into `ein_registry` | `node scripts/ops/load-irs-ein-registry.js <pub78.txt \| --url>` |
| `ops/build58-stripe-drill.js` | Boundary drills against real Stripe test mode, on a scratch server | see its header |
| `ops/build76-drift-drill.js` | Drift against real Stripe test mode (docs/drift/README.md) | see its header |
| `ops/build95-cheque-drill.js` | Reads cheque images with the real model | `ANTHROPIC_API_KEY=… node scripts/ops/build95-cheque-drill.js <image> …` |
| `ops/build99-brief-drill.js` | The prospect-brief drill with the real model, on a local stack | `ANTHROPIC_API_KEY=… BASE=… EMAIL=… PASSWORD=… DONOR=<id> node scripts/ops/build99-brief-drill.js` |
| `ops/build99-walk.js` | The major-gifts walk on a local stack | `BASE=http://localhost:5661 EMAIL=… PASSWORD=… node scripts/ops/build99-walk.js` |
| `ops/build75-route-inventory.js` | Builds the route inventory into `.generated/` (scratch stack only) | `node scripts/ops/build75-route-inventory.js` |
| `ops/build-local-dist.sh` | Builds `client/dist` for the local stack | `API=http://localhost:5601 bash scripts/ops/build-local-dist.sh` |
| `ops/import-walk.js` | The FIX-55 import walk on the real-shaped files (the walk every build ends with) | `node scripts/ops/import-walk.js <screenshot dir>` |
| `ops/sweep2-walk-org.js` | A fresh local org with the three real-shaped files imported, for a walk | `BASE=http://localhost:5821 DATABASE_URL=… node scripts/ops/sweep2-walk-org.js` |
| `ops/screenshot-matrix.js` | Layout screenshots and deep-link checks on the built client | see its header |
| `ops/topbar-verify.js` | Top-bar search check on the built client | see its header |
| `ops/seed-loadtest.js` | A 25,000-donor org on the local database, for load tests | `DATABASE_URL=postgresql://steward@localhost:5544/steward_loadtest node scripts/ops/seed-loadtest.js` |

`ci/builder-access-check.js` (SECURE-3) is run by the battery (`tests/script-guards.test.js`): it fails if
this environment holds a Railway token, a Supabase secret or a remote postgres URL, and warns about
the machine's own Railway login and MCP (docs/security/builder-access.md). `node scripts/ci/builder-access-check.js`
runs it by hand.

The commands most builds use are `npm run status` (`ci/status.js`, prod smoke after a deploy),
`node scripts/ci/tdz-scan.js` and `node scripts/ci/arch-check.js`.

## One-time, not yet proven run (`once/`)

These change data or read prod, and ARCH-1 could not find a record (HISTORY or a decision) that
each has run on prod. Jonathan decides: if it has run, or never needs to, delete it.

`build59-install-demo-images.js`, `build72-cents-audit.js`, `build73-cents-audit.js`,
`build75-phase0-audit.js`, `build89-demo-seed.js`, `ckrh-provision.js`,
`create-billing-products.js` (its header says `ops/stripe-live-prices.js` replaced it),
`demo-real-people-check.js`, `fix-build54-demo-photos.js`, `fix-demo-finance-ledger.js`,
`migrate-build51-theme-assets.js`, `migrate-build51b-impact-photos.js`,
`migrate-plans-core-team.js`, `seed-build45-asks.js`, `seed-build45-portal-demo.js`,
`seed-build50-demo.js`, `seed-build54-demo.js`, `seed-build86-vocabulary.js`,
`seed-creo-goals.js`, `seed-fundraising-demo.js`.
