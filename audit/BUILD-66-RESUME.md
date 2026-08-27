# BUILD-66 — RESUMPTION BRIEF

Cold-start pointer for continuing the Kingdom Builders separation. Read this +
`audit/BUILD-66-BOUNDARY.md` (the KB/STEWARD/SHARED classification) and you have
enough to pick up without the chat history. Running narrative + decisions +
§worry live in `audit/BUILD-66-FINDINGS.md`.

## Where things are

- **Two repos.** Steward = `~/nonprofit-erp` (the fork SOURCE — do not edit for
  the separation). Kingdom Builders = `~/kingdom-builders` (the new product).
- **KB HEAD:** `997a182` ("Dead bodies (part 2) …"). **KB has NO git remote**
  (`git remote` is empty) and must stay that way until Part 8.
- **KB server.js:** ~209 `app.*` routes remain. **148 STEWARD routes carved so
  far** (per commit): chunk-1 51 · Donors 55 · Gmail 7 · campaign send 2 ·
  board/financials 4 · Finance+grants 16 · **customization+onboarding 13**. Every
  carve verified with a live giving-flow drive (below) — never `node --check`.
- **No live STEWARD behavior remains:** no STEWARD route is reachable, no STEWARD
  background job is registered (all remaining ticks are SHARED/KB — dunning,
  reconciliation, asset purge, network gate, notification retry), and the money
  path (gift route + webhook + dunning) no longer calls fireWorkflows/
  autoUnlapse/recordAutoMove/calcWealthScore. KB boots/builds/drives green.
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
- **Part A App bulk-load:** dead `buildContext` removed; `/board` + `/financials*`
  carved.
- **U-5 (Finance) DONE:** `Finance.jsx` rewritten 1,401 → ~230 lines as a **funds
  editor** (money-in + funds create/edit, balances from `/finance/summary`).
  `/grants` removed from App/adaptData/TopBar; `financeMatch.js` deleted; 16
  routes carved (`/finance/{accounts,budgets,audit-log,transactions}` + `/grants*`).
- **Decisions banked:** U-8 → KB (staff recurring stays). U-4 → billing stubbed
  (STEWARD). U-6 → dropped. U-5 → funds editor (done). **Team STAYS in KB**
  (org-admin invite — a staff departure must not orphan the org; the
  portfolio-officer layer still goes with the WelcomePage unit).

## NEXT — finish Part 3's tail (units 3–5 + dead-body deletion)

Customization + WelcomePage is DONE (WelcomePage rewritten as signup→live-portal
onboarding: basics → theme → fund → publish → shareable link; drove clean). The
"dead bodies" unit is HALF done — all live STEWARD behavior is decoupled (jobs +
money-path calls gone) — but the dead FUNCTION BODIES themselves still sit in
server.js, uncalled. Remaining, in this order:

1. **Delete the dead function bodies** — now safely uncalled (verified: no live
   caller). The cluster: `fireWorkflows`, `ensureWorkflows`, `WORKFLOW_RECIPES`,
   `processWorkflowSweeps`, `processSequences`, `autoEnroll` (+ milestone/sequence
   helpers), `processDigests`/`runDigestsForOrg`/`composeWeekInReview`/
   `composeOfficerMonthly`, `processDailyTaskReminders`, `processScheduledCampaigns`,
   `processSmartMoves`/`autoLapseOrg`/`autoUnlapseOnGift`/`recordAutoMove`/
   `computeMoveSuggestions`, `calcWealthScore`, `syncGmail`/`syncAllGmail`/
   `makeOAuth2Client`, `snapshotMetricsForOrg`/`snapshotAllOrgMetrics` +
   stewardship-debt/first-touch helpers. Also delete the 8 empty
   `if(!backgroundTicksDisabled()){}` husks. Use acorn to find each function
   declaration's span; confirm 0 external call-sites first; drive after.
2. **U-4 billing stub** — remove `/billing/*`, PlanPicker, `billingPlans.js`,
   `trialEnd.js`, `matchingGifts.js`, LockedFeature tier logic. DO THIS BEFORE U-1
   (U-1 drops the orgs columns billing reads).
3. **`db.js` STEWARD table drop + U-1** — drop the §2-STEWARD tables (pipeline/moves/
   opportunities/households/pledges/planned/designations/grants/programs/tasks/
   workflows/sequences/milestones/notes/board/events/volunteers/gmail_*/
   campaign_recipients/digest_sends/…) once no handler reads them. Plus the
   `GOOGLE_*` env (orphaned by Gmail) and **U-1** (the `orgs` Steward-commercial
   column split: drop plan/subscription/stripe_customer/recurring_dunning cols,
   keep money/portal/receipt/network cols).
4. **Test strip** — delete the STEWARD test suites (they reference carved routes
   and are red now) + prune `tests/run-all.sh` to the KB-relevant battery
   (org-blindness, network-gate, donors-lean, isolation, portal*, donor-accounts/
   -linking/-dashboard, network-directory, gift-idempotency, reconciliation,
   webhook-*, guards, theme-assets, asset-retention, recurring-surface, giving-*,
   portal-crop/-contrast/-visual, …). Goal: `bash tests/run-all.sh` GREEN.
5. Then **Part 4** (rebrand / no-`Steward`-string), Parts 5–8 (the second run).

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
