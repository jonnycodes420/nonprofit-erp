# Steward — Ops Readiness Audit
Discovery only. No fixes applied. Generated 2026-07-10.

> ## UPDATE — verification pass, 2026-07-16 (BUILD-04 Strike 4)
> Most GAPs below were fixed in the 2026-07-10–07-13 sessions but this report was never updated (same staleness pattern as SECURITY_REPORT.md/QA_REPORT.md). Current status per item:
>
> | # | Item | Status as of 2026-07-16 |
> |---|------|-------------------------|
> | 1 | Backend uncaughtException/unhandledRejection → Sentry | **FIXED** (handlers at server.js top, registered right after `Sentry.init()`) and **exercised live in production today**: `POST /admin/debug/sentry-test?mode=rejection` fired a real unhandledRejection, process stayed up as designed. Backend `SENTRY_DSN` confirmed set on Railway via the new `sentry` boolean on `GET /health`. |
> | 1 | Client Sentry init | Code OK, **NOT live in prod**: the deployed bundle contains no DSN → `VITE_SENTRY_DSN` is missing from Vercel's build env. Config-only fix. |
> | 1 | Client source maps | Plugin + gating shipped in vite.config.js (2026-07-10 session), **but not functioning in prod**: zero `_sentryDebugId` markers in the deployed bundle → `SENTRY_AUTH_TOKEN` missing from Vercel's build env. Config-only fix (also needs `SENTRY_ORG`/`SENTRY_PROJECT`). |
> | 1 | Sentry alerting rules | Still needs a human check in the Sentry dashboard — also confirm the two `[sentry-test]` events fired 2026-07-16 actually arrived. |
> | 2 | Rate limiting | **FIXED 2026-07-10** — `express-rate-limit` on login (per-IP + per-account), register, register-org, forgot/reset-password, donate, plus a global baseline; CORS fail-closed allowlist replacing the `"*"` default (two hotfix rounds, see PROGRESS.md). |
> | 3 | DB backups / PITR | Still needs a human check in the Supabase dashboard (plan tier / PITR). Unchanged. |
> | 4 | Unsubscribe + bounce/complaint suppression | **FIXED 2026-07-10** — `email_suppressions` table, signed one-click unsubscribe (RFC 8058), `List-Unsubscribe` headers, Svix-verified `POST /resend/webhook` suppressing on bounce/complaint. |
> | 5 | External uptime monitor | **Decision documented** (CLAUDE.md "Uptime monitoring"): UptimeRobot/Better Stack free tier on `GET /health` (keyword `"status":"ok"`) + `https://www.stewardapp.dev/give/creo-arts-creo`, alerts to founder email. ~5-min user click-through remains (needs an account signup). |
> | 6/7 | Logging & secrets hygiene | Were already OK. Unchanged. |
>
> **Net remaining ops to-dos (all human/dashboard-side, no code)**: add `VITE_SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (+`SENTRY_ORG`/`SENTRY_PROJECT`) to Vercel and redeploy; confirm Sentry alert rules + test-event arrival; confirm Supabase backup tier; click through the uptime-monitor signup.

---

## 1. Error monitoring (Sentry)

**Backend (server.js) — PARTIAL / GAP**
- Sentry IS initialized: `server.js:2-9`, guarded by `if (process.env.SENTRY_DSN)`. DSN read from env var, not hardcoded. ✅
- Environment tag set: `environment: process.env.NODE_ENV || "production"` ✅
- `Sentry.setupExpressErrorHandler(app)` is called at `server.js:5553`, but **only inside the same `if (process.env.SENTRY_DSN)` gate is implied — verify it's not double-gated incorrectly** (it re-checks `process.env.SENTRY_DSN` independently, so it's consistent, but it's a second env check instead of a single boolean — low risk, just untidy). This handler catches errors thrown/passed to `next()` inside Express routes.
- **GAP: no `process.on("uncaughtException")` or `process.on("unhandledRejection")` handlers anywhere in server.js.** Any promise rejection that isn't awaited inside a route handler, or that happens in a background job (`syncAllGmail`, `processSequences`, `checkTrialExpiry`, the `setInterval`/`setTimeout` jobs), will NOT reach Sentry via `setupExpressErrorHandler` since it never touches Express's request/response cycle. Many of these background loops do have local `.catch(console.error)`/`.catch(e => console.error(...))` wrappers, which prevents an actual crash, but those errors go to Railway logs only — not Sentry. A genuinely unhandled rejection anywhere else would crash the Node process with no Sentry event and no restart telemetry beyond Railway's own crash log.

**Client (client/src) — PARTIAL / GAP**
- Sentry IS initialized in `main.jsx:2-10`, DSN from `import.meta.env.VITE_SENTRY_DSN` (env var, not hardcoded) ✅, environment tag from `import.meta.env.MODE` ✅, `browserTracingIntegration()` enabled.
- **GAP: no error boundary integration confirmed** — didn't find `Sentry.ErrorBoundary` or `Sentry.withErrorBoundary` wrapping the app in main.jsx or App.jsx. React errors during render may only be caught if a manual `componentDidCatch`/error boundary exists and reports to Sentry; worth confirming (not found in this pass).
- **GAP: no source map upload configured.** No `@sentry/vite-plugin` in `client/package.json`, no `sentryVitePlugin(...)` in `client/vite.config.js`, no `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` referenced anywhere in the repo. **Client-side errors in Sentry will show minified/mangled stack traces** (e.g. `main-a1b2c3.js:1:48213`), not real file/line/function names. This is one of the highest-value fixes here — without it, every production JS error is nearly unreadable.

**Alerting — CAN'T VERIFY FROM CODE**
- No Slack/PagerDuty/email alert-rule config lives in the repo (Sentry alert rules are dashboard-side, not code). **Cannot confirm whether anyone gets paged/notified on new errors, or whether this relies on someone manually checking the Sentry dashboard.** Recommend checking Sentry project settings → Alerts.

---

## 2. Rate limiting

**GAP — zero rate limiting anywhere in the app.**
- No `express-rate-limit` or any rate-limiting package in `package.json` dependencies.
- No rate-limiting middleware of any kind (`grep` for `rate-limit`/`rateLimit`/`slowDown` across `server.js` returns nothing).
- Confirmed unprotected, publicly reachable, no-auth-required endpoints:
  - `POST /auth/login` (server.js:351) — no attempt/lockout limiting → credential-stuffing / brute-force exposed.
  - `POST /auth/register` (server.js:370) — legacy signup route, unlimited account creation.
  - `POST /auth/register-org` (server.js:498) — current signup route, also creates a Stripe customer per call → unlimited signups could also spam Stripe API calls.
  - `POST /auth/forgot-password` (server.js:400) — unlimited password-reset-email triggering → could be used to spam a target inbox or enumerate registered emails (check whether the response differs for known vs unknown email — not evaluated in this pass, flagging as an adjacent risk).
  - `POST /auth/reset-password` (server.js:478) — token-guessing exposed with no throttling (mitigated somewhat if tokens are high-entropy/random, but no rate limit as defense-in-depth).
  - `POST /donate/:orgSlug` (server.js:3246) — public donation entry point, creates a Stripe Checkout Session per call with no limiting. Could be abused to spam-create Checkout sessions against a connected org's Stripe account (not itself a charge, but still API abuse / noise / potential Stripe rate-limit trip for the platform account).
  - `GET /gmail/callback` (server.js:5097) — public OAuth callback, no rate limit (lower risk since it requires a valid Google OAuth `code`, but still unauthenticated and reachable).
- No CORS restriction compounds this: `cors({ origin: process.env.CORS_ORIGIN || "*" })` (server.js:34) — if `CORS_ORIGIN` isn't set in Railway, this defaults wide open. **Worth confirming `CORS_ORIGIN` is actually set in the Railway env** (can't verify from repo).

This is the single largest concrete gap found in this audit — a nonprofit ERP going to market with an open login/signup/donation surface and no throttling is a realistic abuse vector before day one.

---

## 3. Database backups (Supabase)

**CAN'T VERIFY FROM CODE — no backup/export scripts exist in the repo.**
- Searched for `*backup*` files — none found.
- No `pg_dump` cron, no scheduled export route, no `/admin/export` style route in `server.js`.
- `db.js` connects via a plain `pg.Pool` (server.js:22 in db.js) directly to Supabase's Postgres — no app-level backup logic exists, which is expected (this is normally Supabase-managed), but means **there is currently no independent/secondary backup outside of whatever Supabase's plan tier provides.**
- **Needs manual verification in the Supabase dashboard:**
  - Which plan tier the project is on (Free/Pro/Team) — this determines both backup retention window and whether Point-in-Time Recovery (PITR) is available at all (PITR requires Pro tier or above on Supabase).
  - Current daily-backup retention setting (Free tier: none guaranteed; Pro: 7 days by default, configurable/extendable).
  - Whether PITR is actually enabled (it's opt-in/config even on eligible plans).
  - No documentation of the current plan tier exists anywhere in `CLAUDE.md` or the repo — this should be written down once confirmed so it doesn't have to be rediscovered.

---

## 4. Email deliverability & compliance (Resend)

**GAP across the board — no unsubscribe mechanism, no bounce/complaint handling, no suppression list.**

- **Unsubscribe: missing.** Searched campaign send logic (server.js ~2780-2840, the `/campaigns/:id/send` background sender) and sequence send logic (`processSequences()`, `sendOnboardingSequence()`, server.js ~4150-4270) — neither includes an unsubscribe link, a `List-Unsubscribe` header, nor any token-based one-click opt-out. The only "unsubscribe" mechanism that exists is `POST /sequences/:id/unenroll` (server.js ~4432), which sets `sequence_enrollments.status='unsubscribed'` — but this is an **authenticated, admin-triggered, per-sequence** action inside the app. A donor receiving a campaign or sequence email has no self-service way to opt out from the email itself.
- **No global suppression list.** The `unsubscribed` status set by `/sequences/:id/unenroll` is scoped to a single `(sequence_id, donor_id)` row (`UNIQUE(sequence_id, donor_id)` per CLAUDE.md schema notes). A donor "unsubscribed" from one sequence is still fully eligible for: every other active sequence, every future campaign send (campaign sends filter only by `stage`/`status`/`capacity_tier`/manual selection — server.js ~2780-2806 — with no exclusion check against `sequence_enrollments` or any suppression table at all), and re-enrollment into the same sequence by `autoEnroll()` if trigger conditions match again.
- **No bounce/complaint webhook.** Searched for `resend...webhook`, `/resend/webhook`, `bounce`, `complaint`, `svix` (Resend's webhook signing library) — no matches in `server.js`. There is no `/resend/webhook` route registered at all. This means:
  - A hard-bounced address (e.g. donor left the org, address typo) will be retried by every future sequence/campaign send indefinitely — no backoff, no suppression.
  - A spam complaint is invisible to the app — nothing downgrades or flags that donor, and repeated complaints against the sending domain risk Resend/ISP reputation damage for `noreply@stewardapp.dev`, which would degrade deliverability for every org on the platform, not just the offending one.
- Net effect: this is a compliance gap (CAN-SPAM in the US requires a functioning unsubscribe mechanism honored within a reasonable window) as well as an operational/deliverability risk (no bounce suppression → reputation decay on the shared sending domain).

---

## 5. Uptime/health monitoring

- **Health endpoint exists: OK.** `GET /health` (server.js:192) returns `{ status: "ok", version: "1.1.0", db: dbReady }`, unauthenticated, cheap — suitable as an external uptime-monitor target.
- **GAP: nothing external is currently configured against it, as far as the repo shows.** No `railway.json`/`railway.toml` healthcheck config in the repo (Railway does support a healthcheck-path setting, but it's either unset or configured only in the Railway dashboard — can't verify from code, only the absence of a config file). No UptimeRobot/BetterStack/Checkly config or webhook reference anywhere in the repo.
- **Frontend (Vercel):** Vercel provides platform-level deployment/build failure notifications by default, but that's not the same as runtime uptime monitoring (e.g. a client-side JS error loop or a bad deploy that builds fine but breaks at runtime wouldn't be caught by Vercel's own deploy-status alerts). No `@vercel/*` uptime-specific package beyond `@vercel/analytics` and `@vercel/speed-insights`, which are usage/perf telemetry, not alerting.
- **Recommend:** confirm in the Railway dashboard whether a healthcheck path is set for `/health`, and separately, stand up an actual external monitor (UptimeRobot, BetterStack, etc.) hitting both the Railway `/health` endpoint and the Vercel frontend root — currently neither app going down would generate any automatic notification to anyone.

---

## 6. Logging hygiene

**Mostly OK — one prior JWT-leak incident already fixed per CLAUDE.md; this pass found no new instances of raw secrets in logs.**

- Grepped all `console.log`/`console.error`/`console.warn` calls in `server.js` against tokens/JWTs/passwords/secrets/API keys/`req.body`/`Authorization` — no line logs a raw token, password, or API key value. Existing logs that reference credentials only log presence/absence, not the value itself, e.g.:
  - `server.js:2822` — `` `RESEND_API_KEY=${resendApiKey?"set":"MISSING"}` `` — logs boolean-style presence, not the key. ✅ good pattern.
  - `server.js:3159`/`3180` (Stripe Connect account creation failures) — logs `err.message`, `err.type`, `err.code`, `err.param`, `err.raw` — this is the Stripe SDK's structured error object; `err.raw` **can** include request parameters Stripe echoes back in some error types. Worth a closer look at whether `err.raw` ever includes what was submitted (e.g. email) — low severity, but flagging since `JSON.stringify(err.raw)` is an unbounded field controlled by Stripe's error shape rather than an explicit allowlist of fields.
  - `server.js:4996` — Gmail sync logs `conn.email` (the connected Gmail address) on `invalid_grant` disconnect — this is PII (an email address) in logs, low severity but worth noting since the request explicitly asked about donor emails / PII in logs. This is the org's *own staff* Gmail address (not a donor's), which is lower risk but still worth being aware of.
  - No route logs `req.body` wholesale anywhere (`grep` for `console.log(req.body` / `JSON.stringify(req.body)` returned nothing).
  - Stripe webhook handler (`server.js:37-110+`) logs no sensitive payment data — only derived amounts/IDs.
- **Could not exhaustively verify every one of the ~5500 lines of server.js** — this was a targeted grep against sensitive-looking patterns (token/jwt/password/secret/api_key/authorization/stripe/req.body), which should catch the dangerous cases, but a full manual read wasn't performed. If you want a completionist sweep, worth a dedicated pass rather than folding it into this audit.

---

## 7. Secrets hygiene

- **`.env` in `.gitignore`: OK.** Confirmed present in `.gitignore` (`node_modules/`, `.env`, `.env.local`, `*.log`, `client/dist`).
- **`.env` never committed: OK.** `git log --all --full-history -- .env` returns no history — `.env` has never existed in any commit on any branch. `git ls-files | grep -i env` shows only `.env.example` is tracked (contains placeholder values only: `JWT_SECRET=change_me_in_production`, `ANTHROPIC_API_KEY=sk-ant-...`, `CORS_ORIGIN=http://localhost:3000` — no real secrets).
- **Hardcoded secret fallbacks — one known instance, confirmed still present, no new ones found.**
  - `auth.js:7` — `const SIGNING_SECRET = SECRET || "nonprofit_erp_secret_dev";`. `auth.js:3-6` does throw if `JWT_SECRET` is unset **and** `NODE_ENV === "production"`, so this fallback is intentionally dev-only *as long as Railway reliably sets `NODE_ENV=production`*. This is the fallback already flagged in the codebase/CLAUDE.md — confirmed it's still there, not yet fixed. **Residual risk:** if `NODE_ENV` is ever unset on Railway (misconfigured deploy, new service, etc.), the app would silently sign every JWT with the well-known string `"nonprofit_erp_secret_dev"` instead of failing loudly — worth either (a) confirming `NODE_ENV=production` is actually set in Railway, or (b) hardening the check to not depend on `NODE_ENV` at all (e.g. require `JWT_SECRET` unconditionally and only allow the dev fallback when explicitly running `npm run dev`/local).
  - Grepped `server.js`, `db.js`, `client/src` for the `process.env.X || "literal"` pattern broadly — every other match is a **non-secret** default (frontend URLs, backend URLs, CORS origin `"*"`, from-email addresses like `noreply@stewardapp.dev`/`onboarding@resend.dev`, PORT `3001`). None of these leak credentials; they're operational defaults. No second hardcoded secret found.
  - `CORS_ORIGIN` defaulting to `"*"` (server.js:34) isn't a "secret" leak, but is worth flagging again here since it's adjacent to secrets hygiene / attack surface (see Section 2).

---

## Summary table

| # | Area | Status |
|---|------|--------|
| 1 | Sentry — backend init/env/DSN | OK |
| 1 | Sentry — uncaught exception / unhandled rejection capture | **GAP** |
| 1 | Sentry — client init/env/DSN | OK |
| 1 | Sentry — client source maps | **GAP** |
| 1 | Sentry — alerting | CAN'T VERIFY FROM CODE |
| 2 | Rate limiting (all listed routes) | **GAP** (zero coverage) |
| 3 | DB backups / PITR | CAN'T VERIFY FROM CODE |
| 4 | Email unsubscribe mechanism | **GAP** |
| 4 | Bounce/complaint webhook + suppression list | **GAP** |
| 5 | Health endpoint exists | OK |
| 5 | External uptime monitor wired up | **GAP** (or CAN'T VERIFY — dashboard-side) |
| 6 | Logging hygiene | OK (targeted check; no completionist sweep) |
| 7 | `.env` gitignored, never committed | OK |
| 7 | Hardcoded secret fallbacks | OK (one known dev-only fallback, no new ones) |

Ready to triage — biggest go-to-market risks in order: **rate limiting (0 coverage on auth/donation surface)**, **email unsubscribe/suppression (compliance + deliverability)**, **source map upload (debuggability)**, **uncaught exception capture (silent crash blind spot)**.
