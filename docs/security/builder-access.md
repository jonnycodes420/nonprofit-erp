# Builder access: builders can't reach prod

*SECURE-3, 1 November 2026.*

A builder is a build tab: a Claude Code session (or a person) that writes code on a branch. A builder
needs to change the code and see whether CI passed. It never needs to see production: not its logs,
not its database, not its variables. Today it can see all three, because of the logins on this machine.
This page says what a builder keeps, what it loses, and the exact settings Jonathan changes.

## What a build tab needs

| Need | How | Where it lives |
|---|---|---|
| Push a branch, open a pull request | `git push`, `gh pr create` | the `gh` login (keyring), scopes `repo`, `workflow`, `read:org`, `gist` |
| Read CI | `gh run list`, `gh run view --log-failed` | the same `gh` login |
| The scratch stack | Postgres on `localhost:5544`, servers on its own port block | this machine only |
| Prod's health, read from outside | `npm run status` (`/health`, `buildSha`, the smoke as the demo login) | public URLs, no credential beyond the demo's |

## What a build tab must not have

| Must not have | Why | Found on this machine (1 Nov 2026) |
|---|---|---|
| Railway logs | prod error lines carry donor names, emails and ids | **yes**: the Railway CLI is logged in as Jonathan's user (`~/.railway/config.json` holds a user OAuth token and refresh token, with 4 linked projects) |
| Railway variables | they hold `DATABASE_URL`, the Stripe live keys, the Resend key, `JWT_SECRET` | **yes**: the same login, and `~/.claude.json` configures a `railway` MCP server (`railway mcp`) that acts through it, so every session has `get-logs`, `list-variables`, `set-variables`, `redeploy` |
| The prod database | every donor record | not in the shell environment (no `DATABASE_URL`, no `RAILWAY_*`), but readable through the Railway login above (`railway variables`) |
| A Supabase access token, the service key, the DB password | the whole project | none found (no `~/.supabase/access-token`, no `~/.config/supabase/access-token`, no `SUPABASE_*` variable) |
| A Vercel login | deploys the frontend past CI and reads its variables | **yes**: the Vercel CLI is logged in (`~/Library/Application Support/com.vercel.cli/auth.json`) |

The battery now checks this (`scripts/ci/builder-access-check.js`, run by `tests/script-guards.test.js`):
a Railway token, a Supabase secret or a postgres URL to a remote host in the environment fails the
battery. The machine's own logins are printed as a WARNING until `MACHINE_LOGIN_FATAL` (top of that
file) is `true`; flip it once steps 2, 3 and 5 below are done, so a machine that logs back in goes red.

## How CI deploys (what stays)

- `ci.yml` `deploy-railway` uses `secrets.RAILWAY_TOKEN`, set only on its two `railway up` steps.
  The comment there says it is a **project token** named `github-actions-deploy`. `deploy-vercel` uses
  `secrets.VERCEL_TOKEN`. `error-digest.yml` uses the same `RAILWAY_TOKEN` to read yesterday's prod error
  lines (read-only use; the token itself can do more).
- The `tree-check`, `guards` and `test` jobs are given **no secret** (the battery's guard checks this on
  `ci.yml`), and the test job's `DATABASE_URL` is the loopback service container
  (`postgresql://steward:steward@localhost:5544/steward_loadtest`). So the guard runs where there is
  nothing to find, and the deploy jobs, which do hold a token, never run the battery.

## The settings Jonathan changes

Do them in this order. Each says where the setting lives; where this page is not sure of a label, it says so.

### 1. Railway: one project token, kept only in GitHub

Railway has three kinds of token. An **account token** (Account Settings → Tokens, workspace "No
workspace") can do everything the account can, in every project. A **workspace (team) token** (same
page, a workspace chosen) can do everything in that workspace. A **project token** (the project →
Settings → Tokens) is scoped to **one environment of one project**, and is read from `RAILWAY_TOKEN`.

1. Railway → the Steward project → **Settings → Tokens**. Check that `github-actions-deploy` exists and is
   for the **production** environment. If it does not exist, create it there (name
   `github-actions-deploy`, environment `production`) and paste it into GitHub (step 1.3).
2. Railway → **Account Settings → Tokens**: delete every account or workspace token that nothing
   needs. CI does not need one. (If one is in use somewhere, it is not in this repo's workflows.)
3. GitHub → the repo → **Settings → Secrets and variables → Actions**: `RAILWAY_TOKEN` holds the
   project token, and nothing else holds a Railway token.
4. Recommended, and a CI change for a builder to make after you say so: move `RAILWAY_TOKEN` and
   `VERCEL_TOKEN` from repository secrets into a GitHub **environment** (repo → Settings →
   Environments → New environment, `production`; under "Deployment branches and tags" choose
   "Selected branches" and add `main`), and add `environment: production` to the `deploy-railway` and
   `deploy-vercel` jobs and the error-digest job. Why: today any branch a builder pushes can change a
   workflow in its pull request, and a pull request from a branch of this repo runs with the
   repository's secrets. An environment limited to `main` keeps the token out of every branch.

A project token is still strong: it deploys, and as far as this page knows it can also read the
environment's variables and logs (the error digest relies on the logs). Railway does not, to this
page's knowledge, offer a deploy-only token that cannot read variables, so the token's safety is that
it lives only in GitHub, behind `main`.

### 2. Railway: log the build machine out

On the build machine (this Mac), in a plain terminal:

```
railway logout
```

That removes the user token from `~/.railway/config.json`. Then Railway → Account Settings: if there is
a list of sessions or authorised CLI logins, end the one for this machine (this page is not sure Railway
shows one). After this a builder has no Railway access at all. Break-glass deploys
(`docs/decisions/tests-and-ci.md`) mean logging in again by hand, on purpose, and logging out after.

### 3. Remove the Railway MCP server from the builders' Claude config

`~/.claude.json` has a user-level MCP server named `railway` (`railway mcp`). Remove it:

```
claude mcp remove railway -s user
```

(or delete the `railway` entry under `mcpServers` in `~/.claude.json` by hand). Without the login from
step 2 it can do nothing, but it should not be offered to sessions at all.

### 4. Supabase: no builder holds a key, a token or the password

1. Supabase → your account (top right) → **Access Tokens**: revoke every token. A builder needs none,
   and the restore drill does not use one (`scripts/ops/restore-drill.js` does the restore as dashboard
   clicks).
2. **Rotate the database password.** It is in Railway's `DATABASE_URL`, which the Railway login on this
   machine could read until step 2, so treat it as having been reachable from a build session. Supabase
   → the prod project → **Project Settings → Database → Reset database password**. Then Railway → the
   `nonprofit-erp` service (and the worker, if it exists) → **Variables** → `DATABASE_URL`: paste the new
   connection string, and deploy the staged change. `npm run status` after.
3. The Data API. Steward never uses Supabase's REST API, its anon key or its service key: the browser
   talks only to Steward's API (SECURE-3 checked the client, the bundle and the CSP). SECURE-3 also
   turns on row-level security for every table and takes every grant away from `anon`, `authenticated`
   and `service_role` (`server/admin/dbLock.js`, checked by `scripts/sql/rls-status.sql`). As a third
   lock, turn the Data API off: Supabase → the prod project → **Project Settings → Data API** (it may be
   labelled "API"), and either switch the Data API off or remove `public` from "Exposed schemas". This
   page is not sure of the exact label in today's dashboard.
4. If you also want the keys gone: Project Settings → **API Keys**. Rotating the JWT secret or disabling
   the legacy anon and service_role keys breaks nothing in Steward (it uses neither). Again, check the
   labels; Supabase has been moving from the legacy JWT keys to publishable and secret keys.
5. On the build machine: `supabase logout` if the Supabase CLI was ever logged in (the check found no
   login today).

### 5. Vercel: log the build machine out

```
vercel logout
```

Deploys go through `ci.yml` `deploy-vercel` with `VERCEL_TOKEN`. In Vercel → Account Settings → Tokens,
keep the one token CI uses and delete the rest.

### 6. Flip the switch

When steps 2, 3 and 5 are done, set `MACHINE_LOGIN_FATAL = true` at the top of
`scripts/ci/builder-access-check.js` (a builder can make the one-line change on your word). From then
on, a build machine with a Railway, Supabase or Vercel login fails the battery.

## What a builder still sees of prod

- `npm run status`: `/health`, the build SHA and a read-only smoke as the demo login.
- The daily error digest, posted as a GitHub issue by `error-digest.yml`. It groups prod error lines by
  type and route; whatever text those lines carry, a builder with `gh` can read. Keep the digest free of
  names and emails (it is the one designed path from prod logs to a builder).
- The public site and the demo org, like anyone.
