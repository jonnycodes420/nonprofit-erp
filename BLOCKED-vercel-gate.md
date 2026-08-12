# BLOCKED — Vercel deploy-from-Actions needs a token only the dashboard can mint

**State tonight (2026-08-11):** the `deploy-vercel` job exists in
`.github/workflows/ci.yml` (needs green tests, push-to-main only, shared
`deploy-main` concurrency group) but is DORMANT: without the `VERCEL_TOKEN`
secret it logs a notice and exits 0. **Vercel's git auto-build still owns the
frontend** — deliberately NOT disconnected, per the ordering rule (prove the
new path first, disconnect last). The live site already serves the
`<meta name="build-sha">` stamp via auto-build, so verification is ready.

No Vercel credential exists in this environment (no CLI auth.json, and tokens
cannot be minted via API — dashboard only), so these steps are yours:

## Step 1 — mint a token (dashboard, ~1 min)
1. https://vercel.com/account/tokens (log in as the account that owns team
   `team_bmpIjp9a9Cji8y2NqHsEuewv`).
2. Create Token → name `github-actions-deploy`, scope: the team that owns the
   `client` project, expiration: your call (1 year is fine — note it somewhere).
3. Copy the token (shown once).

## Step 2 — set the Actions secret (~30 s)
```sh
gh secret set VERCEL_TOKEN -R jonnycodes420/nonprofit-erp
# paste the token at the prompt
```
(Or paste it to me in a session — I can set it via the API the same way
RAILWAY_TOKEN was set, without it touching a log.)

## Step 3 — prove the Actions path (before disconnecting ANYTHING)
1. Push any commit to main (or re-run the latest CI workflow run).
2. Watch the `deploy-vercel` job: it should `vercel deploy --prod` and then
   poll https://www.stewardapp.dev/ until the page's
   `<meta name="build-sha" content=…>` equals the pushed commit SHA (5-min
   timeout, loud failure).
3. Note: until auto-build is disabled, BOTH paths deploy the same commit —
   harmless, and exactly the point of proving before disconnecting.

## Step 4 — ONLY THEN disable Vercel's git auto-build for main
No dashboard needed for this part — it's a committed config change. Add to the
ROOT `vercel.json` (top level, alongside `buildCommand`):
```json
"git": { "deploymentEnabled": { "main": false } }
```
This stops Vercel auto-building pushes to main while leaving PR/branch preview
deploys working. Commit it (I can do this step once Step 3 is proven). Do NOT
use the Ignored Build Step approach — it evaluates while CI is still pending
and never retries.

## Step 5 — sanity check the cutover
Push a trivial commit: CI tests → `deploy-vercel` deploys → meta tag flips to
the new SHA → confirm NO parallel auto-build appeared in the Vercel dashboard
deployments list.
