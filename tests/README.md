# tests/ — committed scripted verification

These are the repo's scripted verification suites, run against a **local
scratch server + local scratch Postgres — never production**. Both helpers
refuse to run against a non-localhost `BASE` or `DATABASE_URL`.

Rule (CLAUDE.md, CRITICAL WORKING RULES): **scripted verification is committed
with the feature, not discarded after passing.** BUILD-02 and BUILD-03 shipped
with throwaway suites; BUILD-05 then had to improvise capture-and-diff parity
checks because nothing was left to re-run. These files are the debt paid back
(BUILD-06 Phase B) plus the Phase A suite, and the pattern going forward.

## Setup — scratch Postgres 16 with SSL

`db.js` hardcodes `ssl: { rejectUnauthorized: false }`, so the scratch cluster
must serve SSL (self-signed is fine):

```bash
DIR=/tmp/steward-test-pg
initdb -D $DIR/data -U steward --no-locale -E UTF8
openssl req -new -x509 -days 2 -nodes -out $DIR/server.crt -keyout $DIR/server.key -subj "/CN=localhost"
chmod 600 $DIR/server.key && cp $DIR/server.crt $DIR/server.key $DIR/data/
cat >> $DIR/data/postgresql.conf <<'EOF'
port = 5544
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
EOF
pg_ctl -D $DIR/data start
createdb -h localhost -p 5544 -U steward steward_loadtest
```

## Boot the server + seed

```bash
# from the repo root — boots, builds schema (watch for "✅ Database ready")
DATABASE_URL="postgresql://steward@localhost:5544/steward_loadtest" \
  JWT_SECRET=local-test-secret PORT=5601 DISABLE_RATE_LIMIT=1 \
  DISABLE_BACKGROUND_TICKS=1 \
  RESEND_API_KEY=re_dummy_local node server.js

# seed the 25k-donor load-test org (needed by donors-pagination; the other
# suites create their own small fixture orgs but reuse its org_smalltest
# admin as the org-isolation probe)
DATABASE_URL="postgresql://steward@localhost:5544/steward_loadtest" node scripts/seed-loadtest.js
```

Note: `/health` reports `db:true` before `initSchema` finishes — wait for the
"✅ Database ready" log line, not the health endpoint.

## The standard run (BUILD-23)

`bash tests/run-all.sh` (or `npm test`) runs every self-contained suite — the
ones needing only the scratch server + scratch Postgres — and **fails if any
fail**. This is the gate a future build must keep green. It includes
`consistency-e2e.test.js`, the forward guardrail against the gift/webhook
**duplication class**. Boot the server with a known webhook secret first so the
online-gift path is drivable:

```bash
DATABASE_URL="postgresql://steward@localhost:5544/steward_loadtest" \
  JWT_SECRET=local-test-secret PORT=5601 DISABLE_RATE_LIMIT=1 \
  DISABLE_BACKGROUND_TICKS=1 \
  RESEND_API_KEY=re_dummy_local RESEND_BASE_URL=http://localhost:5602 \
  DEMO_SMTP_FROM=noreply@stewardapp.dev STRIPE_SECRET_KEY=sk_test_dummy \
  STRIPE_WEBHOOK_SECRET=whsec_localtest STRIPE_API_BASE=http://localhost:5603 \
  node server.js
bash tests/run-all.sh
```

`DISABLE_BACKGROUND_TICKS=1` is **the flake fix** (SPEED workstream): it turns
off every periodic background job (digest / dunning / workflow-sweep /
smart-move / sequence / Gmail-sync / trial-expiry / metrics timers) so nothing
fires mid-suite and pollutes the :5602 mail sink or auto-lapses a fixture donor.
Every sweep stays reachable through its ops route (`/workflows/run-sweeps`,
`/pipeline/run-auto-lapse`, `/digests/run`, `/digests/run-daily`,
`/recurring/process-dunning`, `/sequences/process`,
`/admin/notifications/retry`, `/admin/network/run-gate-sweep`), which is what
the suites already drive. The old ritual of "fresh boot, then wait ~90s for the
startup ticks to drain before running" is **retired** — start the battery as
soon as `/health` is ok. Never set this in production.

### Running a subset

`SUITES="tasks greeting" bash tests/run-all.sh` runs only the named suites
(names must be in run-all.sh's CORE list; an unknown name is a hard error that
prints the valid names). Per-suite elapsed seconds and a total are printed.

`tests/affected.sh <git-range>` computes which suites a change actually
touches — it prints `FULL` (shared surface changed: server.js, db.js, routes/,
package-lock, test infra, …), a space-separated suite list (suite-file or
client-only changes), or nothing (docs/audit/scripts/markdown only). The
pre-push hook (.githooks/pre-push) uses it to narrow the local run;
`PREPUSH_FULL=1 git push` forces the full battery. CI always runs everything.

`RESEND_BASE_URL=http://localhost:5602` redirects all outbound email to a local
port so `workflows-e2e` (BUILD-25 Part A) can capture the recipe emails it asserts
on; that suite starts its own capture server there for its run, and every other
suite's send simply fails-and-logs against the unbound port — no real email ever
leaves either way.

Four suites are **not** in the standard run (extra setup — run individually):
`donors-pagination` + `reports` (`node scripts/seed-loadtest.js` first),
`email-footer` (mock Resend on :5602), `export-zip` (`unzip` + loadtest org),
`cover-fees` (real Stripe test creds).

## Run (individual)

```bash
node tests/consistency-e2e.test.js    # BUILD-23: one gift flows SINGLY through
                                       # every surface; webhook/digest/workflow
                                       # idempotency; pipeline; empty/negative
                                       # render; org isolation. THE duplication
                                       # guardrail. Needs STRIPE_WEBHOOK_SECRET.
node tests/donors-pagination.test.js   # BUILD-06 Phase A: pagination/filters/summaries/export parity + perf
node tests/reports.test.js             # BUILD-02 debt: report numbers vs hand-computed fixture
node tests/export-zip.test.js          # BUILD-03 debt: zip contents, edit_token, injection guard, access matrix
node tests/email-footer.test.js        # CAN-SPAM postal address in email footers (real campaign sends
                                       # captured by a mock Resend on :5602 — boot the server with
                                       # RESEND_BASE_URL=http://localhost:5602 DEMO_SMTP_FROM=noreply@stewardapp.dev)
node tests/digests.test.js             # BUILD-17: Week-in-Review + monthly digests — composition, idempotent
                                       # send (reserve-before-send), per-recipient scoping, Core grace, isolation
node tests/reports-cadence.test.js     # BUILD-17: 3-year comparison / annual / solicitations report math,
                                       # [Team] gating, CSV injection guard
```

Each exits 0 on all-pass, 1 otherwise. Env: `BASE` (default
`http://localhost:5601`), `DATABASE_URL` (default the port-5544 scratch DB).
`export-zip` additionally needs the `unzip` binary (present on macOS/Linux).

## Conventions

- Every suite asserts **org isolation** for whatever surface it covers.
- Fixtures are idempotent: they delete + recreate their own `org_test_*` rows
  on every run, so suites can be re-run freely and in any order.
- Perf assertions use generous ceilings (2-10× measured) so they catch
  regressions in kind (an accidental N+1, a lost index), not machine noise.
