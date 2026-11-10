## 0-SCALE-3 · A SECOND WEB REPLICA, AND A BIGGER WORKER, WHEN /ops SAYS SO (2026-11-09)

Do nothing until the Capacity card on /ops (Machine tab) says to. It reads each process's own samples (every five minutes) and the nightly load result. Prerequisite: the worker service from 0-SCALE-1 / 0-JOBS-1 is running (`npm run status` prints `handlers ok`).

**When it says "Add a second web replica"** (web event-loop lag p95 over 100 ms, or request p95 over 800 ms, three days in a row):
1. Railway, project nonprofit-erp, production, service `nonprofit-erp` (web): Variables, add `STEWARD_PROCESS=web` (if not already there) and `WEB_REPLICAS=2`.
2. Same service, Settings, Deploy, **Replicas 2**. Save; Railway redeploys.
3. Check: the Capacity card shows two "Web event-loop lag" lines within ten minutes, one per replica, and `npm run status` is green.
To undo: Replicas 1 and `WEB_REPLICAS=1` (or remove it).

**When it says "Give the worker more room"** (the oldest job waited over 10 minutes three nights in a row):
1. Railway, service `steward-worker`, Settings, Resources: raise the vCPU and memory one step (from the current size to the next one up).
2. Variables: `WORKER_CONCURRENCY=6` (default 4). Leave `JOB_ORG_CAP` at 2.
3. Check after the next night: "Oldest waiting job" on the card is under 10 minutes (600 s).
To undo: the previous size and remove `WORKER_CONCURRENCY`.

Both cost money on Railway's bill; that is why they wait for the card.
