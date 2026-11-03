## 0-DEPLOY-1 · Railway settings, then the stuck queue (2026-11-03)

Nothing breaks if these wait, but the error window stays until step 1 and 2 are done.

1. `nonprofit-erp` (web) → Settings → Deploy → **Healthcheck Path** `/ready`, timeout 600. docs/decisions/tests-and-ci.md records it was set to `/ready` on 3 Oct; check it still reads `/ready` (not `/health`). `/ready` now waits for every boot step, not just the database.
2. Both `nonprofit-erp` and `steward-worker` → Variables → `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` = `30`. Railway's default is 0: the old container is killed at once, so the new SIGTERM handling (finish requests, hand back jobs, up to 25 s) never gets to run.
3. `steward-worker` → Settings → Deploy → Healthcheck Path `/ready` (it was `/health` in JOBS-1's steps).
4. After DEPLOY-1 is deployed: `psql "$DATABASE_URL" -f scripts/sql/queue-status.sql` (read-only). The worker gives back the stuck rows by itself within a minute of its boot; this shows what is left.
5. `DATABASE_URL=… node scripts/ops/queue-requeue.js` (dry run, writes nothing), read the list, then `DATABASE_URL=… node scripts/ops/queue-requeue.js --apply --i-know-this-is-prod`. `--org=<id>` tries one org first.
6. `npm run status`: the `queue` line should read ok and the `worker` line ok (main's build, role worker).
