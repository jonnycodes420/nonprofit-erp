# BUILD-37 — Privileged / RLS-bypassing credential paths (§B5)

## The one privileged credential: the direct Postgres connection

Steward does **not** talk to the database through the Supabase client with an anon key + RLS. It opens a **single direct `pg.Pool`** (`db.js:6`) using `DATABASE_URL`:

```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
```

Every query in the app (`query`, `run`, `withTransaction`, `withAdvisoryLock`, `queryTx`, `runTx` — all from `db.js`) runs through this one pool. Consequences:

- The connection role is whatever `DATABASE_URL` points at — the Supabase Postgres owner/service connection. It is **RLS-bypassing by construction** (and there are no RLS policies anyway — `grep -ci 'row level security' db.js` → 0).
- **There is therefore no second, lower-privilege credential.** Isolation is not enforced by the credential; it is enforced entirely by the app appending `WHERE org_id = ?` to every query.

### Justification / risk

This is a deliberate architecture (direct pg for performance + full SQL control), not an accident. It is **acceptable only because** the app-layer scoping is systematic — verified this pass: **0 of 114 authed `:id` routes** lack an `org_id`/`orgOwns` reference in their handler (`/tmp/scope.py`), and `tests/tenant-isolation.test.js` (30 assertions) exercises cross-org access on the core objects.

**But every privileged query is one forgotten `org_id` away from a cross-tenant leak, with nothing underneath to catch it.** See FINDINGS **B4/B5** (P2). Recommended floors, cheapest first:
1. A CI/lint check that fails any query against a tenant table (`donors`, `gifts`, `interactions`, `fin_transactions`, …) that has no `org_id` predicate.
2. RLS policies (`ENABLE ROW LEVEL SECURITY` + per-table `org_id = current_setting('app.org_id')`), with the app setting `app.org_id` per request — genuine defense-in-depth, larger change.
3. At minimum, verify DB cert (`rejectUnauthorized: true` with the Supabase CA) — today TLS is unverified (FINDINGS DB-TLS, P3).

## Other elevated code paths (run without a per-request user, so they carry their own scoping)

| Path | Runs as | Scoping |
|------|---------|---------|
| Stripe `/stripe/webhook`, `/billing/webhook` | server-to-server, no user | org resolved from **verified** `event.account` / customer mapping, not payload; signature-checked first |
| `/resend/webhook` | server-to-server | resolves suppression by email |
| Background jobs — `syncAllGmail`, `processSequences`, `processDunning`, `processDigests`, `processWorkflowSweeps`, `processSmartMoves`, `checkTrialExpiry` | scheduler tick, no user | each iterates orgs and scopes its queries per-org; workflow sweeps additionally guarded against firing on imports (BUILD-25) |
| `signToken` fallback secret | `auth.js` | falls back to a hardcoded dev secret **only** when `JWT_SECRET` unset and `NODE_ENV !== production`; production throws if unset — OK |

No background job was found operating on a user-supplied ID without an org check in the sampled review, but the full job set was **not** exhaustively traced (§B6 — sampled, not proven).
