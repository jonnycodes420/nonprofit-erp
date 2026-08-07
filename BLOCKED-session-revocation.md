# RESOLVED — session revocation (was: BUILD-37 §A5 residual → closed by BUILD-38)

This is no longer blocked. BUILD-38 Part 1 implemented full session revocation.

**What shipped (the design the follow-up build decided, not the epoch-counter
sketch this file originally proposed):**
- `users.sessions_valid_after TIMESTAMPTZ NOT NULL DEFAULT now()` (db.js migration).
- `requireAuth` (auth.js) rejects a token whose `iat` predates the user's
  `sessions_valid_after` (1s skew), and rejects when the user row is gone —
  **no missing row is ever treated as pass-through.**
- A 30s-TTL, 10k-entry LRU cache (`sessionCache.js`) keeps this off the
  per-request DB path; worst-case revocation lag is the TTL, not the 7-day token
  lifetime. Per-process (multi-instance safe; instances expire independently).
- `invalidateUserSessions(userId)` (server.js) bumps the timestamp and evicts the
  local cache entry; called on password reset. **A future role-change / removal /
  deactivation route MUST call it** (there are none today — roles are set at
  invite/register, and the deleted-user case is covered by the missing-row → 401
  check regardless of how the row was removed).
- `requireAdmin` / `requireSuperAdmin` keep BUILD-37's UNcached live revalidation
  (small route set, correctness over latency).

**Residual (accepted, documented):** up to a 30-second window (the cache TTL) in
a multi-instance deploy; near-instant on the instance handling the change. In
prod, ids are uuids and deletions permanent, so there is no stale-after-recreate
concern. The scripted suites boot with `SESSION_CACHE_TTL_MS=0` for determinism.

**Guards:** `tests/session-cache.test.js` (14 — query-spy/TTL/LRU/evict, in-process)
and `tests/session-privilege.test.js` (18 — deleted→401, removed→401, password
reset kills two concurrent sessions, role overlay reflects the live row). Every
BUILD-38 assertion fails against pre-fix code. Full suite: 56 green.

See `audit/FINDINGS.md` (A5 rows now FIXED) and `audit/post-deploy-smoke.md`.
