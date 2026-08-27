# BUILD-66 — RESUMPTION BRIEF

Cold-start pointer for continuing the Kingdom Builders separation. Read this +
`audit/BUILD-66-BOUNDARY.md` (the KB/STEWARD/SHARED classification) and you have
enough to pick up without the chat history. Running narrative + decisions +
§worry live in `audit/BUILD-66-FINDINGS.md`.

## Where things are

- **Two repos.** Steward = `~/nonprofit-erp` (the fork SOURCE — do not edit for
  the separation). Kingdom Builders = `~/kingdom-builders` (the new product).
- **KB HEAD:** `42fd0dc` ("Part A (App bulk-load) …"). **KB has NO git remote**
  (`git remote` is empty) and must stay that way until Part 8.
- **KB server.js:** 238 `app.*` routes remain. **119 STEWARD routes carved so
  far** (tallied per commit): chunk-1 orphans 51 · Donors-orphans 55 · Gmail 7 ·
  campaign send 2 · board/financials 4. Every carve verified with a live giving-
  flow drive (below) — never `node --check` alone.
- **Steward:** the identity guard (`/health.product`+`database`; write scripts
  assert both) is LIVE in prod and its battery is green (104/0). `scripts/status.js`
  (`npm run status`) is the deploy drift-check. Steward is otherwise untouched by
  the separation.

### Done so far (KB)
- Part 1: fresh repo, no history, no archaeology.
- Part 2: own-DB config, empty start, `scripts/seed-demo.js` (2 fictional orgs),
  `tests/isolation.test.js` (pins no foreign DB/backend reach).
- Part 3: STEWARD client surface removed (16 components + Landing/Invitation
  pages), background jobs stopped, migc customer code fully gone. `/` → `/giving`.
- **U-2 (B): Donors replaced** with a lean org-admin donor screen
  (`components/Donors.jsx`, 344 lines: find · identity · gift history · receipts ·
  year-end · recurring status · add/edit · log offline gift). Pinned by
  `tests/donors-lean.test.js` (21/0).
- **U-6: reports dropped** (dead handler cluster deleted; `/fundraising/overview`
  answers "what did we raise").
- **U-9: campaign send** carved (`/campaigns/:id/{send,briefing}`); `/campaigns`
  CRUD + `/progress` kept (giving-page campaigns).
- **Part A App bulk-load:** dead `buildContext` removed; App load + `adaptData`
  trimmed to org/donors/grants; `/board` + `/financials*` carved.
- **Decisions banked:** U-8 → KB (staff recurring stays). U-4 → billing stubbed
  (STEWARD). U-6 → dropped. **Team STAYS in KB** (org-admin invite — a staff
  departure must not orphan the org; the portfolio-officer layer still goes).

## NEXT UNIT — Finance mgmt + grants (a full pass)

`client/src/components/Finance.jsx` is **1,401 woven lines** with 6 SectionTabs
(overview · transactions · funds · budgets · accounts · audit). Trim it to a
**FUNDS EDITOR per U-5.**

**Target shape (this is the bar):** a clean **funds editor** — create/edit funds
(`GET/POST/PUT /finance/funds`) **plus the money-in view** (the Stripe balance +
payouts strip, `GET /finance/stripe-summary`). **The target is a funds editor,
not a reduced Finance tab — if it reads as a Finance tab with pieces missing,
it's wrong.** Treat it like the Donors B pass: build the right screen, likely a
near-rewrite, not four subtabs deleted leaving a stub.

**Drop:** Transactions (ledger), Budgets, Accounts, Audit Log subtabs; the AI
6-month forecast / risk analysis (`askClaude`/`AIBtn`/`AIPanel` — Finance is
their only kept caller); the grant entity-routing in `TransactionModal`
(`financeMatch.js`, `/grants/:id/manual-match`, `data.grants`); and the **TopBar
grant search**.

**Then carve** (acorn tool, see below):
- `/finance/accounts` (GET/POST) + `/finance/accounts/:id` (PUT)
- `/finance/budgets` (GET/POST)
- `/finance/audit-log` (GET)
- `/finance/transactions` (GET/POST) + `/finance/transactions/:id` (DELETE)
- `/grants` (GET/POST) · `/grants/:id` (GET/PUT/DELETE) · `/grants/:id/manual-match`
  (GET) · `/grants/:id/interactions` (POST)  — **but first** remove App.jsx's
  `/grants` fetch + `adaptData.grants` + TopBar search + Finance's `data.grants`
  use, or App's bulk load keeps it live.
- **KEEP:** `/finance/funds*`, `/finance/stripe-summary`, `/finance/summary`.

**⚠ GOTCHA — update the drive first.** `scratchpad/drive-giving.js` step 5
verifies the ledger stamp by reading `GET /finance/transactions`, which THIS UNIT
CARVES. Before carving `/finance/transactions`, change the drive's designation
check to another signal (fund-balance delta via `/finance/funds`, or a direct
`psql` query on `fin_transactions`) — otherwise the drive false-fails.

Expected orphan count: ~9 routes (finance ~5 + grants ~4).

## REMAINING UNITS after Finance (with expected orphan counts)

1. **Customization + WelcomePage onboarding** — trim Settings' Custom Fields +
   Impact Metrics AND rewrite WelcomePage to lean KB onboarding (drop the goal /
   metric / portfolio-invite steps). Orphans: `/custom-fields*` (~3),
   `/impact-metrics*` (~2), `/goals*` (~2), `/portfolio/officers*` (~2). The
   portfolio-officer layer goes here.
2. **Dead job/helper bodies** — `fireWorkflows`, `processSequences`/`autoEnroll`,
   `syncGmail`/`syncAllGmail` + the gmail OAuth helper, `processScheduledCampaigns`
   body, the recurring dead report helpers — call-graph cleanup (interconnected;
   do WITH the db.js drop).
3. **`db.js` STEWARD table drop** — drop the §2-STEWARD tables (pipeline/moves/
   opportunities/households/pledges/planned/designations/grants/programs/tasks/
   workflows/sequences/milestones/notes/board/events/volunteers/gmail_*/
   campaign_recipients/digest_sends/…) once no handler reads them. Plus the
   `GOOGLE_*` env (orphaned by Gmail) and **U-1** (the `orgs` Steward-commercial
   column split: drop plan/subscription/stripe_customer/recurring_dunning cols,
   keep money/portal/receipt/network cols).
4. **U-4 billing stub** — remove `/billing/*`, PlanPicker, `billingPlans.js`,
   `trialEnd.js`, `matchingGifts.js`, LockedFeature tier logic.
5. Then **Part 4** (rebrand / no-`Steward`-string), Parts 5–8.

**Still-OPEN UNCLEARs to action as their unit lands:** U-1 (orgs cols → db.js
drop), U-4 (billing stub), U-5 (Finance = funds editor, THIS unit), U-7
(Fundraising: lean campaign editor kept, roll-up analytics trim — check when
touched), U-11 (Settings split — customization unit), U-12 (KB AdminDashboard
rebrand at Part 4), U-13 (KB authors own onboarding email — WelcomePage unit).
Full status table in FINDINGS.

## STANDING RULES (non-negotiable)

- **Fork, not move. Steward loses nothing and is NOT edited** for the separation
  (the sole exception was the identity guard, which Jonathan explicitly directed
  into both repos and which is now shipped). If a KB change seems to require
  editing Steward, the design is wrong — stop and write it in FINDINGS.
- **trim → carve → drive.** Trim the client feature across every component that
  uses it, carve the now-orphaned routes, then **reboot and drive the real giving
  flow** (`scratchpad/drive-giving.js`). Report the route count per feature. Keep
  the client build green (`eslint src` 0 errors + `vite build`) at every step.
- **NO git remote on KB until Part 8's history collapse.** Intermediate commits
  contain CRM source; once on a remote a local orphan-collapse can't remove them.
- **Leak check after the strip and again after the rebrand** — the migc customer
  code and the `Steward` string must never reach the delivered tree/history.
- **org-blindness is the one assertion that can't be wrong.** Re-verify on the
  real two-database run at Part 7, not just the clean-DB run.

## HOW TO RUN THINGS

- **Scratch Postgres:** `/tmp/steward-test-pg`, port **5544**, user `steward`.
  Lives in `/tmp` — a reaper corrupted it once; rebuild:
  `initdb -D /tmp/steward-test-pg/data -U steward -E UTF8 --no-locale` →
  `pg_ctl -D /tmp/steward-test-pg/data -o "-p 5544" -l /tmp/steward-test-pg/pg.log start`.
  DBs: `kb_demo` (seed target), `kb_test` (clean, for wall tests). `createdb -h
  localhost -p 5544 -U steward <name>` as needed. PATH:
  `/opt/homebrew/opt/postgresql@16/bin`.
- **Boot KB** (schema self-creates on boot; note STRIPE_API_BASE=**5603**, the
  network-gate mock port — NOT 5703):
  ```
  DATABASE_URL=postgresql://steward@localhost:5544/kb_demo DB_SSL=disable \
  JWT_SECRET=local-test-secret PORT=5701 DISABLE_RATE_LIMIT=1 SESSION_CACHE_TTL_MS=0 \
  RESEND_API_KEY=re_dummy_local RESEND_BASE_URL=http://localhost:5602 \
  DEMO_SMTP_FROM=noreply@example.org STRIPE_SECRET_KEY=sk_test_dummy \
  STRIPE_WEBHOOK_SECRET=whsec_localtest STRIPE_API_BASE=http://localhost:5603 \
  DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1 DISABLE_BACKGROUND_TICKS=1 \
  node server.js
  ```
  Kill by listener: `lsof -tiTCP:5701 -sTCP:LISTEN | xargs -r kill` (NOT
  `pkill -f PORT=5701` — env assignments aren't in argv).
- **Seed demo:** `BASE=http://localhost:5701 EXPECT_DB=kb_demo node scripts/seed-demo.js`
  (identity-guarded — refuses a non-KB or wrong-DB target).
- **Drive giving flow:** `BASE=http://localhost:5701 node scripts/drive-giving.js`
  (committed to KB now; identity-guarded) — logs in, enables receipts, designated
  gift → ledger stamp (fund match) → receipt → real PDF → donor lifetime → public
  reads. **(Update its step-5 — the `GET /finance/transactions` ledger check —
  before carving /finance/transactions; see the Finance gotcha above.)**
- **Wall/boundary tests** (run on CLEAN `kb_test`, server booted with
  STRIPE_API_BASE=5603): `org-blindness` (54/0), `network-gate` (34/0),
  `donors-lean` (21/0), `isolation` (~146/0). `BASE=… DATABASE_URL=…kb_test
  DB_SSL=disable node tests/<name>.test.js`.
- **acorn route-carve tool:** pattern in `<scratchpad>/carve-*.js` — parse
  server.js with `require('~/kingdom-builders/node_modules/acorn')`, match
  `app.<method>("<path>")` ExpressionStatements against a REMOVE set, splice out
  exact spans back-to-front (eat the trailing `\n`). Dry-run, then `APPLY=1`. Use
  exact spans — a brace/paren counter miscounts on parens inside SQL strings.
- `scripts/drive-giving.js` is committed to KB. The acorn carve helper is
  ephemeral (per-carve REMOVE set) — recreate it in the session scratchpad from
  the pattern above.
