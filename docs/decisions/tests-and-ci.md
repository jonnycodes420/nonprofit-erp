# Tests, CI and deploys

Read this when you touch a test, a guard, the battery, the pre-push hook, CI, a deploy, or the local scratch stack.

## Rules
- **Boot the scratch server from the recipe in the header of `tests/run-all.sh`, not the one in
  `tests/README.md`.** The README's recipe lacks `TEST_MODE`, `SESSION_CACHE_TTL_MS=0` and the
  two network flags, and without those flags thirteen suites red-light on a 404. (BUILD-87)
- **A new suite goes into `CORE` in `run-all.sh`, and into `CLIENT_SUITES` in `tests/affected.sh`
  if it reads client source.** A suite outside `CORE` never runs in CI or on push. (BUILD-86)
- **Read CI after every push to main** (`gh run list --branch main --limit 3`). The pre-push
  hook runs lint plus affected suites only, and a red `test` job skips both deploy jobs, so a
  pushed commit is not a deployed one. (BUILD-88c, BUILD-91)
- **CI runs on `main` only.** A push to a build branch is gated by nothing, so run the battery
  locally and say that CI gates at the merge. (BUILD-99)
- **Verify a deploy by what is actually live, never by the config that claims to gate it.**
  `node scripts/status.js` compares HEAD, origin, the backend's `buildSha` and the frontend's
  `build-sha` meta. The `deploy-vercel` CLI job ignores `vercel.json`'s `deploymentEnabled`. (BUILD-92)
- **Verify the frontend by CONTENT, not HTTP status.** The SPA rewrite answers a missing asset
  with 200 and `index.html`. Fetch prod's `main-*.js` and grep for a string your change added.
  (BUILD-91)
- **A new route means re-running `scripts/build75-route-inventory.js` in the same commit.** It
  needs `DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY` and `STRIPE_SECRET_KEY` to boot, and
  `tenant-matrix` fails if `audit/route-inventory.json` differs from the live router. (BUILD-84)
- **A new parameterized route needs a tenant probe (a `bResolver` entry) or a reasoned
  `PARAM_EXEMPT` entry** in `tests/tenant-matrix.test.js`. (BUILD-86, BUILD-100)
- **Add every new table to tenant-matrix's reset list, children before parents.** This includes
  children whose FK is nullable. Otherwise one crashed run leaves the suite unable to re-run.
  (BUILD-87, BUILD-100)
- **Classify every new `scripts/*.js` in `tests/script-guards.test.js`.** A script that writes
  resolves its target through `scripts/lib/prodGuard.js` (`writerBase`/`writerDbUrl`). (BUILD-84)
- **State-diff manifests are the money-flow spec.** Review an edit to one like a schema
  migration, and never loosen one to get a build green. Use `DISCOVER=1` only to author a
  manifest, and `{d:0}` means "must not move". (BUILD-43)
- **Every org is born with a chart of accounts.** A fixture that deletes an org clears
  `fin_transactions`, `budgets`, `accounts` and `fin_funds` first. (BUILD-58)
- **Put only recorded real payloads in `tests/fixtures/external/`, each with a `_provenance`
  stamp.** `external-fixture-provenance` rejects a hand-written one. A mock proves arithmetic,
  never a boundary. (BUILD-57, BUILD-58)
- **Pin a golden whose comparisons are all its own. Synchronise a suite that asks the server a
  question about now.** A pure fixture pins to its `anchorDate`, and a clock-relative suite
  derives its expectations from `civilToday()`. (BUILD-84)
- **When a test steps the date forward, land on a weekday and derive the expected count from the
  date you chose.** A flat `+1`/`+8` days fails every Friday under the weekend rule. (FIX thread row)
- **The server accepts a pinned `now`/`today` only when `testMode()` is true.** Production ticks
  pass no clock. Do not synchronise an assertion to "whatever the window says right now". (BUILD-94)
- **A real boundary is proven by a `SELF_REFUSING` drill against the real service, and an
  undrilled one is decided or goes in `NEEDS-JONATHAN.md` (never a new `BLOCKED-*.md`).** Examples are `scripts/build58-stripe-drill.js`
  and `scripts/build95-cheque-drill.js`. (BUILD-57, BUILD-58, BUILD-95)
- **A walk checks the status of every write it makes.** An ignored 409 lets a walk pass against
  its own broken fixtures. It also fails on any console error, not only on a `pageerror`. (BUILD-84)
- **Never `JSON.stringify` a payload and then substring-search it.** Walk the payload with
  `leaks()`/`textMatch()` from `tests/helpers.js`, which `build84` §4 enforces repo-wide. (BUILD-84)
- **A guard that greps source for a forbidden string must strip comments first**, or the file that
  explains the rule fails it. (BUILD-89S, BUILD-90)

## Gotchas
- **A browser leg that SKIPs exits 0, and `run-all` counts it as a PASS.** After a battery, run
  `grep -l SKIP $SUITE_LOG_DIR/*.log`. A fresh worktree has no `client/dist`, so all of its browser
  legs skip. (BUILD-88a, BUILD-96)
- **For a browser leg, build dist with `scripts/build-local-dist.sh` and serve it with
  `scripts/local-preview.js` on :4173.** A dist with only `VITE_API_URL` breaks the portal paths.
  `vite preview` has no rewrites, whatever that script's closing echo says. (BUILD-75, BUILD-89S)
- **`npx vite build` skips the brand guard.** `npm run build --prefix client` runs
  brand-allowlist, then `eslint src` (no-undef and rules-of-hooks are errors), then vite. (BUILD-96)
- **Two PIDs on `lsof -ti:4173` mean a stale preview is answering.** Its `/portal-assets` returns
  `index.html`, and the suite times out as if the product broke. Kill it and serve one. (BUILD-89S)
- **Kill a server by port: `kill $(lsof -nP -iTCP:5601 -sTCP:LISTEN -t)`.** `pkill -f "PORT=5601"`
  never matches, so the old server keeps serving stale code. (BUILD-92)
- **Do not touch the shared scratch stack while a battery runs against it, and do not edit
  `run-all.sh` mid-run.** A red run made during edits or reboots tells you nothing, so re-run it
  clean before reading any failure. (BUILD-94, BUILD-95)
- **The shared `steward_loadtest` gives false reds.** Settle a disputed failure on a clean
  database (`dropdb`/`createdb`, then reseed). Check `WHERE org_id` before blaming your code for
  another suite's rows. (BUILD-92, BUILD-96)
- **Parallel worktrees need their own port block, database and `SUITE_LOG_DIR`.** Examples are
  5661/4203 and 5671/4213. Avoid 5631, which `drift.test.js` hardcodes. Two sessions in one
  working tree cost a build two reverts. (BUILD-92, BUILD-98, BUILD-99)
- **A suite that spawns a child server must pass `DATABASE_URL` explicitly.** `run-all.sh` does
  not export it, so the child falls back to :5432. On a non-default port, also match `SINK_PORT`,
  `STRIPE_MOCK_PORT` and `BILLING_MOCK_PORT`. (BUILD-92, BUILD-98)
- **The server caches a `shared/` module it loads with `import()` until it reboots.** Restart the
  server before a prove-able-to-fail run, or the planted defect comes back green. (BUILD-100)
- **Requiring `assetStore.js` inside a test opens a second pg pool with no SSL.** Drive the real
  route instead. (BUILD-100)
- **An assertion behind `|| true`, or after a fixture insert that is `.catch(() => {})`, proves
  nothing.** Reuse fixture orgs with `ON CONFLICT DO UPDATE` rather than a swallowed delete.
  (BUILD-94, BUILD-96)
- **A raw-byte search of a pdfkit PDF finds nothing because the streams are Flate-compressed.**
  Inflate them first. (BUILD-99)
- **A suite that counts `notification_sends` needs a live sink.** Use `startMailSink()` from
  `tests/state-diff.lib.js`, or the sends fail, get queued, and the counts drift. (BUILD-45)
- **Browser-assertion traps:** read the panel the action opened, not the screen behind it.
  `innerText` applies `text-transform`. A synthetic `.click()` misses an `onMouseDown` handler.
  `(hover:none)` needs Playwright's `hasTouch`/`isMobile`. (BUILD-87, BUILD-95)
- **Agent worktrees live under `.claude/worktrees/`, inside the repo.** A guard that walks the
  repo must skip `.claude` or scope itself with `git ls-files`. A worktree's `node_modules`
  symlink is not ignored, so do not `git add -A` it. (BUILD-87)
- **A browser-legged suite that pins :4173 may be driving another checkout's preview.** Read
  `APP_URL` and never hardcode the port. (BUILD-92)

## Where the code is
- `tests/run-all.sh` — the battery: `CORE` list, `SUITES=` subset, exit-code gate, `$SUITE_LOG_DIR`
- `tests/affected.sh` — git range to `FULL`, a suite list, or nothing; used by the pre-push hook
- `.githooks/pre-push` — lint plus affected suites; `PREPUSH_FULL=1` forces the full battery
- `.github/workflows/ci.yml` — `test`, then `deploy-railway` and `deploy-vercel` (`needs: [test]`)
- `tests/README.md` — scratch Postgres, browser-leg env, the flake fix, the subset run
- `tests/helpers.js` — `ok`/`summary`/`login`/`api`/`q`, `leaks()`/`textMatch()`, the localhost guard
- `tests/state-diff.lib.js` — `snapshotOrgState`, `startMailSink`, the manifest asserter
- `tests/tenant-matrix.test.js` + `scripts/lib/routeInventory.js` — the generated isolation battery
- `tests/permissions-matrix.test.js`, `tests/first-login-matrix.test.js` — role and tier data tables
- `tests/deploy-shape.test.js` — every server import resolves inside the Railway artifact
- `tests/script-guards.test.js` + `scripts/lib/prodGuard.js` — script classification and prod guard
- `scripts/status.js` — the post-deploy drift check across HEAD, origin, backend and frontend
- `scripts/build-local-dist.sh`, `scripts/local-preview.js` — local dist and the vercel.json mirror
- `scripts/consistency-audit.js` — the read-only reconciliation against prod, run before a pilot

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## THE TDZ RULE (standing, from BUILD-96 — this class has now cost four builds)

**A module-scope or component-scope `const` must be DECLARED ABOVE EVERY LINE
THAT READS IT. No exceptions, and "it works" is not evidence.**

BUILD-84 (`stageBasis` between `payload` and `stagePreview`), BUILD-89
(`onPanel` below `sHdrPad`, which read it), BUILD-95 (a third time), and
BUILD-96 again — a blanket replace produced `const INK = INK;` in
`TermsPage.jsx`, caught within the minute only because the page was rebuilt.

**Why it keeps costing a whole build each time:** `const` and `let` hoist
without initialising, so reading one early throws `ReferenceError: Cannot access
'x' before initialization` AT RUNTIME, not at parse. Every unit test passes,
`node --check` passes, eslint's default config passes, and the failure surfaces
as a whole screen replaced by its error boundary — or, worse, as a *plausible
domain message* when a `catch` around the render swallows it ("No rows ready —
map at least one column"). Only a browser can tell you, which is why
`rethrowProgrammerError` exists (BUILD-84 FIX) and why the browser legs of the
battery are not optional.

**The grep that catches it** — every `const`/`let`/`class` read above its own
declaration in a file:

`scripts/tdz-scan.js` — run it on a file, a directory, or with no argument for
all of `client/src` and `shared/`:

```bash
node scripts/tdz-scan.js client/src/pages/TermsPage.jsx
node scripts/tdz-scan.js                 # everything
```

It reports two shapes, and only one of them is in the default output:

- **`SELF-REFERENCE`** — `const INK = INK;`, where the read is on the *same*
  line as the declaration, so no line-number comparison can see it. This is the
  form that bit BUILD-96. **Exit code 1, zero false positives on this
  codebase**, and it needs no judgement at all. Getting there took four rounds:
  strip comments/strings/regex literals (`const s = String(v).replace(/\s+/g,"")`
  was read as `s` referencing itself, from inside `\s+`), exclude property
  accesses and object keys (`const blob = await r.blob()`), cut the initialiser
  at the statement boundary (`const in90 = new Date(t); in90.setDate(...)` is
  fine), and exclude a shadowing arrow parameter (`const g = xs.map(g => g.id)`).
- **`reads-above`** — a line above the declaration mentions the name. **Behind
  `--all`**, because it reports ~209 candidates on this codebase and the large
  majority are function parameters that merely share a spelling with a binding
  declared later. It cannot be made exact without real scope analysis. Reach for
  it when you are hunting a blank screen, not as a routine check.

**A scanner nobody runs twice is worth nothing**, which is why the noisy half is
opt-in rather than shipped in the default output.

**Reading the output honestly:** a self-reference is always a bug. Otherwise a
hit is only a BUG when the reading line runs
at module/component evaluation time. A reference inside a function body that is
merely *defined* earlier and *called* later is legal — `Nav()` referencing `INK`
is fine. So triage each hit by asking **"does this line execute before the
declaration does?"**, and when the answer is "only because of call order", move
the declaration up anyway: relying on call order is how the next one of these
gets written.

**And the cheap structural habit that prevents all of it:** in a module, put
every `const` that other top-level code reads — palettes, tables, registries,
caps — in ONE block directly under the imports, above the first function.

## THE SPEED RULE (BUILD-87 — standing, applies to every build from here on)
The verification discipline is not negotiable; the CEREMONY around it is. Five ways to stop paying for ceremony that caught nothing:

1. **Part 0 findings are a DOCUMENT only for an area not touched in the last three builds.** Otherwise the census is **five lines at the top of the first commit**. A findings file re-deriving what the previous build already established is archaeology, not verification.
2. **A test family is the SMALLEST set that catches the regression** — not every combination that could be enumerated. The question is "what would have to break for this to fail", answered once, honestly; a suite that cannot fail is ceremony with a pass count.
3. **Screenshots only when a walkthrough FOUND a defect.** A green walk needs its assertions committed, not its pictures. (The walks that earned their images — BUILD-84's import, BUILD-86's `day 0` and the Board-management collision — all found something.)
4. **Independent parts run in PARALLEL WORKTREES and merge in order.** Sequential work that has no dependency between its halves is just a longer build.
5. **Prod smoke ONCE per push**, not once per commit. `node scripts/status.js` after the push that deploys, not after each one that does not.

**What this does NOT relax:** the full battery stays green before every push, the pre-push hook is never bypassed, a new route still needs its tenant probe or a reasoned exemption, and a guard still has to be PROVEN able to fail. Speed comes out of the paperwork, never out of the evidence.

## CRITICAL WORKING RULES

- **A guard whose number cannot fall is not measuring coverage** (BUILD-75 A.6, from the BUILD-74 date-audit defect: a defective helper counted as one site forever at its definition, so every new call site was invisible and `total <= BASELINE` could never fire while coverage decayed). When you add a guard or assertion: state explicitly what would have to happen for it to fail, and PROVE it fails on a tree where the defect exists (see `tests/date-seam.test.js` §8 — synthetic-tree proofs — for the pattern). Report counts on separate axes separately (expressions written vs values consumed); never sum them into one number.
- After every change, run: git add -A && git commit -m "..." && git push origin main. Always run `git status` and `git log --oneline -3` to CONFIRM the commit landed — do not report work as "done" until git confirms it's committed and pushed.
- **Scripted verification is committed with the feature, not discarded after passing.** Suites live in `tests/` (see `tests/README.md` for the scratch-Postgres recipe). BUILD-02/03 discarded theirs and BUILD-05 had to improvise capture-and-diff parity checks as a result — that's the failure mode this rule exists to prevent.
- **The standard test run is `bash tests/run-all.sh` (= `npm test`) — keep it green.** It runs all 40 self-contained suites incl. `tests/consistency-e2e.test.js` (the cross-surface duplication guardrail, BUILD-23), `tests/workflows-e2e.test.js` (BUILD-25 — workflows fire on live events only), `tests/finance-reports-consistency` / `name-normalize` / `reserved-recovered` (BUILD-26), and `tests/concurrency.test.js` (BUILD-27 — parallel-race guarantees). Boot the scratch server with `STRIPE_WEBHOOK_SECRET=whsec_localtest` AND `RESEND_BASE_URL=http://localhost:5602` first (workflows-e2e captures recipe emails at that sink) — see the boot recipe in `tests/README.md`. Before a pilot goes live, also run the read-only reconciliation audit against prod: `node scripts/consistency-audit.js` (see "Cross-surface consistency" below).

## Deploys — gated behind green CI (deploy rewire, 2026-08-11)
Full before/after + break-glass: `audit/deploy-rewire.md`. The shape:
- **Railway (backend) deploys ONLY from GitHub Actions** — the `deploy-railway` job in `.github/workflows/ci.yml` (push to main, `needs: [test]`, concurrency group `deploy-main` no-cancel) runs `railway up` with the project-scoped `RAILWAY_TOKEN` secret, then polls `/health` until `status:ok` AND `buildSha == $GITHUB_SHA` (5-min timeout, loud failure). **Railway's GitHub auto-deploy trigger is DISCONNECTED** — pushing to main does NOT deploy the backend by itself; the Actions job is the one path. Break-glass when Actions is down: manual `railway up --service nonprofit-erp --ci` from an authed checkout with `git rev-parse HEAD > .build-sha` first (rm it after; it's untracked ON PURPOSE — `railway up` honors .gitignore, so ignoring it would strip the stamp from the upload. That exact mistake cost the first proof run).
- **Deploy verification surfaces**: `GET /health` → `buildSha` (from `.build-sha`, else `RAILWAY_GIT_COMMIT_SHA`/`BUILD_SHA`, else null — NB Railway does NOT expose the git SHA at runtime, so the stamp file is the real mechanism); the built client carries `<meta name="build-sha">` (vite.config.js, from `VERCEL_GIT_COMMIT_SHA`/`GITHUB_SHA`/`BUILD_SHA`/git). "What commit is live?" is now one curl per side — never guess from route probes again.
- **Vercel (frontend) also deploys ONLY from Actions since the go-live cutover (887bf2e, 2026-08-12)** — `git.deploymentEnabled:{main:false}` in vercel.json disables Vercel's git auto-build for main, and the `deploy-vercel` job (active: `VERCEL_DEPLOY_ENABLED=true` + `VERCEL_TOKEN` secret) is the one frontend deployer: green tests → `vercel deploy --prod --build-env BUILD_SHA=$GITHUB_SHA` → polls www.stewardapp.dev until `<meta name="build-sha">` == the pushed SHA. **Do not re-enable git auto-build** — that would let a red-test push ship the client; pinned by `tests/email-links.test.js` §5 (vercel.json keeps `deploymentEnabled.main === false`). The ignored-build-step alternative stays rejected (`BLOCKED-vercel-gate.md`). An earlier note here said auto-build was still on — stale since the cutover; it cost one wrong claim in a BUILD-47 report.
- **CI failure logs**: `tests/run-all.sh` keeps every suite's full output in `/tmp/steward-suite-logs/` and dumps a failing suite's entire output inline under its FAIL line; CI uploads the dir as artifact `suite-logs` on failure. A red run names the assertion, not just the suite.
- **Branch protection**: ruleset `main-protection` (id 20722943) — no force pushes, no branch deletion, requires check-run `test` (strict). Carries a repo-admin bypass so the documented direct-push-to-main workflow keeps working (a ruleset-required check would otherwise reject all direct pushes); the deploy gate does not depend on it. Drop the bypass if the workflow ever moves to PRs.
- The pre-push hook (full local suite) is unchanged — the INNER gate; Actions is the OUTER gate and the only deployer.

## Vercel config
- Root directory: blank (not "client")
- vercel.json at project root handles build
- client/vercel.json has VITE_API_URL env var
- GitHub connected, but git auto-build is DISABLED for main (`git.deploymentEnabled:{main:false}` in root vercel.json) — the frontend deploys only via the `deploy-vercel` Actions job (see "Deploys" above); backend auto-deploy is disconnected too
- Custom domain: stewardapp.dev → DNS via Vercel nameservers
- Resend domain verified: stewardapp.dev, sends from noreply@stewardapp.dev
