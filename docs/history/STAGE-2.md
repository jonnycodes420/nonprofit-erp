## STAGE-2 · Staging says it's staging, the seed runs anywhere, and drift gets caught (2026-11-11)

Staging went live on 11 Nov after five walls, and every one was a setting that differed between prod and staging (a stray build command, `STEWARD_ENV` / `DATABASE_URL` / `RESEND_API_KEY` / `CORS_ORIGIN` missing, no `DATABASE_PUBLIC_URL`), plus a write guard that needed `curl`. And nothing on screen told Jonathan or Muse which copy they were on.

Choices and why:
- **The strip is plain DOM outside React's root**, so a prerendered marketing page, an error boundary or a redraw can't drop it. It is sticky and in the flow, so it pushes the page down instead of covering it; the app's fixed top bar and rail and the site's sticky header add `--steward-strip-h` (0 on prod). The walk caught the first version covering the app's logo and search, and a phone-width double offset on the mobile header (its sticky is measured from `.app-root`, which is a scroll container on phones), so that one keeps `top: 0`.
- **The `/health` fallback is skipped on the prod frontend hosts**, so prod pages make no extra request.
- **The guard stays synchronous** by running Node's fetch in a child Node (`spawnSync(process.execPath, ["-e", …])`). Its test runs the guard with an empty `PATH` against a fake `/health` in another process, because the guard blocks its own event loop while it waits.
- **Drift reads names, never values.** Railway's `variables(...)` query returns values, so it is never called. `Environment.variables` returns `Variable` nodes that have a name and a service but no value field. `STEWARD_ENV` is read through staging web's public `/health`. The worker's value isn't read (its heartbeat carries no env), only its name.
- **The nightly lives in `drift.yml`**, which ci.yml's `drift` job calls on push. A `schedule` on ci.yml would have run the whole battery every night.
- **Railway config-as-code was decided against**: a file would govern prod's deploys.
