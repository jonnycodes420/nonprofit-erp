## 0-JOBS-1 · THE WORKER, A SERVICE OF ITS OWN (2026-11-02)

The same steps as 0-SCALE-1, with a start command of its own. Nothing stops if you never do them: until then the web service keeps running every job and handler itself. If you already did SCALE-1's steps with `STEWARD_PROCESS`, they still work and you need do nothing here.

1. Railway, project nonprofit-erp, production: New → **Empty Service**, name it `steward-worker`, no domain.
2. `steward-worker` → Variables: add all of `nonprofit-erp`'s variables (Shared variables, or "Add all from nonprofit-erp"). Do not add `WORKER`.
3. `steward-worker` → Settings → Deploy: **Custom start command** `node worker.js`, healthcheck path `/health`, replicas 1. Source: the same repo, auto-deploy off (CI deploys it).
4. GitHub → repo Settings → Secrets and variables → Actions → Variables: `RAILWAY_WORKER_SERVICE` = `steward-worker`.
5. Push or re-run CI on main. Railway logs for the worker show `[jobs] worker: 4 lanes, 2 per org`.
6. Only after step 5 is green: `nonprofit-erp` (web) → Variables → add `WORKER=off`. Its next deploy runs no jobs.
7. Check: `npm run status` prints `handlers ok` and prod `/health` shows `queue.role: "web"` and `queue.waiting` near 0.

To undo: remove `WORKER=off` from the web service; it runs the jobs again on its next deploy.
