# FIX-1 — lead handoff (26 September 2026, after the split)

The FIX-1 lead's state of play. The brief, with Jonathan's amendment, is
`claude/FIX-1.md` on this branch; this file supersedes the 25 September
handoff (see git history of this file for the pre-split plan). Read both
before touching anything.

## 1. Where fix-1 is

`fix-1` at **`0c341a5`**, pushed (a forced update: the branch was rebased onto
main `c82eeaa` — CHORE-1 + ci-fix-297 — as Jonathan asked; the old tip was
`7c1c875`). Nothing is merged to main; that is Jonathan's call.

On top of main, in order:

| Commit | What |
|---|---|
| `a0aea43` | Part 0 (25 Sep): 22 red assertions, `tests/fix1-walk.test.js` |
| `f365df0` `ba541c4` `fc638c1` | the brief + amendment, the two Agent directions (Direction 2 chosen), the 25 Sep handoff |
| `2b2a224` | Part 0 findings 9–13 (26 Sep): 16 more red assertions, `audit/fix1-part0-9-13-red.txt` |
| `092b189` | split step 0: `readSource()` — every source-reading suite reads through it (option (a); the commit message names every suite) |
| `f204f8e` … `490b4aa` | nine commits: `routes/webhooks.js`, `billing`, `finance`, `volunteer`, `agent`, `give`, `crm`, `jobs`, `email` |
| `509b183` | `client/src/lib/tabRegistry.js` — App.jsx's ten tab lists |
| `0c341a5` | Donors.jsx → `DonorImport.jsx`, `DonorProfile.jsx`, `DonorDirectory.jsx`, `donorShared.jsx` |

**Evidence on `0c341a5`** (local stack, fresh `steward_fix1`): full battery
**239 suites green, 0 red** (11,068 assertions; tenant-matrix 43/0,
tenant-isolation 32/0 run inside it); the only skip is demo-shape, the known
FIX-1 item. The baseline on the unsplit base was also 239/0. A browser walk of
all twelve tabs plus a donor profile and the import screen at 1440 and 390:
no page error, console error or error boundary. **Zero assertion edits.**
CI does not run on `fix-1` (ci.yml: main and PRs to main only), so the local
battery is the evidence until a PR.

Part 0 now: **4 green / 37 red** (§12's "everything else is under More" went
green when tabRegistry.js appeared; it was already true).

## 2. What the split produced

`server.js` 38,854 → **8,761 lines**: boot, middleware, the shared helpers,
`/health`, and the wiring. Every route moved except `/health`.

| File | Lines | Routes | What |
|---|---|---|---|
| `routes/webhooks.js` | 2,298 | 10 | Stripe/Resend/billing/inbound-email webhooks, unsubscribe, Stripe Connect |
| `routes/billing.js` | 1,850 | 38 | auth, platform billing, super-admin |
| `routes/finance.js` | 582 | 18 | finance, financials |
| `routes/volunteer.js` | 205 | 8 | volunteer, volunteers, shifts, hours |
| `routes/agent.js` | 1,255 | 40 | agent, ai, workflows, sequences |
| `routes/give.js` | 5,105 | 115 | giving pages, forms, portal, accounts, network, recurring, giving sources |
| `routes/crm.js` | 18,323 | 388 | everything else signed-in (people, gifts, Thread, pipeline, grants, reports, settings, …) |
| `routes/jobs.js` | 370 | 0 | the top-level timer blocks + the functions only they call |
| `routes/email.js` | 646 | 0 | the mail helpers two or more products use (a helper module) |
| `client/src/lib/tabRegistry.js` | 106 | | App.jsx's tab lists, verbatim (App.jsx 803 → 708) |
| `client/src/components/Donors*.jsx`, `donorShared.jsx` | 562 / 3,737 / 2,857 / 835 / 96 | | Donors.jsx 8,013 → 562 |

How a routes module is wired (read its header before editing one):
- Each module holds Express Routers (`r0`, `r1`, …). server.js mounts each with
  `app.use(require("./routes/x").routers.rN)` **where its first route used to
  be**, so it keeps its place relative to the body parsers, the DB-ready guard
  and the portal-tier gate. webhooks' `r0` (raw-body routes) sits before the
  parsers and the DB-ready guard; crm's, give's and billing's `r0` sit after
  the guard and before the portal-tier gate, exactly where those routes were
  (`/campaigns/templates` etc. stay reachable on the Portal tier).
- The moved code sits **verbatim inside `mount(ctx)`**, called once at the end
  of boot (`// ── FIX-1 split: register the moved routes`), when every binding
  exists; `app` inside it is the current router. `ctx` is the list of
  server.js bindings the code reads.
- A **relative `require("../x")` / `import("../x")`** in `routes/` is the
  moved `"./x"` (it resolves against its own file). **A new route added to a
  module writes `"../x"` too.**
- Lazy ESM bindings (`let ACK = null` + `ACK_READY.then(...)` in server.js)
  are mirrored inside the module from the same promise.
- Kept in server.js because they read a `let` that changes after boot:
  `/health`, `reconciliationHealth`, `guardsOk`, `webhookSubHealth`,
  `refreshReconcileDenominator`, `sendDonorLifecycleEmail`.
- The split tool proved, per module: no two routes that can match one request
  changed order, and no route crossed a positional middleware.

`crm.js` is 18k lines: the amendment's product names are the floor. D or the
lead may cut it further (people / money / grants / reports) the same way.

## 3. readSource — how suites read split code

`scripts/lib/readSource.js`. `readSource(rel)` rebuilds `server.js`,
`client/src/App.jsx` or `client/src/components/Donors.jsx` **from the live
files, in the order they had before the split** (a hash + name per statement in
`scripts/lib/splitOrder.json`; an order, never a copy). On `0c341a5` all three
come back **byte-identical** to the pre-split files. A statement edited later
is placed by its name; one added later lands after the statement above it.
The parser is espree from `client/node_modules` (CI installs it before tests).

- **Source readers switched: 53 suites + 3 audit scripts** (build72-date-audit,
  build73-money-audit, build97-number-census) + `scripts/lib/routeInventory.js`.
  The 53 are listed in `092b189`'s message. The count the 25 Sep handoff
  measured was 52/17/9 files for server/Donors/App.
- Deliberately NOT switched: directory walkers that already see new files
  (brand-allowlist, build84 ROOTS, no-emoji, incident-mail-gate), deploy-shape
  (follows require() itself), build89s-stripe-givebutter (only names the file).
- `splitParts()` lists the files that are pieces of a split file; asset-
  retention uses it to skip them in its per-file scan.
- **Workstreams:** add a route to its module and it just works; a suite that
  greps server.js for it finds it through readSource. Don't move code out of
  a split file without adding the new file to `FILES` in readSource.js.

## 4. Surprising things (each cost a red run)

1. **`import()` resolves against the file it is written in**, not the
   `require` a module is handed: the first split battery was 89 red (missing
   `routes/shared/*.js`). Fixed by rewriting moved relative specifiers to
   `../`. deploy-shape caught the same for `require("./money")`.
2. **Order is read, not just content.** mail-block strips comments with one
   regex across server.js; with moved code read back in a different order, a
   `"/*"` inside a string paired with a later `*/` and swallowed `opsAlert`.
   Hence the byte-identical, order-exact readSource.
3. **Nine App.jsx suites pin the tab lists' literal text** (`const
   PRIMARY_NAV=["dashboard","board"`, `CORE_HIDDEN_TABS=new Set(["finance"])`,
   the `const TABS=[…];` block). The single-array registry (lists derived from
   one entry per tab) would change ~12 assertions — **Jonathan's call**; the
   split moved the lists verbatim into tabRegistry.js instead.
4. **Donors.jsx keeps its original import lines** (so readSource can rebuild it
   byte for byte); ~50 names are now used only by a part, so client lint
   warns 673 (was 552, 0 errors). Prune when D next edits Donors.jsx.
5. build97-numbers requires every screen file to be named in the census:
   `SCANNED_AS_DONORS` in `scripts/build97-number-census.js` names the four
   new files (they are scanned as Donors.jsx).
6. The route inventory's per-route **param annotations** come from slicing
   source text between registrations, so they shift for routes that now sit
   at a router boundary (6 routes; e.g. `/recurring/:donorId/resend` gains a
   spurious `orgSlug`). The live router is identical (618 routes, same auth
   chains and layers); tenant-matrix compares sets, so the committed
   `audit/route-inventory.json` was left as it was.
7. macOS has no `timeout`; a script "run" under it silently did nothing once.

## 5. Next, in order (Jonathan said: stop after this handoff)

1. **Lead, before any workstream:** fix Part 0 findings **9, 10, 11, 13**
   (`shared/threadFigures.js`; the Home note's count; `scripts/seed-demo.js`
   + no suite touching the demo org + demo-shape never skipping + CI seeding
   it — this is also "the demo-shape skip"; `giverCountWord`). 12 is checked
   at the end.
2. **Cut fresh workstream branches from `fix-1`** (not the parked
   `fix-1-a/-c/-d/-e`, which stay as reference and are NOT rebased). Suggested
   names `fix-1-a2` … `fix-1-e2`. Worth cherry-picking onto the fresh ones:
   - C: `7755ccb` (27 red assertions for the volunteers hub)
   - D: `2e3159a` (red assertions for people)
   - E: the sign-first `fmtFull` change is inside the PARKED commit `a688b84`
     (`client/src/lib/money.js` + the `tests/finance-funds.test.js` pin, a
     reviewed contract change) — take those two files, not the commit (its
     `routes/finance.js`/`server.js` changes predate the split).
   - A's `98b9f93` (`shared/suggestionGuard.js`, vocabulary/agentShape WIP) is
     unreviewed; A decides.
3. Spawn C, D, E and B in parallel (own worktree, ports and DB below); A after,
   building Direction 2. Merge order **D, C, B, A, E**, affected suites after
   each, full battery + tenant battery + the walk at the end.

**For later in FIX-1:**
- Note the `recordGift` exceptions (the bulk writers: the two import routes,
  sample data, one webhook branch) for a later FIX.
- Swap the fixed `settle()` waits for `waitFor()` in theme-depth,
  donor-dashboard and donor-accounts (the mail-sink race).
- Finance cut (Accounts tab, AI "6-Month Forecast"/"Risk Analysis") and the
  Members/Funds placement still want Jonathan's confirmation.
- The single-array tab registry (§4.3) — Jonathan's call.

## 6. Databases and ports (all on :5544)

`steward_fix1` exists (the lead's, fresh on the last battery). The workstream
databases do not; create them with `createdb -h localhost -p 5544 -U steward
<name>`. The shared `steward_loadtest` is never used by FIX-1.

| Worktree | Branch | Database | API | Preview | SINK | STRIPE_MOCK | BILLING_MOCK |
|---|---|---|---|---|---|---|---|
| `~/steward-fix1` (lead) | `fix-1` | `steward_fix1` | 5701 | 4301 | 5702 | 5703 | 5704 |
| `~/steward-fix1-a` | `fix-1-a2` | `steward_fix1_a` | 5711 | 4311 | 5712 | 5713 | 5714 |
| `~/steward-fix1-b` | `fix-1-b2` | `steward_fix1_b` | 5721 | 4321 | 5722 | 5723 | 5724 |
| `~/steward-fix1-c` | `fix-1-c2` | `steward_fix1_c` | 5731 | 4331 | 5732 | 5733 | 5734 |
| `~/steward-fix1-d` | `fix-1-d2` | `steward_fix1_d` | 5741 | 4341 | 5742 | 5743 | 5744 |
| `~/steward-fix1-e` | `fix-1-e2` | `steward_fix1_e` | 5751 | 4351 | 5752 | 5753 | 5754 |

Worktree setup: `git -C ~/nonprofit-erp worktree add ~/steward-fix1-x -b
fix-1-x2 fix-1`, then symlink `node_modules` and `client/node_modules` from
`~/nonprofit-erp` (never commit the symlinks). Boot recipe: `tests/README.md`
+ the `tests/run-all.sh` header with these ports substituted. The battery on
a non-default port block needs `BASE`, `APP_URL`, `SINK_PORT`,
`STRIPE_MOCK_PORT`, `BILLING_MOCK_PORT`, `NODE_PATH=~/steward-qa/node_modules`
and a client dist built with `VITE_*` pointing at the worktree's API (not
`scripts/build-local-dist.sh`, which hardcodes :5601); the server's
`CORS_ORIGIN` must be the worktree's preview.

## 7. Other sessions' ports seen on this machine (26 Sep)

`:4173` (a `local-preview.js` from `~/nonprofit-erp`, running since 24 Sep),
`:4223` (steward-101), `:4233`, `:5691` (steward-102). None are FIX-1's.

CLAUDE.md gets FIX-1's entry from the lead at the end; workstreams write notes
in `docs/fix-1/<X>-NOTES.md`, never CLAUDE.md.
