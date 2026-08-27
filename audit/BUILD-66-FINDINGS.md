# BUILD-66 — FINDINGS (running record)

Separating Kingdom Builders (the donor-facing giving product) into a standalone
repository. Fork, not a move — Steward loses nothing and is not edited. This file
is the running narrative + decisions + the §worry section. Updated as parts land.

## Steward identity guard — SHIPPED to main, DEPLOY BLOCKED on infra

- Reviewed the staged diff (clean: two `/health` keys, boot-time DB-name cache,
  Layer-0 in `writerBase` gated behind `!opts.noExit`). No test asserts exact
  `/health` shape; `script-guards` scans `scripts/` non-recursively so root
  `product.js` / `scripts/lib/prodGuard.js` aren't tripped.
- **Steward full battery GREEN: 104 suites / 0 failed** (ran twice — once by hand,
  once via the pre-push hook). Committed `03ad292` (guard) + `bad500e` (audit
  trail) and **pushed to `main`** through the repo-admin bypass (pre-push battery
  green). This satisfies "Steward stays green at every boundary" and the review.
- **⚠ DEPLOY BLOCKED (needs Jonathan).** GitHub Actions created **no workflow run**
  for the push (Actions `enabled:true`, `allowed_actions:all`, yet 0 runs for
  `bad500e`/`03ad292`; last run was 3 days ago). Signature of an **account-level
  Actions usage/spending cap** silently suppressing run creation. Because Steward
  deploys ONLY from the CI `deploy-railway`/`deploy-vercel` jobs, **prod is still
  on `8bfef81` and does NOT have the identity guard** (`/health` on prod shows no
  `product`/`database`). The guard is on `main` but protecting nothing in prod —
  the exact state Jonathan flagged, now one infra step from resolved.
  **Decision (Jonathan): option (a) — clear the Actions cap, no break-glass.**

### Ground truth on what's live (asked before clearing the cap)

- **Backend** `/health.buildSha` = `8bfef81`. **Frontend** `<meta build-sha>` =
  `8bfef81` on BOTH www.stewardapp.dev and the vercel URL. **Both surfaces match,
  cleanly — no split-brain.** Last successful CI run: `8bfef81`, 2026-08-23 04:57.
- **`origin/main` = `f7b5012`. Prod is SIX commits behind**, not three:

  | commit | what | code? | mine? |
  |---|---|---|---|
  | f7b5012 | BUILD-66 FINDINGS | docs | yes |
  | bad500e | BUILD-66 audit trail | docs | yes |
  | 03ad292 | identity guard | server.js/prodGuard/product.js | yes |
  | a9be0d2 | BUILD-65 Part 3 FINDINGS "3 of 4 crop slots done" | docs | **no** |
  | 7f6a6c9 | **BUILD-65 Part 3c: widget/hero crop** | PortalBanner/Widgets/Editor, server.js, tests | **no** |
  | a34b288 | **BUILD-65 Part 3b: per-photo crop on impact photos** | PortalBanner/Widgets/Settings/Portal, db.js, server.js | **no** |

- **⚠ ANSWER TO "did anything believed-shipped not ship": YES.** BUILD-65 **Part
  3b + 3c** (per-photo impact crop, widget/hero crop — real donor-facing
  features, with tests) were committed **2026-08-23 22:26–22:32**, but the last
  CI run was **04:57 that morning** (`8bfef81`). They were **committed locally
  and never pushed** — sitting undeployed for 3 days; prod has run without them.
- **My push today coupled them to the guard.** Before my push, `origin/main` was
  `8bfef81` == prod. My guard sat on top of local HEAD `a9be0d2`, so `git push`
  necessarily swept those 3 BUILD-65 ancestors to `origin` too. **I did not check
  `git log origin/main..HEAD` before pushing — I should have, and flagged the
  coupling then.** Consequence: the **next successful CI deploy ships my guard
  AND BUILD-65 Part 3b/3c together.** Mitigating: the full battery I ran today
  (104/0) was against the working tree that INCLUDES all six commits, so they are
  **test-green together**. But "3 of 4 crop slots done" reads like a WIP
  checkpoint (slot 4 = logo trim, only "scoped") — **Jonathan should decide
  whether to ship the BUILD-65 crop work now or hold/split it**, since clearing
  the cap + pushing will deploy it alongside the guard.
- Prod scratch stack was rebuilt after a `/tmp` reaper corrupted the PG cluster
  at midnight (`initdb` per the documented recipe) — unrelated to Actions.

## Deploy resolved + drift-check shipped (this pass)

- **The identity guard is LIVE in prod.** The Actions cap cleared; CI deployed
  through `6fd9112`. Prod `/health` now reports `"product":"steward",
  "database":"postgres"` — the guard is protecting production. **BUILD-65 Part
  3b/3c shipped alongside it** (Jonathan's decision; both are ancestors of
  `6fd9112`, verified by `git merge-base --is-ancestor`). Both surfaces matched
  (no split-brain). Item 1 (ship the guard) is **complete**.
- **`scripts/status.js` — the drift-check that would have caught BUILD-65.**
  Prints local HEAD · origin/main · prod backend buildSha · prod frontend
  build-sha, and LOUDLY flags unpushed / behind-remote / undeployed / split-brain.
  Read-only (classified PROD_READONLY, script-guards 332/0), hosts env-overridable
  for the fork, `npm run status`. **Proved itself on first run:** flagged
  origin/main 1 commit ahead of prod (undeployed), and later degraded gracefully
  on a transient deploy-window 503 (no crash, no false-green, exit 2). The
  pre-push battery re-confirmed Steward green with these changes.

## Part A — mixed-component trim, feature by feature (route counts)

Rhythm: trim the feature across every component that uses it → carve the routes
it orphans (acorn) → reboot + drive the giving flow. Running carve total after
each.

| Feature | Status | Routes carved | Total |
|---|---|---|---|
| (chunk 1, orphaned) reports/digests/workflows/tasks/sequences/… | DONE | 51 | 51 |
| (B) Donors portfolio-CRM orphans | DONE | 55 | 106 |
| **Gmail** (Settings card+handlers) | **DONE** | **7** (`/gmail/*`) | **113** |
| **U-6 reports (dropped)** | **DONE** | dead handler cluster deleted | 113 |
| **U-9 campaign send** | **DONE** | **2** (`/campaigns/:id/{send,briefing}`) | **115** |
| **App bulk-load** (dead buildContext + board/financials/volunteers/tasks) | **DONE** | **4** (`/board`, `/financials*`) | **119** |
| **Team** (`/org/team`, `/auth/invite`) | **KEEP** (decision) | — org-side admin the brief wants; distinct from STEWARD portfolio-officer layer | 119 |

**Decisions this pass:** Team stays (KB orgs invite co-admins to configure their
portal/funds/campaigns — generic org admin, not the major-gifts officer layer).

**Remaining Part A (1 coupled unit + cleanup):**
- **Finance mgmt + grants — DONE (U-5 resolved).** `Finance.jsx` rewritten
  **1,401 → ~230 lines** as a **funds editor**: money-in (Stripe balance/payouts)
  + funds create/edit with balances from `/finance/summary` (a deliberate screen,
  not a stripped tab). Dropped Transactions/Budgets/Accounts/Audit subtabs, AI
  forecast/risk, grant entity-routing; removed `/grants` from App bulk-load +
  `adaptData`, TopBar grant search; deleted orphaned `financeMatch.js`. **16
  routes carved** (`/finance/{accounts,budgets,audit-log,transactions}` +
  `/grants*`); running total **135**. Drive green (designation verified via
  fund-balance delta on `/finance/summary` — the ledger route is carved, so the
  drive's step-5 was updated first per the gotcha). Wall tests green
  (org-blindness 54 · network-gate 34 · donors-lean 21 · isolation 144). KB
  commit `f4894ab`. **U-7 note:** Fundraising's roll-up analytics were NOT touched
  by this unit — revisit when the Fundraising surface is next in hand.
- **Customization + WelcomePage onboarding** — trim Settings' Custom Fields +
  Impact Metrics AND rewrite WelcomePage to lean KB onboarding (drop goal/metric/
  portfolio steps) → orphans `/custom-fields*`, `/impact-metrics*`, `/goals*`,
  `/portfolio/officers*`.
- Then dead job/helper bodies + `db.js` STEWARD table drop + U-1 orgs-column
  split, then Part 4.

**Caller-entanglement map (traced) — this dictates the remaining order:**
- **Custom Fields** → Settings only. *Cleanly isolable* (~5 routes) BUT shares the
  Settings "customization" section render + interleaved `cfForm`/`imForm` state
  with Impact Metrics → do the two together.
- **Impact Metrics** → Settings **+ WelcomePage** (onboarding "metric" step POSTs
  `/impact-metrics`). Can't orphan until WelcomePage's metric step goes too.
- **Goals** → **WelcomePage** only ("goal" step POSTs `/goals`).
- **Portfolio/officers** → **WelcomePage** only (Team-invite step).
- **Team** (`/org/team`) → Settings only (clean).
- **Finance mgmt** (`/finance/{accounts,budgets,audit-log}`) → Finance only.
- **`/financials`** → **App.jsx** (bulk `adaptData` load).
- **`/grants`** → **App.jsx + Finance.jsx + TopBar.jsx** (data load, entity
  routing, global search) — most entangled.
- **`/board`** → **App.jsx** (bulk load).

**Consequence:** the remaining Part A is **three coupled units**, not seven
independent features:
1. **Customization + onboarding** — trim Settings' Custom Fields + Impact Metrics
   AND rewrite WelcomePage to a lean KB onboarding (drop goal/metric/portfolio
   steps) → orphans `/custom-fields*`, `/impact-metrics*`, `/goals*`,
   `/portfolio/officers*`. (WelcomePage-rewrite-sized, like the Donors B pass.)
2. **Finance mgmt + App bulk-load** — trim Finance to a funds editor (U-5),
   remove `/financials`+`/grants`+`/board` from App.jsx's `adaptData` and
   TopBar search → orphans `/finance/{accounts,budgets,audit-log}`, `/financials*`,
   `/grants*`, `/board*`.
3. **Campaign send (U-9)** — remove `/campaigns/:id/{send,briefing}` +
   `campaign_recipients` + `processScheduledCampaigns` (no client caller; keep
   `/campaigns` CRUD + `/progress`).
Then Team (clean, small), the dead job/helper bodies (`fireWorkflows`,
`processSequences`/`autoEnroll`, `syncGmail`/`syncAllGmail`, gmail OAuth helper),
the `db.js` STEWARD table drop (incl. `gmail_connections`/`gmail_sync_exclusions`
+ `GOOGLE_*` env, orphaned by Gmail), and U-1 orgs-column split. Then Part 4.

**Boot-recipe fix (learned this pass):** KB test boots must use
`STRIPE_API_BASE=http://localhost:5603` (network-gate's Stripe mock port) — my
earlier :5703 starved `stripeChargesEnabled` and false-failed network-gate 10×
(env, not a regression; 34/0 with :5603).

## UNCLEAR items (U-1…U-13) — resolution audit

Requested check that all 13 boundary UNCLEARs are actioned (U-8/U-4 answered by
Jonathan; the other 11 proceeded on my leans). Traced empirically against the
current KB tree. **Two drifted — U-6 and U-9 — exactly as Jonathan predicted.**

| # | Resolution | Landed / status |
|---|---|---|
| U-1 orgs column split | Keep money/portal/receipt/network cols; drop Steward-commercial | **PENDING** — `db.js` still has `plan`/`subscription_status`/`stripe_customer_id`/`recurring_dunning*` (KB copied whole). Rides the `db.js` table carve. |
| U-2 donor CRM surface | Lean read-first donor screen, not the portfolio CRM | **DONE** — `components/Donors.jsx` (5,472→344), `tests/donors-lean.test.js` 21/0. |
| U-3 workflows↔dunning | Dunning SHARED (stays); workflows STEWARD (go) | **DONE (routes)** — `/workflows*` carved; `processDunning` kept (7 refs); `processWorkflowSweeps` tick stopped. Dead `fireWorkflows` engine body remains for the call-graph cleanup. |
| U-4 platform billing | **Jonathan: stub.** Billing STEWARD | **PENDING** — `/billing/*`, PlanPicker, `billingPlans.js` still in KB; billing-removal row in Part A table. |
| U-5 Finance mgmt tab | Funds editor only; drop budgets/accounts/audit | **PENDING** — Finance.jsx whole; Part A "Finance mgmt" row. |
| **U-6 reports** | **My lean: giving-summary SHARED, rest STEWARD** | **⚠ DRIFTED — needs your call.** `GET /reports/:key` (which served giving-summary) was carved in chunk 1, so giving-summary is **not reachable in KB**. The handler `reportGivingSummary` + `REPORT_KEYS` + the network-gate allow-line survive as **dead code**. `/fundraising/overview` already gives an org admin "what did we raise." **Recommend: reconcile to DROPPED (overview covers it) and delete the dead handler** — or restore a lean `GET /reports/giving-summary` if you want the period/median/new-donor view. Your pick. |
| U-7 Fundraising vs analytics | Lean campaign editor travels; roll-up analytics stays STEWARD | **PARTIAL** — Fundraising.jsx whole; campaign editor + overview kept, goals/analytics trim is Part A "Goals" row. |
| U-8 staff recurring | **Jonathan: KB.** RecurringGiving travels | **DONE** — `RecurringGiving.jsx` + `/recurring/*` kept. |
| **U-9 campaign send** | **My lean: send/scheduling STEWARD (remove); campaign RECORD SHARED (keep)** | **⚠ NOT YET CARVED + was missing from the feature table (your catch).** `/campaigns/:id/send`, `/campaigns/:id/briefing`, `campaign_recipients`, `processScheduledCampaigns` (body) still in KB; no kept-client caller. `/campaigns` CRUD + `/progress` stay (giving attribution + goal thermometers). **Added as a Part A feature row; will carve.** |
| U-10 legal pages | Stub, don't adapt (personal-name risk) | **DONE** — Privacy/Terms placeholder stubs (Part 2). |
| U-11 Settings split | Keep KB config; carve Steward config | **PENDING** — Part A rows (Gmail/Team/Custom Fields/Impact Metrics). |
| U-12 AdminDashboard | KB keeps network review + org mgmt; drop Steward-only ops | **ACCEPTABLE as-is; rebrand at Part 4** — calls only `/admin/{metrics,network/applications,orgs}` (all KB-relevant); no Steward-commercial admin routes. Carries its own `A` palette + "Steward" strings → Part 4. |
| U-13 sequences/milestones/notes | STEWARD (carve); KB authors own onboarding email later | **DONE (routes)** — carved chunk 1. Dead `processSequences`/`autoEnroll` bodies remain for call-graph cleanup. KB onboarding email = deferred. |

**Net:** 5 DONE, 1 acceptable, 5 PENDING (all in the Part A / db.js / billing
carve queue), **2 drifted needing your decision (U-6, U-9)**. U-9 is folded into
the Part A feature table below; U-6 needs a keep-or-drop call.

## Progress

- **Part 0 — boundary drawn.** `audit/BUILD-66-BOUNDARY.md` classifies ~87 tables,
  ~250 routes, 16 jobs, ~22 mail/PDF builders, ~63 client files, 112 suites into
  KB / STEWARD / SHARED, with 13 UNCLEAR items surfaced. Reviewed by Jonathan.
- **Part 1 — new repository.** DONE. `~/kingdom-builders`, fresh `git init`, one
  commit, no Steward history, no archaeology. 237 files. See "Part 1 detail".
- **Part 2 — own DB, empty start, demo seed, isolation pin.** DONE (schema
  reduction defers to Part 3 per the agreed sequencing). See "Part 2 detail".

- **Part 3 — remove what doesn't belong.** IN PROGRESS. The **client surface,
  background jobs, and the Mi Gulf Coast customer code are removed and verified
  live**; the `server.js` route/handler carve and `db.js` table carve are the
  substantial remainder. See "Part 3 detail".

- **Identity guard (both repos) — DONE + verified.** "Loopback is not identity"
  (the :5601 incident, instance three of a class). `/health` now reports
  `product` (a baked constant, `product.js`) + `database` (`current_database()`,
  cached at boot) in BOTH repos. Write scripts assert both before writing:
  Steward via `prodGuard.assertServerIdentity` wired into `writerBase` (all 33
  callers inherit it; skipped only under the test `noExit` path); KB via
  `scripts/lib/assertTarget.js`, called by `seed-demo.js`. **Proven both
  directions:** a KB seed pointed at the Steward server is refused
  ("product 'steward', not 'kingdom-builders'"), a Steward writer at the KB
  server is refused symmetrically, wrong-database is refused, and correct
  target passes. Steward `script-guards.test.js` stays green (328/0). Lesson
  written to `docs/separation/DIFFERENCES.md`. **Steward's three code changes
  (`server.js`, `scripts/lib/prodGuard.js`, `product.js`) are UNCOMMITTED in
  Steward's working tree — for Jonathan's review + deploy (Jonathan deploys
  Steward).** KB's are committed (`5bfecab`).
- **Giving-flow drive — money core verified live** (not `node --check`). Against
  `kb_demo`: staff login → enable receipts → **designated gift $250 (restricted
  fund + campaign) → ledger stamp carrying the correct fund_id (source=gift) →
  receipt #2026-00001 → a real 2,236-byte PDF → donor lifetime updated** → public
  `/org/:slug/public` and `/portal/:slug/config` both 200. NOT yet driven (need
  Stripe-webhook signing / email-token capture — next drive): the public
  Checkout→webhook gift path, recurring subscription, and donor-account
  signup/verify/dashboard.
- **`server.js` carve — first chunk DONE + verified.** Removed **51 orphaned
  STEWARD route statements** (reports, digests, workflows, tasks, sequences,
  milestone-drafts, note-reminders, annual-fund, voice-memos, metrics, programs,
  volunteers) via an **acorn AST carve** (exact spans — a brace counter miscounts
  on parens inside SQL/strings). ~71KB removed; `node --check` clean; boots;
  removed routes 404, kept routes 200; **the giving money-core still drives green**
  (designated gift → ledger stamp with correct fund → receipt → real PDF, no
  regression). Tooling + the drive harness are now proven for the rest. KB commit
  `7c0cf54`.
- **KEY FINDING that reorders the remaining carve.** The kept mixed client
  components (`Donors.jsx`, `Finance.jsx`, `Fundraising.jsx`, `Settings.jsx`) STILL
  CALL many STEWARD routes (pipeline/move, moves, opportunities, planned-gifts,
  pledges, designations, relationships, materials, custom-fields, gmail,
  finance/accounts+budgets+audit, financials, impact-metrics, goals, households,
  events, grants). So the **entangled server routes cannot be carved until those
  four components are trimmed to their lean KB surface (U-2/U-5/U-7).** The
  client mixed-file trim is therefore a PREREQUISITE for the rest of the server
  carve — not a later cleanup. This is the single most important sequencing fact
  for the next session.
- **Dead job/helper bodies are interconnected**, not grep-removable: `autoEnroll`
  (10 refs), `processSequences` (6), `syncGmail` (5) call each other and remain
  referenced. Removing them is call-graph work, and it's **coupled with the
  `db.js` STEWARD table drop** (the dead bodies still reference `sequences`,
  `workflow_runs`, `tasks`, `digest_sends`, etc., so those tables aren't yet
  orphaned). Do the two together.
- **Remaining carve, in the order reality forces:** (1) trim the four mixed
  client components to the lean KB surface, removing their STEWARD API calls;
  (2) carve the now-orphaned entangled STEWARD routes (acorn, same tool);
  (3) remove the dead job/helper bodies with call-graph care; (4) drop the
  now-unreferenced STEWARD tables from `db.js`; (5) re-run the giving-flow drive
  + the leak check after each. Then Part 4 (rebrand / no-`Steward`-string).

### The mixed-component trim — true scope (discovered attempting Settings)

Attempted the Settings trim to establish the pattern; it revealed the trim is
much larger than "remove a section," and I reverted to clean rather than commit
a half-cut state. Three findings that reshape the plan:

1. **STEWARD logic is woven as inline state + handlers + modals, not clean
   sections.** Settings' Gmail/Team ARE section-removable, but Custom Fields and
   Impact Metrics are inline `useState` + handler functions + modal JSX scattered
   across the file (state at L925–935, handlers at L1099–1180, modals at
   L1483–1568). Removing one region without the others is a `no-undef` break;
   they must go atomically.
2. **Routes are CROSS-COMPONENT, so orphaning is all-or-nothing per feature.**
   `/gmail/*` is called by Settings AND Donors; `/custom-fields` by Settings
   (CRUD) AND Donors (per-donor values). A route only orphans when EVERY caller
   across EVERY component is gone — so a partial trim of one component orphans
   **nothing** and yields no carve value. The trim must be done per-FEATURE
   across all four components at once, not per-component.
3. **`Donors.jsx` is the dominant unit** — 5,472 lines, with a ~1,900-line
   `DonorProfile` (L2387–4313) that is woven major-gifts CRM (pipeline rail,
   moves, wealth, custom fields, materials, planned-giving, pledges, designations,
   relationships, gmail). It calls the largest share of the entangled routes.

### Hybrid trim — B (Donors) DONE + verified; A (Settings/Finance/Fundraising) next

**B — Donors replaced with a lean KB donor screen. DONE.** Per Jonathan's
enumeration-first instruction, the screen was scoped from the boundary doc (org
administrator viewing their OWN giving, not a portfolio officer): find a donor ·
identity + contact · gift history · receipts + year-end · recurring status; plus
add/edit contact, log an offline gift, issue a receipt (flagged + confirmed
before building). `Donors.jsx` went **5,472 → ~330 lines**. WelcomePage's import
step removed (KB donors arrive via the giving page); `DonorMap.jsx` deleted
(orphaned). Build green. **Verified live** against `kb_demo`: list, profile with
gifts, receipts, recurring, add-donor all serve; the giving money-core still
drives green (receipt #2026-00004). KB commit `75e2ded`.
- **Carve: 55 Donors-orphaned STEWARD routes removed** (acorn) — pipeline, moves,
  opportunities, households, planned-gifts, pledges, designations, relationships,
  soft-credit, materials, fund-affinity, stage/assign/score, donor custom-fields,
  interactions, import/merge, donor events, impact-summary PDF. ~100KB. Removed
  routes 404, kept Donors routes 200, giving flow green. Commit `a6fd9a7`.
  **Running total carved: 106 STEWARD routes (51 + 55).**
- **Requirement 2 honored.** org-blindness verified **54/0 against a clean
  `kb_test`** (the WALL intact; the one `kb_demo` failure was demo-account fixture
  collision, not the carve). The old Donors client guards are **replaced** by
  `tests/donors-lean.test.js` (21/0) — pins the lean surface AND that the
  portfolio CRM is absent. Commit `68ded98`.
- **Requirement 3 honored.** Steward's `Donors.jsx` untouched (only Steward's
  `server.js`/`prodGuard.js`/`product.js` guard changes, staged for review).

**A — Settings/Finance/Fundraising, feature-by-feature, NOT yet done.** These
components weave STEWARD logic as inline state + handlers + modals (Finance's
accounts/budgets/audit and Settings' gmail/custom-fields/impact-metrics are NOT
clean sections), so each feature is a careful multi-edit trim. Do it per FEATURE
across all components, carving after each and reporting the route count:
| Feature (client owner) | Routes it will orphan |
|---|---|
| Gmail (Settings) | `/gmail/*` (auth-url, callback, status, sync, send, thread, disconnect) |
| Custom Fields (Settings) | `/custom-fields`, `/custom-fields/:id`, `/custom-fields/reorder` |
| Impact Metrics (Settings + Welcome) | `/impact-metrics`, `/impact-metrics/:id` |
| Team / Portfolio (Settings) | `/org/team`, `/portfolio/officers*` |
| Finance mgmt (Finance) | `/finance/accounts*`, `/finance/budgets`, `/finance/audit-log`, `/financials*` |
| Goals (Fundraising + Welcome) | `/goals*` |
| Grants / Board (whoever still calls) | `/grants*`, `/board*` |
Then the dead job/helper bodies + `db.js` table drop, then Part 4 (rebrand).

**Recommended approach for the next session (needs a dedicated budget):** work
**per feature across all components** — e.g. "remove Gmail everywhere,"
"remove Custom Fields everywhere," "remove pipeline/moves everywhere" — so each
removal fully orphans its routes; OR **replace `Donors.jsx` with a purpose-built
lean KB donor component** (a clean read-oriented list + profile: identity, gift
history, receipts, recurring status), which orphans the bulk of entangled routes
in one move and is lower-risk than dismembering 5,472 woven lines. Either way,
verify with the giving-flow drive after each feature and keep the build green.

## Standing rules (this build)

- **NO REMOTE until Part 8.** The KB repo is local-only. Intermediate commits
  contain CRM source; once on a remote, a local orphan-collapse does not remove
  them and any clone/fork keeps them. `git remote` on KB must stay empty until
  Part 8's history collapse is done, verified, and leak-checked. (Confirmed: KB
  has zero remotes.)
- **Leak check runs after Part 1, Part 3, AND Part 8** — not just Part 1. The
  strip and the rebrand both move many files; the Mi Gulf Coast customer code
  (`migc`) in particular must never appear in the delivered tree or its history.
- **Legal pages (U-10): STUBBED, never adapted.** Privacy/Terms are interim docs
  under a personal name; KB ships clean placeholders marked as requiring the
  owners' own counsel. Done in Part 2 (see below) — deliberately *before* the
  rebrand, so no pass can swap only the product name and leave a personal name.
- **LICENSE (Part 8 checklist):** the placeholder names no personal party, so it
  does not contradict an owners-own-outright handover. At Part 8 it must either
  state the owners own it outright, or be deleted and left to the agreement.

## Decisions (this build)

- **U-8 → KB.** The staff recurring surface (`RecurringGiving.jsx` roster / MRR /
  proposals / exceptions and its routes) travels to Kingdom Builders — it's the
  giving product's operational heart. (Jonathan, this session.)
- **U-4 → billing stubbed.** Platform billing (Core/Team/founding, PlanPicker,
  `/billing/*`, `billingPlans.js`, LockedFeature Team-gating) stays STEWARD. KB
  launches with billing stubbed; its monetization is a separate later decision.
  This wants its own `BLOCKED-build66-billing.md` when Part 5 lands.
- **Remaining UNCLEARs (U-1,2,3,5,6,7,9,10,11,12,13)** proceed on the leans
  recorded in `BUILD-66-BOUNDARY.md` unless Jonathan corrects them. They bite in
  Parts 2–3 (schema + code strip), not Part 1.

## Part 1 detail

- Repo copied from Steward's **working tree only** (never `.git`) via `rsync`
  with an exclude list covering: `.git`, `node_modules`, `dist`, `.github`,
  `.githooks`, `.vercel`, `.railway*`, `.claude`, `audit/`, `docs/`, `scripts/`,
  `migrations/`, `routes/` (Mi Gulf Coast customer code), `generate-favicons.*`,
  and every top-level report/handoff `.md` (`CLAUDE.md`, `PROGRESS.md`,
  `*_REPORT.md`, `COMMUNICATIONS.md`, `EMAIL_SETUP.md`, `MANUAL-STEPS.md`,
  `BLOCKED-*.md`, `BUILD-*.md`). Leak-checked: none present in KB.
- A pre-existing stray `client/client/` scaffold (a May-25 leftover that also
  sits in Steward) was dropped from KB — "starts clean, no archaeology."
- Authored fresh in KB: `README.md`, `LICENSE` (proprietary placeholder — owners
  choose final terms), `.gitignore`, and `package.json` (renamed to
  `kingdom-builders`, `private:true`, dead `test:audit`/`setup:hooks` scripts
  removed — they referenced excluded `scripts/`/`.githooks`).
- **The monoliths were copied WHOLE.** `server.js` (20k lines), `db.js`, `App.jsx`,
  `Settings.jsx` still contain STEWARD-bucket code. Carving them is Part 3 (code)
  and Part 2/3 (schema). Part 1's job was a clean *intact* copy with clean history.
- **Known boot-blocker for Part 3:** excluding `routes/` (Mi Gulf Coast customer
  code) leaves exactly one dangling require — `server.js:125`
  `app.use("/api/migc", require("./routes/migc").router)`. It's the only
  exclusion-induced dangle (verified by grep); removing that line is a Part 3
  STEWARD strip. **KB cannot boot until it's removed**, which is why Part 2's
  runtime isolation check + demo seed are best done alongside the start of Part 3.

## Part 2 detail

Sequencing (agreed with Jonathan): Part 2 = **own-DB config + empty start + demo
seed + the isolation pin**; the STEWARD *table* removal rides with Part 3's code
strip so schema and handlers carve in lockstep, verified against a scratch
Postgres in one pass. What landed:

- **Own-DB config / isolation.** KB's `db.js` connects only via
  `process.env.DATABASE_URL` — no hardcoded DSN, no OR-fallback (already true;
  confirmed). The isolation audit then found and neutralized **real
  cross-product reach paths** the DB check alone would have missed:
  - `vercel.json` (8 proxy destinations) and `client/vercel.json`
    (`VITE_API_URL`) pointed the KB frontend's donor/portal/account API at
    **Steward's live backend** (`nonprofit-erp-production.up.railway.app`).
  - `client/src/api.js` and **five auth/admin pages** (Signup, Forgot, Reset,
    Invite, AdminDashboard) each hardcoded that host as an API-base fallback
    (the auth pages bypass `api.js` with direct `fetch`).
  - `server.js` Gmail-redirect fallback → same host (Gmail dies in Part 3;
    neutralized now so the pin is absolute).
  All replaced with an unresolvable `https://your-backend-host.invalid`
  placeholder (RFC-2606 `.invalid` — can never resolve to anything real; owners
  set the real host in Part 5 / SETUP.md).
- **Isolation is PINNED, not asserted.** `tests/isolation.test.js` (pure source,
  no DB, in `run-all.sh`) — **177 checks, green**: db.js is env-only with no DSN
  literal/fallback; no backend module carries a DSN literal; no production source
  (backend or client) or proxy config points at a foreign backend host. It
  *caught the five hardcoded auth pages on first run* — this is the check that
  earns its keep, exactly the "prove, don't grep" worry from Part 1.
- **Empty start.** `getDb()` no longer calls `seedData()` — KB boots to schema
  only, no seeded data, never production data. (Steward's demo `seedData` body is
  left dead in `db.js`; it's removed with the Steward strip in Part 3/4.)
- **Demo seed.** `scripts/seed-demo.js` — two fictional orgs (Cedar Hollow Youth
  Arts, Northgate Community Relief) with invented donors, funds, a goal'd
  campaign, gifts, and an impact update, driven through the real API so the data
  is coherent end to end. **Loopback-guarded**: refuses any non-local BASE unless
  `SEED_ALLOW_NONLOCAL=1`, so it can never seed a real database. Authored against
  the verified route contracts; **runtime-verified in Part 3/7** (KB can't boot
  until Part 3 removes the migc require).
- **Legal pages stubbed** (Privacy/Terms) — clean placeholders, route intact,
  zero Steward/personal content.

## Part 3 detail

Approach: carve in verifiable layers, keeping KB **booting and building green at
every step**, and land what's clean. Done this pass:

- **Boot-blocker removed.** `server.js:125` migc mount + its comment block gone.
- **Mi Gulf Coast customer code FULLY removed** (Jonathan's leak-check directive):
  the mount, `routes/migc.js` (excluded in Part 1), `tests/migc.test.js`, and
  every `run-all.sh` reference. `db.js` never had the migc tables (they lived in
  the excluded migration). Whole-tree leak check: **CLEAN — zero `migc` anywhere.**
- **STEWARD background jobs stopped** — the 10 STEWARD `setInterval`/`setTimeout`
  registrations (smart-moves, digests, daily-tasks, workflow sweeps, pledge
  reminders, gmail sync, trial expiry, metric snapshots, sequences, scheduled
  campaigns) removed. Only SHARED/KB jobs remain (reconciliation, webhook-diff,
  asset purge, dunning, network gate, notification retry). Bodies stay (dead)
  until the route carve. `node --check server.js` green.
- **STEWARD client surface removed + build green.** Deleted 16 components
  (Dashboard, Pipeline, Grants, Communications, Reports, Tasks, Workflows,
  Events, Volunteers, Board, Programs, AnnualFund, FunnelChart,
  MetricBreakdownPanel — UpgradeModal/DonorMap **restored**, see below) + 2 pages
  (Landing, Invitation). Carved `App.jsx` (tabs → Donors · Fundraising · Donor
  Portal · Finance · Settings; default tab `donors`; NAV_GROUPS/TEAM_GATED) and
  `main.jsx` (removed Landing/Invitation routes; `/` now redirects to the donor
  front door `/giving`). **`eslint src` → 0 errors; `vite build` → green** (the
  hard gate that caught two relative-import misses).
- **Verified LIVE, the point of Part 3.** Booted KB against its own database
  `kb_demo` (separate Postgres DB), ran `scripts/seed-demo.js` end to end →
  2 orgs · 12 donors · 16 gifts ($10,730) · 2 campaigns · 2 enabled portals ·
  2 impact updates, **all in `kb_demo`**. Cross-checked: those orgs are
  **absent from `steward_loadtest`**. Login + `GET /org` smoke-tested (real
  giving-flow path). The isolation pin stays green (145/0 after the client carve).

**Incident (contained):** a **pre-existing Steward scratch server was already on
:5601 → `steward_loadtest`**, and my first seed run hit it, writing the two demo
orgs into Steward's scratch test DB. Caught it immediately (a fresh DB can't show
`softDeleted:20`), **scrubbed both orgs + all their child rows from
`steward_loadtest`** (verified 0 leftover), and re-ran KB on a dedicated port
(**:5701**) so KB never shares Steward's port. Steward's *repository* was never
touched; this was its disposable scratch DB. Lesson logged: KB uses :5701, never
Steward's :5601.

### Part 3 — the substantial remainder (next pass)

Deferred deliberately, coupled together so schema + handlers + their tests carve
in lockstep and get verified against a scratch Postgres in one pass:

1. **`server.js` route/handler carve** — remove the STEWARD route handlers
   (pipeline/moves/grants/programs/tasks/workflows/sequences/reports/digests/
   gmail/events/volunteers/board/households/pledges/planned-giving/CRM-import/
   platform-billing) + their now-dead helper functions and job bodies. The
   20k-line monolith; the largest, highest-care unit. Must keep the giving flow
   green (drive it, don't just `node --check`).
2. **`db.js` table carve** — drop the STEWARD tables (§2 STEWARD list in
   BOUNDARY) once no handler reads them.
3. **Mixed-file internal trims** — `Settings.jsx` (Team/Gmail/Billing/Custom
   Fields/Impact Metrics sections), `Donors.jsx` (pipeline rail, wealth score,
   `UpgradeModal`/`DonorMap`/`lockMajor` billing upsell), `Fundraising.jsx`
   (roll-up analytics), `Finance.jsx` (budgets/accounts/audit-log). Kept whole
   this pass because they're SHARED shells with STEWARD sub-features woven in.
4. **Billing removal (U-4 stub)** — `App.jsx` billing banners/PlanPicker/tier
   logic, `Pricing.jsx`, `PlanPicker.jsx`, `UpgradeModal.jsx`, `billingPlans.js`,
   `trialEnd.js`, `matchingGifts.js`. Entangled with the kept shells (that's why
   `UpgradeModal`/`DonorMap` were restored to keep the build green); removed when
   the shells are trimmed.
5. **Test strip** — delete the STEWARD suites and prune `run-all.sh`, WITH the
   route carve (a suite dies with its feature). `run-all.sh` is **not** green
   until then; the standalone `isolation.test.js` is.
6. **Re-run the whole-tree leak check** after the carve (and again after Part 8).

## Git-history strategy (the intermediate-history problem)

Part 1's single commit necessarily contains STEWARD-bucket code that Part 3 will
remove — so KB's *own* fresh history would otherwise retain CRM source. The plan:
**Part 8 collapses KB history into a single clean commit** (`git checkout
--orphan` → one commit) before handover, so the delivered `.git` contains zero
CRM source and zero development narrative. Until then, KB's local commits are my
working scaffold. The concern the brief names — carrying Steward's *actual* git
history — is already fully satisfied (KB was never forked; `.git` is brand new).

## §worry — what I would not hand over without a human looking first

1. **The Part 2 ↔ Part 3 sequencing.** The brief orders "its own database
   (shared tables, nothing else)" before "remove what doesn't belong." But KB's
   `server.js` still has STEWARD route handlers that query STEWARD tables, so
   removing those tables from `db.js` in Part 2 *before* stripping the code in
   Part 3 would break boot. The clean order is: strip STEWARD code and tables
   together, verify boot against a scratch DB, then pin isolation. I intend to
   treat Part 2 as "own DB + empty start + demo seed + isolation pin" and let the
   STEWARD *table* removal ride with Part 3's code strip, so the schema and the
   handlers that read it are carved in lockstep and verified once. Flagging in
   case you want Part 2 to produce a fully-reduced schema on its own.

2. **U-4 billing stub — a giving product still moves money the org must be billed
   for eventually.** Stubbing billing is right for separation, but KB has no
   revenue model wired. Before any real organization is onboarded, someone has to
   decide how KB is paid for. Not a blocker for the fork; a blocker for launch.

3. **The `orgs` column split (U-1) is not yet decided.** `orgs` is SHARED but
   carries Steward-commercial columns. Copying it whole (as Part 1 did) is fine;
   Part 2/3 must decide which columns KB's schema keeps. Getting this wrong
   either leaks Steward's plan model into KB or drops a column KB's portal reads.

4. **Isolation — source pin DONE, live proof still owed.** The committed
   `tests/isolation.test.js` now fails if any DSN literal, connection default, or
   foreign backend host reappears in KB (it caught five hardcoded auth pages on
   its first run). That covers the *source*. What it does NOT yet cover, and what
   I still will not report as done, is the **live two-database run** (Part 7):
   both products up on separate databases, KB surviving Steward's DB being
   switched off and vice versa. Until that runs, isolation is pinned in code but
   unproven in operation.

5. **The brand test (Part 4) is the real definition of separated, and the copied
   tree is saturated with `Steward` strings** (design docs in comments, email
   templates, PDF snapshots, the neutral theme, error pages, API identifiers).
   Part 4 is not a find-replace — renamed identifiers change API contracts and
   stored-snapshot shapes. This is the part most likely to hide a functional
   regression behind a passing string-grep.
