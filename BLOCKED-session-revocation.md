# BLOCKED — full session revocation at the `requireAuth` layer (BUILD-37 §A5 residual)

## What's already fixed (this pass)

`requireAdmin` and `requireSuperAdmin` now revalidate the caller's live `role` / `is_super_admin` / existence against the DB (`server.js:985`, `:997`). So **role revocation, super-admin revocation, and account removal take effect on the next privileged request** — proven in `audit/a5-after-fix.txt`, guarded by `tests/session-privilege.test.js`.

## What's still open

Plain `requireAuth` **read** routes (e.g. `GET /donors`, `GET /me`'s data) trust the JWT alone. Proven this pass: a **deleted non-admin user still read org data** (`GET /donors` → 200 with the removed user's token). Also: a **password change/reset does not invalidate other live sessions** — a stolen token survives the reset the victim just did (the exact scenario §1's preamble calls the most common real breach).

## Why it's blocked (a genuine architectural decision, not a quick fix)

Closing this means revalidating on **every authenticated request**, not just admin ones. Any correct design adds server-side state to a currently-stateless auth path:

- **Option A — session epoch / token version.** Add `users.session_epoch INT DEFAULT 0`, embed it in the JWT at sign time, and in `requireAuth` read the live epoch and reject on mismatch. Bump the epoch on password change/reset, role change, and removal. Cost: **one indexed DB read per authenticated request** (~all 260 routes).
- **Option B — short access tokens + refresh tokens.** 15-min access JWT + a revocable refresh token in the DB. Bigger client change.
- **Option C — a revocation/denylist** checked per request (Redis or a table). New infra.

The blocker is **Option A's per-request DB read on the hot path.** This app deliberately kept auth zero-DB, and the 25k-donor load test (LOADTEST_REPORT.md) tuned per-request cost carefully. Adding a lookup to `requireAuth` is defensible (every real route already hits Postgres, so the marginal cost is small and indexed), **but it changes the performance profile of the entire API and touches the single most-used code path** — exactly the kind of change the BUILD-37 rules say to escalate rather than land unattended.

## Recommendation

Implement **Option A**, in a supervised session with the load test re-run:
1. `ALTER TABLE users ADD COLUMN session_epoch INT NOT NULL DEFAULT 0;`
2. `signToken` includes `se: user.session_epoch`.
3. `requireAuth`: after `jwt.verify`, `SELECT session_epoch, role, is_super_admin FROM users WHERE id=$1`; reject if the row is gone or `se` ≠ token's. (This also lets `requireAdmin`/`requireSuperAdmin` drop their now-redundant extra lookup and read from `req.user` refreshed here.)
4. Bump `session_epoch` in: `/auth/reset-password`, any password-change route, role-change (`/auth/invite` promotions, admin role edits), and account removal.
5. Re-run `scripts/loadtest.js` at 25k donors; confirm per-request latency budget holds.

**Estimate:** ~0.5–1 day incl. the load-test re-run and a `session-privilege.test.js` extension covering the removed-staff and password-reset cases.
