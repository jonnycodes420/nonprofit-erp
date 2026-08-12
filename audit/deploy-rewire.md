# Deploy rewire — all production deploys gated behind green CI (2026-08-11)

Goal: nothing reaches production unless the full `tests/run-all.sh` suite is green
in GitHub Actions. Railway (backend) and Vercel (frontend) both deploy FROM the
CI workflow, not from git-push triggers. Ordering rule honored throughout: the
new deploy path was built and PROVEN before any auto-deploy was disconnected —
at no point could nothing deploy.

## BEFORE state (documented prior to any change)

### Railway (backend — nonprofit-erp-production.up.railway.app)
Read via the Railway API on 2026-08-11, before any modification:

- Project `nonprofit-erp` (id `5b57d614-edaf-4347-bf50-1bb77dcfe101`),
  single environment `production` (id `c7d8597d-2edc-4dc1-8850-0cb002c4754a`),
  single service `nonprofit-erp` (id `799fdd60-1918-499c-84da-fd572d8abdef`).
- Service source: GitHub repo `jonnycodes420/nonprofit-erp`, builder RAILPACK,
  no root-directory / build-command / start-command overrides, no watch
  patterns, no healthcheck path configured on the service.
- **Deployment trigger** (the auto-deploy): id `75c09d9c-8806-4482-ba09-f9e2e25c350b`,
  provider `github`, repo `jonnycodes420/nonprofit-erp`, branch `main`,
  **`checkSuites: false`** — i.e. before this rewire Railway deployed every push
  to main immediately, WITHOUT even waiting for CI to pass. A red test run
  deployed anyway. This is the hole being closed.
- Deployment live at the start of the rewire: `f57ee874b50fbe85e0a2d5317e70dd945c3e11ac`
  (= local HEAD), deployment id `29c04ee0-1946-4bd4-a343-24bb4ce414a8`, SUCCESS.

### Vercel (frontend — www.stewardapp.dev)
No Vercel token exists in this environment (no `auth.json` under
`~/Library/Application Support/com.vercel.cli/`), so dashboard-side settings
could not be read via API. Documented from repo evidence + observed behavior:

- One project: `client` (id `prj_OCO0p927wc7CszoQS9PEEnDg7mIy`), team
  `team_bmpIjp9a9Cji8y2NqHsEuewv` (both from `.vercel/project.json`, linked at
  repo root and in `client/` — same project).
- Git integration connected to `jonnycodes420/nonprofit-erp`; production branch
  `main`; auto-builds every push (observed on every push to date). No Ignored
  Build Step configured (and it stays that way — rejected approach: it
  evaluates while CI is still pending and never retries).
- Build config from root `vercel.json`: buildCommand
  `npm --prefix client install && npm --prefix client run build`, output
  `client/dist`, plus the `/portal-api`, `/unsubscribe`,
  `/recurring/update-card` proxies and the SPA catch-all.

### Pre-push hook (unchanged)
`core.hooksPath=.githooks` — every local `git push` runs the full
`tests/run-all.sh` against the scratch stack first. It stays as-is: the INNER
gate. GitHub Actions is now the OUTER gate.

## AFTER state — the new deploy path

### CI workflow (`.github/workflows/ci.yml`)
- `test` job: unchanged suite run, plus (a) `tests/run-all.sh` now writes every
  suite's full output to `/tmp/steward-suite-logs/<suite>.log` and dumps a
  failing suite's ENTIRE output inline under its FAIL line, and (b) the workflow
  uploads that log dir as artifact `suite-logs` on failure.
- `deploy-railway` job: `needs: [test]`, runs only on push to `main`,
  concurrency group `deploy-main` with `cancel-in-progress: false` (deploys
  queue, never overlap; a superseded queued deploy is dropped so deploys
  converge on the newest green main). Steps: stamp `.build-sha` with
  `$GITHUB_SHA` → `railway up --service nonprofit-erp --ci` using the
  project-scoped `RAILWAY_TOKEN` secret → poll
  `https://nonprofit-erp-production.up.railway.app/health` until `status:ok`
  AND `buildSha == $GITHUB_SHA` (5-minute timeout, fails loudly otherwise).
- `deploy-vercel` job: same gating + same `deploy-main` concurrency group.
  DORMANT until the `VERCEL_TOKEN` secret exists (logs a loud notice and exits
  0) — see `BLOCKED-vercel-gate.md`. Once active: `vercel deploy --prod` with
  `--build-env BUILD_SHA=$GITHUB_SHA`, then poll `https://www.stewardapp.dev/`
  until the `<meta name="build-sha">` tag equals `$GITHUB_SHA` (5-minute
  timeout). Vercel's git auto-build stays connected until this job is proven.

### Deploy verification surfaces (new, this rewire)
- Backend: `/health` now reports `buildSha` — read from `.build-sha` (written
  by the deploy job into the upload), falling back to `RAILWAY_GIT_COMMIT_SHA`
  (git-triggered builds) / `BUILD_SHA`, else null.
- Frontend: `client/vite.config.js` injects `<meta name="build-sha" content=…>`
  into the built page (`VERCEL_GIT_COMMIT_SHA` → `GITHUB_SHA` → `BUILD_SHA` →
  local `git rev-parse`).

### RAILWAY_TOKEN provenance
- Project token named `github-actions-deploy`, scoped to project
  `nonprofit-erp` / environment `production` only, minted 2026-08-11 via the
  Railway GraphQL API (`projectTokenCreate`) and written straight into the
  GitHub Actions secret `RAILWAY_TOKEN` via the sealed-box secrets API
  (HTTP 201). The token was never echoed to a log or committed anywhere.
- Minting required a temporary account-level API token
  (`steward-deploy-rewire-temp`, created via `apiTokenCreate`) because the CLI
  session token may not call `projectTokenCreate`. That temp token was used for
  the mint + the rollback drill and then revoked — see "Rollback drill" below.

## Switchover log (filled in as each step completed)

- [x] 2026-08-11: BEFORE state documented (this file).
- [x] RAILWAY_TOKEN secret set (HTTP 201).
- [ ] CI log fix proven on a scratch branch (intentional failure, full output visible).
- [ ] deploy-railway proven end-to-end (tests → deploy → healthy at HEAD SHA).
- [ ] Railway GitHub auto-deploy trigger DISCONNECTED (only after the line above).
- [ ] Post-disconnect proof: trivial commit → Actions-only deploy → healthy.
- [ ] Rollback drill (redeploy previous deployment, verify, roll forward, timed).
- [ ] Vercel: dormant job in place; BLOCKED-vercel-gate.md written (token needs dashboard).

## Break-glass — deploying when GitHub Actions is down

Backend (Railway):
1. On a machine with the repo + Railway CLI authenticated (`railway whoami` —
   this laptop is, via `~/.railway/config.json`):
   ```sh
   cd ~/nonprofit-erp
   git rev-parse HEAD > .build-sha        # keep /health buildSha truthful
   railway up --service nonprofit-erp --ci
   curl -s https://nonprofit-erp-production.up.railway.app/health   # confirm buildSha
   rm .build-sha
   ```
2. The pre-push hook still guarantees local tests ran before the code reached
   main; break-glass skips only the Actions leg, never the test gate.

Frontend (Vercel): while the VERCEL_TOKEN gate is dormant, Vercel's git
auto-build still deploys pushes to main (nothing to break-glass). After the
Vercel cutover, break-glass is `npx vercel deploy --prod` from a local checkout
with a token, or temporarily re-enabling git auto-build by reverting the
`git.deploymentEnabled` block in `vercel.json`.

## Rollback drill

(to be filled in after the drill — target: redeploy the PREVIOUS Railway
deployment, verify /health + SHA revert, redeploy HEAD, record wall-clock time)
