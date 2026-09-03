# BUILD-66 — RESUMPTION BRIEF

Cold-start pointer for continuing the Kingdom Builders separation. Read this +
`audit/BUILD-66-BOUNDARY.md` (the KB/STEWARD/SHARED classification) and you have
enough to pick up without the chat history. Running narrative + decisions +
§worry live in `audit/BUILD-66-FINDINGS.md`.

## BUILD-67 addendum (2026-08-27) — the donor's first five minutes

Shipped in the KB fork (`~/kingdom-builders`), report `audit/BUILD-67-FINDINGS.md`.
What changed that affects this cold-start recipe:
- **`bash tests/run-all.sh` is now 38 KB/SHARED suites (was 35), 0 failed** — added
  `portal-verify` (the magic-link entry contract). Same boot env as below.
- **The client build was BROKEN at the fork and is now fixed.** `client/package.json`'s
  `build`/`brand-guard` pointed at `../tests/brand-allowlist.test.js`, a Steward-era
  file absent in the fork, so `npm run build` (and any Vercel deploy) failed. Both
  now point at the KB brand wall `tests/no-steward.test.js`. `npm run build` is green.
- **Donor sign-in links are 60 minutes** (was 15) and every failure state (expired /
  used / superseded / unreadable) is messaged with a one-tap resend — the org-portal
  magic link (`/portal/:slug/verify`) AND the `/giving` account sign-in link
  (`/account/link-verify`). One expiry rule across the product.
- **Walkthrough mail-log path** (SETUP.md, dev-mocks): captured email lands in
  `/tmp/kb-walk-mail.log` (SETUP previously said `/tmp/kb-mail.log`; corrected).

## Where things are

- **Two repos.** Steward = `~/nonprofit-erp` (the fork SOURCE — do not edit for
  the separation). Kingdom Builders = `~/kingdom-builders` (the new product).
- **KB HEAD:** `8da7e74` ("BUILD-66 schema drop: leak-sweep + verification").
  **KB has NO git remote** (`git remote` is empty) and must stay that way until
  Part 8.
- **`bash tests/run-all.sh` is GREEN — 35 KB/SHARED suites, 0 failed.** Boot with
  the KB env + STRIPE_API_BASE=:5603 (below); run on a fresh `kb_test`.
- **PART 3 IS COMPLETE (2026-08-27).** test strip ✓ · dead bodies ✓ · U-4 billing
  (server + client) ✓ · guards restored ✓ · **schema drop ✓** (db.js STEWARD
  tables + U-1 orgs split — 82→45 tables, −6 orgs cols; diff + couplings in
  `BUILD-66-FINDINGS.md` §"Schema drop — DONE"). Verified: run-all 35/0,
  org-blindness 54/0, tenant-isolation 18/0, `drive-giving.js` green end-to-end,
  migc grep 0. **Next: Parts 4–8** (rebrand/no-"Steward"-string, external-services
  config, guards-travel confirmation, two-DB proof, handover packet). Note for
  Part 4: an orphaned-STEWARD-route carve + several `Steward`-string leaks are
  logged in FINDINGS §"Known follow-up".
- **KB server.js:** ~204 `app.*` routes remain. **~153 STEWARD routes carved**
  (chunk-1 51 · Donors 55 · Gmail 7 · campaign send 2 · board/financials 4 ·
  Finance+grants 16 · customization+onboarding 13 · billing 5). Every carve
  verified with a live giving-flow drive.
- **No live STEWARD behavior remains, and the dead bodies are DELETED:** no
  STEWARD route reachable, no STEWARD job registered, money path decoupled, and
  the 28 dead helper/job functions (fireWorkflows/processSequences/autoEnroll/
  syncGmail/etc.) + WORKFLOW_RECIPES consts are removed (−57KB). KB boots/builds/
  drives green.
- **Test strip DONE:** 76 STEWARD suites deleted; the 33 KB/SHARED suites trimmed
  of carved-route assertions where needed (portal staff-list, gift-idempotency
  F-4/F-5, mail-suppression campaign-send, session-privilege pipeline; giving-
  flow-brand From domain-agnostic; tenant-isolation + first-login-matrix +
  external-fixture-provenance deleted as mostly-STEWARD). `run-all.sh` CORE = the
  33 kept. portal-visual kept as a file, excluded from CORE (browser-env).
- **Billing (U-4) — server + App shell DONE:** `/billing/*` + `/admin/billing-
  diagnostic` carved; `billingPlans.js`/`trialEnd.js`/`matchingGifts.js` deleted;
  App.jsx billing banners/PlanPicker/tier removed (`isReadOnly`/`isCoreTier` now
  false). **Remaining billing-client cleanup:** Settings "Billing" section
  (contained, ~1294–1411 + state/openBillingPortal/isReadOnly→false), `Pricing.jsx`
  (+ its `/pricing` route in main.jsx), `PlanPicker.jsx` (now unimported),
  `UpgradeModal.jsx` (Settings-only), `SignupPage.jsx` `/billing/create-checkout`,
  `shared.jsx` `goToPricing`/`LockedFeature`/`LockGlyph` (unused after Team-gate
  removal), `api.js` `billingErrorMessage`. All vestigial (build green; they call
  carved routes that 404) — clean up then the stub is complete.
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

## ✅ DONE (2026-08-27) — THE SCHEMA DROP: db.js STEWARD tables + U-1

**Completed.** Executed exactly as the procedure below prescribes (small groups,
`run-all` after each, plain DROP only / never CASCADE, FK columns first). Result +
before/after diff + the couplings the net caught are in `BUILD-66-FINDINGS.md`
§"Schema drop — DONE". The procedure notes below are retained as the historical
record of how it was run.

Everything else in Part 3 is DONE (test strip, dead bodies, U-4 billing server+
client). This was the LAST Part-3 step and the one most likely to break something
quietly — hence its own session. **The green `run-all.sh` (35/0) is its net: run
it before you start and after every drop.**

### The procedure (non-negotiable — this is why it has the net)
Drop tables in SMALL groups, and **after each group: boot + `bash tests/run-all.sh`.**
A kept suite that goes red = the net catching a real coupling (a cleanup list
DELETEs from the dropped table, or a kept handler/FK still references it). Fix
that (trim the cleanup list / drop the referencing column first), get green,
then the next group. Never drop the whole set blind.

### FK dependencies FIRST (the quiet-breakage trap)
Several KEPT tables carry columns that FK into STEWARD tables — dropping the
STEWARD table fails, or (worse) a `DROP … CASCADE` silently takes data with it.
Before dropping, drop the referencing COLUMN (or its FK) on the kept table:
- `gifts.pledge_id` → pledges · `gifts.recurring_subscription_id` stays (KEEP).
- `donors.household_id` → households · `donors.assigned_to`/`assigned_to_name` →
  (users, kept, but these are portfolio-officer fields — drop the columns).
- `fin_transactions.grant_id` → grants (drop the column) · `.gift_id`/`.fund_id`
  stay.
- `campaigns.parent_goal_id` stays (campaigns kept); check no FK to fundraising_goals.
Grep each dropped table for inbound FKs (`REFERENCES <table>`) in db.js first.

### STEWARD tables to DROP (from BOUNDARY §2)
moves · opportunities · households · donor_relationships · donor_designations ·
planned_gifts · pledges · grants · grant_interactions · programs · program_grants ·
tasks · workflows · workflow_runs · sequences · sequence_steps ·
sequence_enrollments · milestone_drafts · note_reminders · fundraising_goals ·
annual_fund_goals · custom_fields · custom_field_values · metric_snapshots ·
board_members · board_reports · events · event_attendees · volunteers ·
campaign_recipients · gmail_connections · gmail_sync_exclusions · digest_sends ·
financials · funds (legacy) · ai_log · billing_webhook_events · invitation_requests ·
demo_requests. (migc_* were never in KB's db.js.)

### KEEP — do NOT drop (SHARED/KB spine)
orgs · users · donors · gifts · fin_funds · accounts · fin_transactions ·
fin_audit_log · campaigns · receipts · recurring_subscriptions ·
recurring_change_log · recurring_proposals · payment_recovery_events ·
portal_* (assets/audit_log/magic_links/pages/sessions/settings) · impact_updates ·
giving_pages · peer_fundraisers · donor_account*/donor_org_follows ·
network_applications · ein_registry · email_suppressions · notification_failures ·
notification_sends (dunning/recovery alerts use it) · invites (Team — KEPT) ·
password_reset_tokens · dispute_reversals · schema_meta · budgets? (check —
Finance funds editor doesn't use it; likely drop with the finance-ledger set).

### U-1 — orgs column split (NUANCED — do not drop all commercial-looking cols)
- **DROP** (Steward commercial): `subscription_status`, `stripe_customer_id`,
  `stripe_customer_id_test`, `trial_ends_at`, `grace_until`, `current_period_end`.
- **KEEP** `plan` — KB's shell reads `org.plan==="portal"` for the portal-tier
  gate (App.jsx). **KEEP** `recurring_dunning_enabled`/`_subject`/`_body` —
  dunning is SHARED and live. KEEP the receipt/tax + network_listed + cover_fees +
  Gmail-token? (gmail dropped → drop `gmail_*` org cols if any) columns.
- Also drop the `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` env from SETUP/README
  (orphaned by the Gmail carve).

### Known coupling the net WILL flag (pre-warned)
- `tests/session-privilege.test.js` cleanup list DELETEs from STEWARD tables →
  trim it when those drop.
- `tests/tenant-isolation.test.js` reset lists `pledges` (guarded by `.catch()`,
  so it survives) — but drop the line for cleanliness.
- The demo seed (`scripts/seed-demo.js`) touches only kept tables — safe.

### Done when
Boot + `scripts/drive-giving.js` green + `run-all.sh` 35/0 green + a whole-tree
leak check (`migc` + no dropped-table reference in a kept handler). Then Part 4.

## (historical) earlier tail plan — superseded by the above

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
