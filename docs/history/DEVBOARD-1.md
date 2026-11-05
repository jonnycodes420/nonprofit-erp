# DEVBOARD-1 · one page that shows the whole machine

**Why.** The loop (Muse's 5 AM walk, briefs, three Claude Code tabs, CI, Railway and Vercel, customer email) had no view but Jonathan asking each tab. /ops is that view, for super-admins only.

**The board** is `ops/board.json`, a file in the repo, not a table: it is versioned with the code that fixes it, and the build that closes an item changes the board in its own PR, so the merge is what makes it fixed. States: open → fixed (merged) → verified (passed the next walk), or reopened. Walk items are keyed by check (`Prof4`), so the next day's verdict finds yesterday's item whatever its date prefix. `scripts/ops/board-import-walk.js` and `scripts/ops/board.js` are the only writers; both are dry runs by default. The logic is `server/admin/board.js`, shared by the scripts and the page.

**The page** reads one answer, `GET /ops`. Prod health comes from this process's own `/health` object (`healthBody()` in server.js, the same object `/health` sends) put through `scripts/ci/status.js`'s own report functions, so the page and `npm run status` cannot disagree. Everything outside the process (GitHub PRs and CI, the nightly load run, the frontend's build-sha, live customers) is collected by the worker every five minutes (`opsBoardRefresh`) into one row of `ops_snapshots`. Each source is collected on its own and carries its own ok/error, so one that is down says so and the rest loads. The table is created by `opsSources.js` itself because db.js is at its size limit.

**The door** answers 404, not 401 or 403, to anyone who is not a live super-admin (requireAuth404, no support session, `is_super_admin` re-read from the users row). The tenant matrix therefore sees /ops as a public route and probes it signed out (404, no 500).

**What it reads as live customers** is orgKind.js's one rule (Kind is Customer, not archived), with the last sign-in from `user_sessions`.

**Builds** leaves out bot PRs (counted) and calls a PR with no push or CI for a week parked, not quiet: the first walk listed fifteen dependency bumps as "quiet 33 days".
