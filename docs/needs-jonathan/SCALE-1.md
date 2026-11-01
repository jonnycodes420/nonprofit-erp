## 0-SCALE-1 · A WORKER SERVICE, THEN A SECOND WEB REPLICA (2026-10-13)

Nothing breaks if you never do this: with `STEWARD_PROCESS` unset the one service serves the app AND runs every background job, exactly as before. Do the steps in order; each is safe on its own.

1. **Railway, project nonprofit-erp, production:** New, **Empty Service**, name it `steward-worker`. Do NOT give it a domain.
2. On `steward-worker`, Variables: **Shared variables, add all** of the web service's variables (Railway's "Add all from nonprofit-erp" / reference each), then add `STEWARD_PROCESS=worker`. Optional: `WORKER_CONCURRENCY=4` (default 4) and `JOB_ORG_CAP=2` (default 2).
3. On `steward-worker`, Settings, Deploy: **Custom start command** `node server.js` (the same as web; the variable decides the role). Healthcheck path `/health`. Replicas **1**.
4. **GitHub, repo settings, Secrets and variables, Actions, Variables:** add `RAILWAY_WORKER_SERVICE` = `steward-worker`. From the next push CI deploys the worker with the same build (the step is skipped until then).
5. Push or re-run CI on main so the worker gets its first build. Check `https://<worker>/health` is not public (no domain) and in Railway logs the worker prints `[jobs] worker: 4 lanes, 2 per org`.
6. **Only after step 5 is green:** on `nonprofit-erp` (web), Variables, add `STEWARD_PROCESS=web` and `WEB_REPLICAS=2`; Settings, Deploy, **Replicas 2**. The web then runs no jobs, and each replica keeps half of the two general rate ceilings (the sign-in, form and API limits are shared in Postgres and need nothing).
7. Check: prod `/health` shows `queue.waiting` near 0 and `queue.oldestWaitingSeconds` under 60, and `tick.lastRunSeconds` set within ten minutes. Admin console, Overview, "Background jobs" lists any job that stopped.

To undo: remove `STEWARD_PROCESS` from the web service and set its replicas to 1; the web runs the jobs again on its next deploy. The worker can then be deleted.
