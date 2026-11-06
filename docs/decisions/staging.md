# Staging, shipping and rollback

Read this when you touch the deploy jobs (`ci.yml`, `ship.yml`), `/ops`'s Ship card,
`npm run status`, the staging seed, or anything that sends mail or charges money and might
run on staging.

## The rules (STAGE-1)

- **Staging is a second copy of Steward**: Railway environment `staging` (its own `web`,
  `worker` and Postgres) and Vercel project `steward-staging` on `staging.stewardapp.dev`. It
  is told it is staging by `STEWARD_ENV=staging`, and `/health` says `env: "staging"`.
  Prod's says `"production"`. Nothing decides staging from a hostname.
- **Staging never holds customer data.** Its data is `scripts/ops/staging-seed.js --staging`:
  the Harborlight demo (Muse walks it), `org_stagewalk` (the CI walk writes there) and
  `org_stagefixtures` (the real-shaped files, every name made up), torn down and rebuilt each
  run, then scanned for real names. A hit stops the run.
- **Staging never reaches a real inbox or a live card.** `server/shared/stagingEnv.js` runs
  first at boot in every process: a live Stripe key stops it, and every call to Resend (any
  client, any base URL) or a mailbox send is answered in-process and stored in
  `staging_mail_capture`. Do not add a send path that avoids `fetch` (SMTP, a raw socket)
  without making staging refuse it too.
- **A merge goes to staging first** once the repo variable `STAGING_ENABLED` is `true`:
  `deploy-staging` (FLAKE-1's turnstile, then Railway web and worker, then Vercel with
  `vercel.staging.json`, which `scripts/ci/vercel-staging-config.js` makes from `vercel.json`
  with every prod API host replaced), then `staging-walk`, which writes the commit status
  `staging/walk`. Unset, the old prod jobs run exactly as before.
- **Prod moves only from /ops.** "Ship to customers" (super-admins only, 404 to anyone else)
  re-reads staging, the walk and GitHub, and dispatches `ship.yml` for exactly the commit
  staging serves. `ship.yml` checks it again, waits behind any running prod deploy, deploys
  web, worker and frontend, and runs the prod checks and the AI smoke. "Roll back" dispatches
  it for the commit prod served before (`deploy_history`, noted at each web boot). Each press
  is a `prod_ships` row and an audit row naming the commit.
- **Ship is off, with the reason shown,** while staging is not set up, unreachable, not
  saying staging, mid-deploy (a CI run deploying or walking it, or web, worker and frontend
  on different commits), already what prod has, unwalked, red, or while a ship runs.
  `shipSources.decide` is the one rule; the card and the press both read it.
- **A hotfix** skips staging only with the `hotfix` label AND a `Hotfix reason: …` line (10+
  characters) in the PR description (`scripts/ci/deploy-lane.js`). A label with no reason
  goes through staging, with a warning on the run.
- **A build is done when it is live on staging** and its walk is green. Jonathan ships it.

## For Muse: signing in to staging

Staging is `https://staging.stewardapp.dev`. Sign in as the Harborlight director,
`director@harborlight.demo`, password `demo-harbor-2026` (the officer is
`officer@harborlight.demo`, the same password). Those are the demo's own accounts, the same as on
prod's demo, and every person in that org is made up. Walk Harborlight only: the CI walk
writes to its own org after each merge, so Harborlight's numbers stay where the last rebuild
left them (the seed prints them, and `SHAPE` and `DRIFTED` in `scripts/ci/seed-demo.js` say
what they should be). `/health` on the staging API says which commit you are walking. Mail
you trigger never leaves staging; it lands in `staging_mail_capture`. Card payments use
Stripe test cards (4242 4242 4242 4242). Name a staging walk report with `staging` in its file
name so `/ops` shows it as Muse's latest staging walk.

## How to rebuild staging

`BASE=<staging API> railway run --environment staging --service web -- node scripts/ops/staging-seed.js --staging`
(`docs/needs-jonathan/STAGE-1.md` step 8).
