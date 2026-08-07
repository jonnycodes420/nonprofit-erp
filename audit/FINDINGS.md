# BUILD-37 — Adversarial Hardening Audit — FINDINGS

**Date:** 2026-08-06
**Auditor:** automated pass (Claude), against the live code + a local scratch stack (Postgres :5544 `steward_loadtest`, server :5601). No production data or destructive prod paths were touched.
**Baseline:** `bash tests/run-all.sh` → **54 suites green** before this pass; **55 green** after (adds `session-privilege`).

Severity key — **P0** unauth/wrong-tenant read/write/destroy or money movement · **P1** authed in-tenant actor exceeds role, or silent money corruption · **P2** no known exploit, only a coincidence prevents one · **P3** hygiene/logging.

> **Scope honesty (read this).** This is a machine-driven pass. It went **deep** on §1 auth, §2 tenant isolation, §4 money, §6 secrets, §7 injection, §9 deps — the sections where a P0/P1 lives. It went **shallow or by-inspection** on §5 destructive actions (except by-code), §8 availability/alerting, and did **not** execute the full two-org differential sweep of all 283 routes (B2) or the backup restore drill (E6, no prod backup exists — see BLOCKED). It does **not** replace the independent human review in §11. Rows below are marked with how they were verified.

---

## P1 — fix immediately

| ID | Check | Verdict | Evidence | Sev |
|----|-------|---------|----------|-----|
| **A5 / C4** | Stale-JWT privilege retention | **FIXED** | `audit/a5-stale-jwt-evidence.txt` (before), `audit/a5-after-fix.txt` (after), `tests/session-privilege.test.js` | **P1** |

**What it was.** JWTs are stateless, 7-day, and bake `role`/`isSuperAdmin` in at login (`auth.js`, `server.js:1503`). `requireAdmin` and `requireSuperAdmin` read those claims **straight from the token, never re-checking the DB**. Proven live against the scratch server:

- A user demoted from admin (`UPDATE users SET role='staff'`) **still executed an admin action** with their old token — `POST /auth/invite` returned **200** after demotion.
- A user whose row was **deleted** still read org data — `GET /donors` returned **200** with the removed user's token.
- Same class for `is_super_admin`: a revoked super-admin would keep **cross-org** access for up to 7 days.

This is the exact failure §1's preamble names: privilege that survives the event that should end it (revocation, removal, and — for stolen tokens — a password reset).

**Fix (committed, contained).** `requireAdmin` and `requireSuperAdmin` (`server.js:985`, `:997`) now revalidate the caller's live `role` / `is_super_admin` and existence against the DB on each privileged request. A demoted/removed admin is now **403/401 on the next request** (re-proven in `audit/a5-after-fix.txt`). This is deliberately scoped to the **privileged middleware only** — it is NOT added to `requireAuth` (the read hot path), to avoid a per-request DB read across all ~260 authed routes and regressing the 25k-donor latency budget. Regression test: `tests/session-privilege.test.js` (7 assertions; the two marked `(fails pre-fix)` returned 200 before the fix). Full suite re-run green.

**Residual (see `BLOCKED-session-revocation.md`).** A removed *non-admin* user can still hit plain `requireAuth` **read** routes, and a password change/reset does not kill other live sessions. Closing those needs revocation at the `requireAuth` layer (a session-epoch/token-version check = one DB read per request) — an architectural decision left for a deliberate call, not an unattended hot-path change.

---

## P2 — no known exploit, but only a coincidence prevents one

| ID | Check | Verdict | Evidence | Sev |
|----|-------|---------|----------|-----|
| **B4 / B5** | DB-level RLS on tenant tables | **FAIL (documented)** | `grep -ci 'row level security' db.js` → **0**; connection is a privileged direct `pg.Pool` on `DATABASE_URL` (`db.js:6`) | **P2** |
| **A5 (residual)** | Removed staff / password-reset don't kill sessions | **BLOCKED** | `audit/a5-after-fix.txt` (removed user `GET /donors` → 200); `BLOCKED-session-revocation.md` | **P2** |
| **G7** | Security headers (CSP, nosniff, HSTS, Referrer-Policy, X-Frame-Options) | **FAIL** | no `helmet`/no header middleware in `server.js` (only `Content-Type`/`Disposition` on downloads) | **P2** |
| **D11** | Card-testing abuse on public donate | **PARTIAL** | `donateLimiter` = 15 / 15 min **per-IP only** (`server.js:187`); card entry is on **Stripe-hosted Checkout**, not Steward's origin | **P2** |
| **I1** | `ip-address` SSRF-misclassification (transitive via `express-rate-limit`) | **OPEN** | `npm audit`; non-breaking `npm audit fix` available | **P2** |

- **B4/B5 — isolation is 100% app-layer.** Every tenant query is `WHERE org_id = ?` over a **direct, privileged Postgres connection** (`DATABASE_URL`, `ssl.rejectUnauthorized:false`). There are **no RLS policies** on any table, and the connection would bypass them anyway. The good news (see B1/B2 below): the app-layer checks are **systematically present** — 0 authed `:id` routes were found lacking an org-scope reference. So there is no *known* exploit path; the only thing standing between a bug and cross-tenant leakage is that every hand-written query remembered `org_id`. That is the textbook P2. Recommendation: adopt RLS as defense-in-depth (or, cheaper, a lint/CI check that fails any donor/gift/etc. query without an `org_id` predicate).
- **G7 — the API sends no security headers.** JSON API so XSS relevance is limited, but `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and HSTS are free wins. Not added unattended because a blanket header middleware can interact with CORS/preflight and the frontend (Vercel) — do it with a browser in the loop. Recommendation: `helmet()` on the API + verify the frontend's `vercel.json` sets CSP/HSTS.
- **D11 — meaningfully mitigated, not absent.** There *is* a per-IP limiter, and critically the donor never enters a card on Steward's own page — `/donate` creates a **Stripe-hosted Checkout Session** and redirects, so Stripe (not Steward) is the card-validation surface, with Stripe Radar in front of it. That downgrades this from the spec's "no protection = P0" to P2. Gaps that remain: no per-card-fingerprint or per-page velocity limit, no CAPTCHA/friction after N failures. Recommendation: add a per-page counter + optional Turnstile before onboarding a high-traffic public page.
- **I1 — `ip-address`.** Used by `express-rate-limit` for IP parsing; the advisory allows an IPv4-mapped IPv6 to be misclassified, which could let a crafted client confuse per-IP rate-limit keying (limit evasion). The app has no user-URL SSRF (see G5), so the SSRF angle doesn't apply here. `npm audit fix` (non-breaking) resolves it.

---

## P3 — hygiene / defense-in-depth

| ID | Check | Verdict | Evidence | Sev |
|----|-------|---------|----------|-----|
| **G1 / G3** | HTML-escaping of donor free-text in emails | **PARTIAL** | `server.js:3883,7234,7902` replace `{{donor_name}}`/`{{first_name}}` **unescaped** into HTML bodies; `:4012,:10615,:12471` (receipt/digest/workflow) **do** escape | **P3** |
| **B10** | Super-admin actions written to an audit log | **FAIL** | no `admin_audit`/actor-log write on `/admin/orgs/:id/extend-trial`, `/change-plan`, `DELETE /admin/orgs/:id`, `/admin/data-integrity/fix` | **P3** |
| **I1** | `nodemailer` (3 HIGH advisories) | **N/A-unused** | direct dep in `package.json`, **not imported anywhere** (`grep require nodemailer` → none); app sends via Resend HTTP | **P3** |
| **I2** | CI installs with `npm ci`; audit gate | **FAIL** | no `.github/workflows`; lockfile *is* committed | **P3** |
| **E5** | CSV formula-injection neutralization | **PARTIAL** | `reportCsvCell` (`server.js:10407`) guards leading `= + - @` but **not** leading TAB (`\t`) / CR (`\r`) | **P3** |
| **F2** | 500 responses leak internals | **PARTIAL** | global handler is safe (`{error:"Internal server error"}`), but `server.js:14210,14226,14252,14259,9554,11513` return raw `err.message` | **P3** |
| **DB TLS** | DB connection verifies cert | **FAIL** | `db.js:8` `ssl:{ rejectUnauthorized:false }` (no cert verification → MITM window on the DB link) | **P3** |

- **G1/G3 — real but low-impact.** The unescaped token paths (dunning, campaign, milestone) render a donor's *own* name into an email sent to *that donor* — self-XSS at most, and mail clients strip JS. The staff-facing/internal surfaces (digests, receipts, workflow alerts) already escape. No cross-user stored XSS was found; in-app surfaces render through React (auto-escaped). Clean class fix available (route those three `.replace` sites through the existing `escapeHtml`), plus a grep-guard test. Deferred as P3, not fixed this pass.
- **B10 — no super-admin audit trail.** The most powerful, cross-org actions leave no actor/target/timestamp record. `fin_audit_log` exists but is org-scoped financial history, not an admin-action log. Recommendation: one `admin_audit` insert in each `/admin/*` mutating route.
- **nodemailer** — dead weight carrying 3 HIGH advisories with **no exploit path** (unused). Recommend `npm uninstall nodemailer` (removes the finding outright; non-breaking).

---

## PASS — verified, no change needed

| ID | Check | How verified |
|----|-------|--------------|
| **F1** | No secrets in the built client bundle | grep over `client/dist` for `sk_/rk_/service_role/RESEND_API/JWT/PRIVATE KEY` → **0 hits** |
| **D1** | Stripe webhook signature verified | `stripe.webhooks.constructEvent` on `/stripe/webhook` (`:202`) and billing (`:858`) |
| **D2** | Webhook replay idempotent | partial-unique `uq_gifts_stripe_pi` + `INSERT … ON CONFLICT DO NOTHING`; proven under parallel redelivery by `tests/concurrency.test.js` (23 green) |
| **D4** | Amount priced authoritatively | gift recorded from Stripe `amount_received`; cover-fee gross-up is server-derived (`coverFeesGrossUpCents`, `:8861`), client math never trusted |
| **A1** | Reset token single-use + expiry | single-use (`used=false` check + `SET used=true`), 1-hour expiry, **and** bulk-invalidate of all the user's outstanding tokens on use (`server.js:1624,1635`) |
| **A4** | Login rate-limited by IP and account | `loginIpLimiter` 20/15m + `loginAccountLimiter` 6/15m keyed IP+email (`:151,:160`) |
| **A7** | Invite token email-bound, single-use, role-fixed | account created with the *invited* email, not user-supplied; `accepted_at`/`expires_at` gate; role taken from the invite, not the accepter (`:2371`) |
| **A3** | Reset for non-existent email | `forgot-password` sends nothing but returns the same shape (`:1540`) — no enumeration by response body |
| **B1 / B2** | Every authed `:id` route org-scopes | automated: **0 of 114** authed param-routes lack an `orgId`/`org_id`/`orgOwns` reference in the handler body (`/tmp/scope.py`); `tests/tenant-isolation.test.js` 30 green |
| **G4** | SQL injection | `?`-parameterized throughout; `ORDER BY` is a whitelist (`DONOR_SORTS`, `:2385`) |
| **G5** | SSRF | only outbound fetch is a hardcoded OpenAI Whisper URL (`:12049`); no user-supplied-URL fetch anywhere |
| **G2** | `dangerouslySetInnerHTML` | one instance (`Communications.jsx:1071`) rendering the author's *own* draft in their own browser — self-preview, not a cross-user sink |
| **E5** | CSV injection guard exists | `reportCsvCell` present on every export path (partial — see P3) |
| **I2** | Lockfile committed | `package-lock.json` tracked |

---

## N/A / out of scope (stated, not silently skipped)

- **A6 cookie flags** — N/A: auth is a JWT in `localStorage`, not a cookie. Tradeoff (token readable by any XSS) noted in `audit/data-handling.md`.
- **A9 OAuth** — Gmail OAuth callback (`/gmail/callback`) present; state/redirect allowlist not deeply audited this pass.
- **A10 MFA** — not available for any role. `BLOCKED-mfa.md`.
- **E6 backup restore drill** — no production backup exists to restore (CLAUDE.md itself: "Supabase backups still don't exist"). `BLOCKED-backup-restore-drill.md`.
- **§11** — independent human app-sec review, production pentest, SOC 2 / PCI attestation, and load testing beyond §8 are explicitly **not** covered here.

---

## Verdict — what I would still be nervous about with real donor data tomorrow

The **tenant isolation is better than most SaaS at this stage** — the app-layer `org_id` discipline is genuinely systematic (0 unscoped `:id` routes, which is rare), the webhook money paths are signature-verified and idempotent under real concurrency, secrets aren't in the bundle, and SQL is parameterized. The one clearly-exploitable issue found — stale-JWT privilege — is now fixed and guarded.

What still keeps me up:

1. **There is no floor under the app-layer isolation.** No RLS, a privileged DB connection, and no CI lint that fails an un-scoped query. Isolation holds today because every query author remembered `org_id`; the day someone writes `SELECT … WHERE id = $1` without it on a new route, nothing catches it — not the DB, not CI, not a test (the differential sweep is by-inspection, not exhaustive). This is the single most likely place a future P0 is born.
2. **The removed-employee window is still 7 days on read routes.** A fired staffer keeps reading donor PII until their token expires. The admin/super-admin paths are now closed; the read path is not.
3. **No super-admin audit trail.** If a super-admin account is ever compromised, there is no record of what it touched across which orgs.
4. **No security review by a second party.** The same intelligence wrote and audited this. The §11 human engagement is not optional — this pass exists to make it cheap, not to replace it. Prioritize auth + tenant isolation + the RLS gap for that reviewer.
5. **Not everything was hit.** The full 283-route two-org differential sweep, the availability/alerting section, and destructive-action drills were sampled or inspected, not exhaustively exercised. Absence of a finding in those rows means "not disproven," not "proven safe."
