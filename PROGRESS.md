# Steward — Build Progress

## Demo account
- URL: https://client-five-tau-13.vercel.app (also stewardapp.dev)
- Login: admin@creoarts.org / demo1234 (org_creo)

## Stack
- Frontend: React 18 + Vite → Vercel
- Backend: Node + Express → Railway
- DB: Supabase PostgreSQL
- Email: Resend (noreply@stewardapp.dev)
- Payments: Stripe Connect Express
- AI: claude-sonnet-4-6

---

## DONE & VERIFIED

- Combined import (Shape A: one wide file, donor cols + year-gift cols) — POST /donors/import-combined. Creates donors + attaches gifts + touchpoints in one pass, bulk inserts, dedup by fingerprint. VERIFIED working: 300 donors/934 gifts imported, dedup on re-import shows 0/0/50-skipped (no double-count), totals/profiles/timeline all correct.
- Three extractions done (parseFileToSheets, buildAutoMapping, buildDonorRows) — regular Import + Giving History still work.
- Finance wiring: imported gifts in current FISCAL year sync to fin_transactions (dedup-safe, only non-duplicates). Finance Donor Giving tab shows imported gifts. VERIFIED.
- Finance fiscal/calendar toggle — VERIFIED working (FY shows $310.1k, Calendar shows $0 because test gifts are dated Dec-2025 = fiscal-2026 but calendar-2025). Labels + date-range subtitle swap correctly.
- Donor `status` (giving-tier) promotion after import ($20k→major, $5k→mid) — committed.
- Wealth scores: intentionally left on-demand (not auto-recalc'd on import).

---

## KNOWN BUG — STAGE INFERENCE NOT WORKING (TOP PRIORITY NEXT SESSION)

After import, all donors still show stage 'prospect' in My Pipeline + Analytics Pipeline Velocity, even $60k donors that should be 'cultivate'. The status (tier) update may have worked but the STAGE (pipeline) update did not take.

**Leading hypothesis:** the combined-import INSERT writes new donors with a stage value that is NOT the literal string 'prospect' (possibly NULL or 'cultivate' from an insert-time inferStage call with no gift data). The post-recalc stage UPDATE has guardrail `WHERE stage='prospect'`, so it matches ZERO rows. The UI displays "Prospect" only because the Kanban falls back to prospect when stage is NULL/unset — the stored value differs from the displayed value, so the guardrail misses.

**Next step:** cat the stage-inference block in POST /donors/import-combined. Report (a) does it exist in committed code, (b) what stage value the new-donor INSERT actually writes, (c) the UPDATE's WHERE clause, (d) whether it reads recalculated total_giving/last_gift_date. Fix direction: for NEWLY-CREATED donors, run stage inference regardless of the prospect-only guardrail (no human placement to protect on brand-new records). The guardrail (only touch stage='prospect') should apply ONLY to the history-only importer that touches EXISTING donors. We conflated new-donor vs existing-donor guardrail rules.

---

## OTHER PENDING (none blocking, none urgent)

1. UI: consolidate three import buttons (Import / Giving History / Import + History) into ONE "Import" dropdown with three options. Pure polish, no logic change.
2. Favicon revert to old dark-green-square no-gold-bar version (prompt was written earlier, deferred).
3. CREO test-data cleanup: run `DELETE FROM donors WHERE org_id='org_creo' AND email LIKE '%@example.com';` to clear ~800+ .combo/.final test donors and restore the ~7 real demo records.
4. /gifts/import-history still has per-row insert N+1 (minor speed; combined route is already bulk).
5. Combined import Shape B (separate donor file + gift file chained) — deferred.

DONE (was item 6): Expired-token UX — see "Auth, Gmail, billing/Reactivate, and QA-sweep fixes" below.
6. QA sweep (2026-07-10, `QA_REPORT.md`) was discovery-only — nothing was fixed as part of it. Two Blocking findings not confirmed resolved: #1 signup mobile overflow, #2 `checkWriteAccess`/read-only gaps across Volunteers/Tasks/Events/Campaigns/Custom Fields/Board Members. Spot-check during the 2026-07-12 docs pass confirmed `checkWriteAccess` IS present server-side on volunteers/tasks/events POST routes, but the client-side button-disabling and the signup mobile CSS were not re-verified — treat both as possibly still open.
7. Data integrity check requested (orphaned orgs after manual Supabase row deletion, specifically `org_ec6340db`, plus dangling FK refs to deleted user IDs) — diagnostic tooling built (`GET/POST /admin/data-integrity`, see below) but never actually run against production; blocked on missing super-admin credentials in that session.

---

## Earlier sessions (for reference)

### Security sweep, strategic pivot to a retention product, and onboarding rebuild (2026-07-10 – 2026-07-12)

Three back-to-back efforts, in order: (1) a full security audit turned up and fixed 6 org-scoping bugs (4 CRITICAL, 2 lower) plus webhook/rate-limit/Sentry gaps; (2) a strategic pivot away from a proposed donor-facing gamified portal toward a staff-facing retention/stewardship engine, plus the AI chatbot's removal; (3) an onboarding rebuild so new orgs finish setup with real data instead of a blank slate. Commits `f8a226f`..`7e6fb03`.

**Security fixes (2026-07-10, commits `f8a226f`..`f328d55`)** — an audit found and fixed 6 org-scoping/data-isolation bugs, 4 of them CRITICAL:
- **CRITICAL — `server.js` `POST /sequences/:id/enroll` + `GET /sequences/:id/enrollments`**: never verified `donorId` belonged to the caller's org before enrolling; the enrollments read then JOINed to `donors` with no org filter, leaking another org's donor name/email. Fixed both sides (write-side org check + read-side JOIN filter).
- **CRITICAL — `server.js` `/billing/webhook`**: registered *after* the global `express.json()` middleware, so its own `express.raw()` was a silent no-op — every real Stripe billing webhook (`checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`) had been rejected with 400 for however long this persisted, meaning `subscription_status`/`plan`/`grace_until` stopped syncing from Stripe automatically in production. Fail-closed (nothing fake got accepted), but needs manual reconciliation against the Stripe dashboard for any org whose billing status looks stale. Fixed by relocating the handler before the global JSON parser, alongside `/stripe/webhook` and `/resend/webhook`.
- **CRITICAL — `server.js` `PUT /events/:id`**: UPDATE was org-scoped but never checked affected-row-count, and the follow-up SELECT that builds the response had no org filter — a guessed event ID from another org returned that org's full event record. Fixed: 404 on zero affected rows, plus org-scoped the re-fetch.
- **CRITICAL — `server.js` `POST /donors/:id/custom-fields` + `GET /donors/:id/custom-fields`**: write never verified the donor belonged to the caller's org; read-side JOIN had no `org_id` filter either, so a planted cross-org value would render in the victim org's own donor profile. Fixed both sides.
- **`server.js` `POST /gmail/send`** (GAP): accepted `donorId` from the request body with no org check, and `GET /donors/:id`'s interactions query was the only interactions read in the codebase with no `org_id` filter — combined, a sender could plant an interaction with attacker-controlled text into a different org's donor timeline. Fixed both the write-side ownership check and the read-side scoping.
- **`server.js` `POST/DELETE /programs/:id/grants` + `GET /programs`** (GAP): link route never verified `grantId` belonged to the caller's org; the JOIN in `GET /programs` had no org filter; delete had no org check at all. Fixed all three.
- **`server.js` `POST /billing/create-checkout`, `POST /billing/create-portal`, `PATCH /orgs/:id`** (GAP): `requireAuth`-only, letting any staff-level user open the Stripe portal or edit org settings. Added `requireAdmin`, matching every other billing/org-settings route.
- **`server.js` `POST /donors/:id/materials`** (GAP): no server-side size/MIME validation — the "base64 <1MB" convention was client-only. Also closed a latent stored-XSS path: `file_type` was stored verbatim and the frontend's `viewMaterial()` opens it as a `Blob` with that MIME type — only inert today because the read routes happen to exclude `file_data`, an accidental protection that a future "fix" to the unrelated "View does nothing" bug could silently undo. Added a MIME allowlist (rejects `text/html`/`image/svg+xml` and anything else) and a real server-side size check, closing the gap at the point untrusted data enters rather than relying on the accident downstream.
- All 8 fixes verified via scripted tests booting the real `server.js` against a mocked store — cross-org attempts confirmed rejected (404) and confirmed to plant no data; legitimate same-org operations confirmed still working.
- **`server.js`** — `app.set("trust proxy", 1)` (correct client IP behind Railway's single edge hop) + `express-rate-limit` on `/auth/login` (stacked per-IP + per-account+IP), `/auth/register`, `/auth/register-org`, `/auth/forgot-password`, `/auth/reset-password`, `/donate/:orgSlug`, plus a loose global baseline (excludes `/health` and webhooks). CORS_ORIGIN now defaults to a known-origin allowlist instead of `"*"` when unset (fail-closed).
- **`server.js`** — CORS hotfix, two rounds: the fail-closed default above initially omitted `www.stewardapp.dev` (`c865ece`, production outage), then a deeper bug was found — the original logic let `CORS_ORIGIN` fully *replace* the default allowlist rather than add to it, so whatever value Railway had it set to was silently locking out all three real production origins (`9e6f4e1`, second production outage same day). Fixed so `CORS_ORIGIN` can only add extra origins, never remove the baseline production list.
- **`server.js`, `client/src/main.jsx`, `vite.config.js`** — Sentry gaps closed: `process.on("uncaughtException"/"unhandledRejection")` added right after `Sentry.init()` as a backstop for background jobs (Gmail sync, `processSequences`, `checkTrialExpiry`) that never flow through Express's error handler; `@sentry/vite-plugin` added for client source-map upload at build time, gated on `SENTRY_AUTH_TOKEN` so an untokened build generates no maps at all rather than generating-then-stripping them. New env vars: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (plus previously-undocumented `SENTRY_DSN`/`VITE_SENTRY_DSN`).
- **`server.js`, `db.js`** — new email suppression system: `email_suppressions` table (org-scoped for donor unsubscribes, global `org_id=null` for bounces/complaints, protecting the shared `stewardapp.dev` sending domain's reputation across all orgs); signed HMAC no-login unsubscribe tokens (`GET /unsubscribe` confirmation page, `POST /unsubscribe` supports RFC 8058 one-click); every campaign/sequence email now carries a real unsubscribe link + `List-Unsubscribe`/`List-Unsubscribe-Post: One-Click` headers; `POST /resend/webhook` verifies Resend's Svix-signed payloads and suppresses globally on bounce/complaint; suppression flips matching `sequence_enrollments` to `unsubscribed`/`bounced`.

**Favicon fix (2026-07-10, `favicon.svg` + regenerated icon set, `index.html`, `sw.js`)** — the shipped favicon didn't match the actual in-app header brand mark (App.jsx's 40×40 dark-green rounded badge, cream serif "S", gold underline bar) — regenerated the full icon set from the real header SVG as the single source of truth. Same day, per direct feedback, simplified further: dropped the gold underline bar entirely (read as cluttered at actual favicon size), keeping just the badge + "S".

**Landing page rewrite (2026-07-10, `client/src/pages/Landing.jsx`)** — honest repositioning: fake testimonials removed, a "Where Steward Is Today" section added, a real product screenshot replaces a mockup.

**Strategic pivot (2026-07-11, `client/src/App.jsx`, `client/src/components/Dashboard.jsx`)** — per direct product feedback, decided against a proposed donor-facing gamified "Lifetime Impact Dashboard" (donor login, tiers, badges) — nonprofit-experienced feedback was that donor-visible tiers/badges/leaderboards feel toxic to donor trust, not warm. Refocused the product around Donors + Grants + Communications instead, hiding Events/Volunteers/Board/Analytics/Tasks/Finance from the nav (UI-visibility only — confirmed zero backend/db changes, all six component files stayed fully imported and intact). `TABS`/`BOTTOM_TABS`/`MORE_TABS` entries commented out with a `DEPRIORITIZED` marker. Dashboard.jsx: removed volunteer/task-derived state and widgets that depended on now-hidden modules, added a "Lapsed Donors" stat card in their place. Landing's Features section swapped its Finance & Reporting card for a Gmail-sync card (`98a1a45`) to match what's actually reachable. AI chat's greeting/suggestion-chip copy updated to stop referencing hidden modules (`5e564be`) — this was a stopgap fixed properly the next day when the chat surface itself was removed (see below).

**Retention & stewardship engine (2026-07-11 – 2026-07-12, `server.js`, `db.js`, `client/src/components/Communications.jsx`, `Settings.jsx`, `Donors.jsx`)** — the staff-facing system built in place of the rejected donor portal: the app notices patterns in donor data and drafts or suggests, a human always reviews and sends.
- **Milestone & anniversary detection** (`a1e3215`) — new `impact_metrics` table (org-configured "at this amount, here's what it funded" copy) and `milestone_drafts` table (AI-drafted emails awaiting staff review, never auto-sent). `computeMilestoneCandidates()` detects fixed-checkpoint crossings ($500/$1k/$2.5k/$5k/$10k) and 6-month/yearly giving anniversaries. `generateMilestoneDraft()` calls claude-sonnet-4-6 with the `{amount}`/`{n}` math pre-computed in JS (not left for the model), and a system prompt that explicitly bans "tier"/"level up"/"unlock"/"badge"/"leaderboard" language. Deliberately draft-and-review, not auto-send — matches the existing human-in-the-loop pattern (AI daily briefing informs, staff acts). New "Milestone Drafts" tab in Communications.
- **Impact Metrics admin panel** (`b5f8537`) — create/edit/delete UI in Settings.jsx, mirroring the existing Custom Fields pattern (impact_metrics had shipped with API-only management the day before).
- **Per-donor Impact Summary PDF** (`4376839`, plus two bugfixes `fac46d4`/`6159672`) — `GET /donors/:id/impact-summary/pdf`, reusing the Board Report's pdfkit pattern. Found live: footer text drawn at `y = page.height - 28` sat below pdfkit's default `maxY`, silently triggering an extra page break per footer `.text()` call — the PDF spilled onto 3 pages instead of 1. Fixed with an explicit `height` option on the footer text calls; the identical latent bug was then proactively fixed in the older Board Report PDF too.
- **AI chatbot removed, AI labels de-branded** (`208f121`) — the global "Ask AI" chat overlay (`AIChat` in Dashboard.jsx) and its header button deleted outright, not hidden — the underlying `askClaude`/`streamAI` infrastructure and every specific AI feature built on it (milestone drafting, LOI drafting, forecasting, wealth scoring) is untouched, only the general-purpose chat surface is gone. Every visible "AI"-branded label across Grants/Donors/Tasks/AnnualFund/Communications/Board/Settings renamed to describe function instead of mechanism (`AIBtn` default "AI Assist" → "Suggest", `AIPanel` badge "AI Intelligence" → "Suggested", "AI Forecast" → "Forecast", "AI Prioritize" → "Prioritize", "Draft with AI" → "Draft this email", etc.). Public Landing/Pricing marketing copy and the Privacy Policy's AI disclosures deliberately left untouched (legal/marketing decisions, out of scope).
- **Personal-note reminders** (`bf74ac2`) — new `note_reminders` table, the non-AI-drafted sibling of milestone drafts. `computeNoteTalkingPoints()` pulls 3 real facts straight from the donor record (no LLM call in this path). Split logic (`isNoteMoment()`): the two highest thresholds ($10k/$5k) and every anniversary get a "write a personal note" nudge; smaller/routine crossings keep the AI-drafted-email flow — reasoning that a $10k+ gift or multi-year anniversary earns a genuinely handwritten note, while frequent routine crossings are better served by an efficient, already-reviewed drafted email.
- **Voice memo capture** (`0978958`) — `POST /voice-memos/transcribe` (Whisper transcription + one narrow Claude extraction pass, saves nothing) / `POST /voice-memos/save` (the only write). Chose OpenAI Whisper over the free Web Speech API specifically for iOS Safari accuracy, confirmed with the user before adding the new dependency. `OPENAI_API_KEY` was never actually added to Railway, so this was never tested end-to-end against the real Whisper API even before being shelved the same day (see "Voice memo capture shelved" below).
- **Stewardship Debt / First-Touch Delay headline metrics** (`444095a`, seed-trend fixes `40552ea`/`529b7c5`) — new generic `metric_snapshots` table (reusable daily-snapshot store, not a bespoke table per metric — the design pattern is now documented in CLAUDE.md's "Product design patterns" section). `computeStewardshipDebt()`: sums (days since last meaningful contact ÷ 30) × (total giving ÷ 1000) across the donor portfolio, "meaningful contact" deliberately excluding gifts/notes/stage-changes/email-opens. `computeFirstTouchDelay()`: average days between first gift and first meaningful touch. Both computed live on every call, never served stale-only. The synthetic 21-day seed trend was initially off by >40x from the real computed value for the demo org (arbitrary illustrative baseline vs. the org's actual ~50 mostly-imported donors) — fixed by deriving the seed baseline from the same formula against real seeded data.

**Action-queue-first home screen (2026-07-12, `server.js`, `client/src/components/Dashboard.jsx`, `Donors.jsx`, `Grants.jsx`, `Communications.jsx`)** — replaced the old stat-card Dashboard entirely.
- Backend (`0d041c9`): `GET /dashboard/today` extended to fold milestone-ready donors into the same ranked queue as lapsed/no-contact/overdue-task items; new `fundraising_goals` table + `GET /goals/active` (computes real progress — `lapsed_recovery` reconstructs "recovered from lapsed" gifts from >365-day gaps in gift history) + `POST /goals`; new `GET /donors/stage-counts` for the funnel panel. Two dedup bugs found and fixed the same day: milestone-ready items (`c8a3b1d`) and lapsed donors as a bucket (`8bb948a`) were both losing a skip-if-claimed race against lower-priority queue reasons — replaced with a shared `upsertItem()` that keeps whichever reason has the higher priority everywhere, not just where it was first noticed.
- Frontend (`5ca26c4`): goal banner, ranked "Needs Your Attention" queue with one real action per row (no placeholders), pipeline funnel with lapsed called out as "leaking out," compact next-grant-deadline tile. Consolidated the two competing home screens (`/today` route and the AppShell "dashboard" tab) into one — `/today` now redirects to `/dashboard`, `TodayPage.jsx` left on disk but unrouted. Deep-link plumbing added across Donors.jsx (`initialView`/`initialLogDonorId`/`initialStageFilter`), Grants.jsx (`initialGrantId`), and Communications.jsx (`highlightDraftId`).
- Two live-testing bugs fixed (`f078aef`): "Next Grant Deadline" had no lower bound and was losing to a 13-month-overdue stale-seed grant; queue's "Mark done" button wasn't checking `isReadOnly` like every other write action (found because the live demo org was trial-expired at the time).
- Mobile polish (`cb899b8`): queue row action buttons were squeezing donor name/reason text unreadably narrow — `flex-basis:100%` drops them to their own line.
- Also fixed same day: Dashboard's Recent Activity feed was permanently empty (`17b2410`) — `GET /donors` never embedded interactions (`adaptData()` hardcoded `donors[].interactions` to `[]`), and Dashboard read from that always-empty field; new `GET /dashboard/recent-activity` route added and pointed at directly instead.
- An earlier same-day pass (`9f7fb62`) had already added a "Milestones Ready" stat card with a deep-link into the Milestone Drafts queue and richer seed data — superseded within hours by the full action-queue rebuild above, but the seed-data richening (9 donors filling previously-empty pipeline stages, near-future grant deadlines, seeded milestone drafts) carried forward.

**Voice memo capture shelved (2026-07-12, `client/src/App.jsx`, `Donors.jsx`)** — hidden from the UI (header button, donor-profile entry point) with `// SHELVED — ...` comments, as an unproven-adoption-assumption bet rather than a broken feature — `OPENAI_API_KEY` was never added to Railway, so it was never live end-to-end regardless. Backend routes, Whisper integration, and extraction logic all left fully intact.

**Admin data integrity tooling (2026-07-12, `server.js`)** — prompted by manually deleting test-user rows directly in Supabase's Table Editor. `DELETE /admin/orgs/:id`'s cascade was found incomplete (missing `milestone_drafts`/`note_reminders`/`donor_materials`/`planned_gifts`/`board_reports`/`fundraising_goals`/`impact_metrics`/`metric_snapshots`/`email_suppressions`) and fixed. New `GET /admin/data-integrity` (reports orphaned orgs + dangling user-ID FK references, changes nothing) and `POST /admin/data-integrity/fix` (nulls dangling refs only, never deletes org/donor data). **Not yet run against production** — see "OTHER PENDING" above.

**Onboarding mismatch fixes (2026-07-12, `client/src/App.jsx`, `WelcomePage.jsx`, `PROGRESS.md`)** — the earlier pivot and AI-chat removal left dead references: `data-tour="nav-finance"`/`"ask-ai"` attributes pointing at nav items that no longer exist (removed — investigation found no `GuidedTour`/`OnboardingWizard` component actually exists in the codebase at all; it was built and deleted the same day, 2026-06-07, per `git show b9fcf7a`, and this PROGRESS.md's own entry documenting the build was never updated for the removal until now), and WelcomePage's focus-selection step still offered "Financial Management" as an option despite Finance being hidden (removed; confirmed the field was pure UI copy with zero server-side effect).

**Onboarding rebuild to finish with real data (2026-07-12, `client/src/pages/WelcomePage.jsx`, `client/src/components/Donors.jsx`, `server.js`)** — replaced the 3-step blank-slate flow with a 5-step flow that finishes with real donor data, a real goal, and a real impact metric, since the new action-queue home screen shows nothing valuable without them. Steps: org basics (`PATCH /orgs/:id`, extended to accept `name`) → import donors (embeds the real `DonorImport`, now exported from Donors.jsx, as the centerpiece; only skippable step) → set first goal (pre-filled from real imported data — lapsed-recovery suggestion if lapsed donors exist, else total-raised) → first impact metric (pre-filled template, guided) → finish (`POST /onboarding/complete` moved to the END of the flow, deliberately, so a user who drops off mid-flow on a non-skippable step doesn't land on a half-set-up `/dashboard` next login). Live-tested end to end with a real CSV import (goal suggestion, queue, funnel all confirmed populated with real data) and the skip-import path (confirmed the good empty states show, not broken ones). Bug found live and fixed: the mount-effect redirecting an already-onboarded org to `/dashboard` was watching `[auth]` instead of `[]`, so it re-fired reactively when the finish step's `refreshOrg()` call updated auth context mid-flow, skipping the "ready" screen (and its conditional sample-data button) entirely before it ever rendered — the same latent bug existed in the old 3-step flow too, just invisibly, since both of its final-step buttons already led to `/dashboard` anyway.

### Auth, Gmail, billing/Reactivate, and QA-sweep fixes (2026-07-09 – 2026-07-10)

Prompted by a live incident (401s on every authenticated route) plus a full pre-launch QA sweep (Playwright, desktop + mobile) that found 3 blocking and 3 cosmetic bugs. Commits `4a9e406`..`d6823e6`.

**auth.js / client/src/api.js / client/src/pages/LoginPage.jsx** — 401 dead-end fix
- `requireAuth` now distinguishes `jwt.verify` failure modes: `{error:"token_expired"}` (TokenExpiredError), `{error:"invalid_token"}` (bad signature/malformed), `{error:"no_token"}` (missing header) — was one generic "Invalid token"/"No token provided"
- `apiFetch`/`streamAI` (api.js) detect any of these (plus the legacy message strings) on a 401, clear `npe_token`/`npe_user`/`npe_org`, and redirect to `/login` with a "session expired" message — instead of a dead-end "Failed to connect / Retry" screen that could never succeed on a bad token
- Root cause of the actual incident: an out-of-band `JWT_SECRET` rotation on Railway invalidated every issued token — not a bug in the sign/verify code, which was already internally consistent. This fix is about graceful recovery from that class of event, not a signing/verification correctness fix.

**server.js — syncGmail()** — Gmail sync retry-forever fix
- Now also catches `invalid_grant` (revoked/expired Google refresh token, thrown as HTTP 400 by google-auth-library at the token-refresh step — NOT a 401) in addition to a genuine 401, and marks the connection `status='disconnected'`
- `syncAllGmail()`'s `WHERE status='active'` query then excludes it from all future runs — previously `invalid_grant` fell through uncaught and retried every 15 minutes forever

**server.js — ensureStripeCustomer(orgId, email)** (new helper) + `POST /billing/create-checkout` / `POST /billing/create-portal`
- Both routes call this first instead of reading `stripe_customer_id` directly — an org with a null `stripe_customer_id` (legacy `/auth/register` signup, or a failed inline creation in `/auth/register-org`) gets a Stripe customer created transparently instead of the routes throwing "No Stripe customer linked to this org"

**client/src/components/PlanPicker.jsx** (new) + App.jsx — Reactivate now opens a plan picker, not the Portal
- New modal: Seed/Growth/Impact plan cards, pulling plan data from `pages/Pricing.jsx` (single source of truth, no duplicated pricing)
- "Reactivate" (read_only banner, canceled/warning banner) and "Choose a plan"/"Upgrade now" (trial banner) now open `PlanPicker` → `POST /billing/create-checkout`, instead of the Stripe Customer Portal (which just showed empty payment-method/invoice states for an org with no subscription yet)
- Portal access preserved where it's actually correct: "Update payment" (past_due banner) and Settings' "Manage billing" (orgs with an active subscription)

**client/src/App.jsx — Export data button**
- Banner's "Export data" button was a no-op (`onClick={()=>setTab("settings")}` — just switched tabs). Now calls the existing `GET /org/export` route directly and downloads a real JSON file (donors/gifts/grants/transactions) via the same blob+anchor pattern already used in Settings.jsx

**client/src/components/shared.jsx (GlobalStyles) / client/src/pages/SignupPage.jsx** — mobile signup overflow fix
- SignupPage's two-column layout had a hardcoded `minWidth:280` left panel + fixed px padding with zero `@media` rules — the math went negative below ~700-750px viewport width, so the form overflowed off-screen with clipped text. Added `@media(max-width:768px)` rules to `GlobalStyles()` (the established single CSS home for this breakpoint) to stack to single-column on mobile.

**server.js — checkWriteAccess** — expanded from 7 routes to 24
- Previously only guarded `POST/PUT /donors*` (5 routes incl. import) and `POST/PUT /grants` (2 routes)
- Now also applied to Volunteers (`POST/PUT`), Tasks (`POST/PUT`), Events incl. attendees (`POST/PUT/PATCH`, plus `/events/:id/follow-up` which inserts tasks directly and would otherwise have bypassed the Tasks gate), Campaigns incl. briefing/send (`POST/PUT`), Board (`POST`), Custom Fields (`POST/PUT/reorder`) — full route list in CLAUDE.md's SaaS billing section
- Matching frontend create/add buttons (12 total, across Dashboard Quick Actions, Grants Kanban + List, Communications, Events, Tasks, Volunteers, Board, Settings) now disable with the same tooltip pattern already used in Donors/Grants when `isReadOnly`. Two were simple pre-existing bugs, not new wiring: Dashboard's "Add Volunteer"/"New Task" Quick Actions were just missing the `isWrite:true` flag other Quick Actions had, and Grants Kanban's own "+ Add Grant" button (distinct from List view's) had no `isReadOnly` check at all.

**client/src/components/Finance.jsx — Overview tab data-source fix**
- Overview's Fund Balances card and Monthly Breakdown chart read `data.financials.funds`/`.revenue`/`.expenses` — a prop from the legacy `GET /financials` endpoint (old `financials`+`funds` tables) — while every other Finance subtab (Transactions/Accounts/Funds/Budgets/Reports) reads the newer `/finance/*` endpoints (`fin_transactions`/`fin_funds`/`fin_accounts`/`fin_budgets`). For CREO Arts the legacy tables still held old seeded balances while the live `fin_*` tables were genuinely empty — Overview showed real-looking numbers ($42k/$35k/$25k/$8.2k) that directly contradicted $0 shown one click away for the same funds.
- Fix: Overview (and the 6-Month Forecast / Risk Analysis AI prompts) now derive from the same `fundBalances` (computed client-side: income − expense per fund from live `funds`+`transactions` state) and `summary.ytdRevenue`/`ytdExpenses` already used by the rest of the module. See CLAUDE.md's "Finance tables" section for the legacy-vs-live table note.

**client/src/components/Donors.jsx / Grants.jsx — profile view layout fix**
- `{selected && <Profile/>}` rendered the donor/grant profile *alongside* the toolbar/list rather than replacing it — both were in the DOM at once, so scrolling down while a profile was open revealed the full list again below it. Changed to `{selected ? <Profile/> : <List/>}` in both files.

**client/src/components/Grants.jsx — Kanban card click handler**
- Kanban cards (the default Grants view) only had `draggable`/`onDragStart`/`onDragEnd` for reordering between pipeline stages — no way to open a grant's profile without knowing to switch to List view. Added `onClick={()=>onSelectGrant(g)}` alongside the existing drag handlers; no custom click-vs-drag threshold logic needed since native HTML5 drag-and-drop already distinguishes the two at the browser level (dragstart only fires past the browser's own movement threshold; a press-release that doesn't cross it fires a normal click and never fires dragstart).

**client/src/components/Settings.jsx — billing status badge fix**
- The plan/status badge's ternary chain (`active ? "Active" : past_due ? "Past Due" : cancelled ? "Cancelled" : "Trialing"`) had no branch for `trial_expired`, so an org whose trial had actually ended still showed "Trialing" — directly under a banner reading "Your free trial has ended" on the same page. Replaced with a `BILLING_STATUS_META` lookup covering `active/trialing/past_due/trial_expired/canceled/cancelled` (both spellings).

### Guided tour + WelcomePage redesign (2026-06-07)

**WelcomePage.jsx** — full cream design system redesign
- Step 0: radio option cards, "What brings you to Steward?" — cream/white, DM Serif Display
- Step 1: same animated setup logic, cream card, centered
- Step 2: "You're ready." + gold italic tagline; two CTAs both → `/today` (not `/dashboard`)
- Load Sample Data button calls POST /org/load-sample-data then navigates to /today

**OnboardingWizard.jsx** — gutted and replaced with GuidedTour
- 5-stop tooltip overlay with spotlight ring (border + CSS pulse animation)
- Spotlight: fixed div matching getBoundingClientRect of target element
- Backdrop at z-40, ring at z-41, tooltip card at z-50
- Stops: Today nav → Donors tab → Finance tab → Analytics tab → Ask AI button
- Data-tour attributes: nav-today, nav-donors, nav-finance, nav-analytics, ask-ai
- On finish/skip: sets localStorage "steward_onboarded_{org.id}" then calls onDone()

**App.jsx** — 4 targeted edits
- Added data-tour="ask-ai" to Ask AI header button
- Added data-tour="nav-today" to Today nav button in tab bar
- Added data-tour={...} to Donors, Finance, Analytics tab buttons in TABS.map
- Changed onDone handler: setShowWizard(false) + window.location.href="/today" (was setTab("dashboard"))

**InvitePage.jsx** — redirect fix
- Line 50: window.location.href="/dashboard" → "/today"

> **Superseded (2026-06-07, later same day, commit b9fcf7a "Kill guided
> tour...")**: OnboardingWizard.jsx (the GuidedTour described above) was
> deleted entirely. There is currently no post-onboarding tour of any kind —
> this section was never updated to reflect that and caused confusion in a
> later session, which found the 5 `data-tour` attributes still scattered
> across App.jsx with no tour engine left to consume them (now removed).
> If a guided tour is wanted again, it needs to be rebuilt from scratch
> against the current nav (Home/Donors/Grants/Communications/Settings), not
> restored from this entry — Finance/Analytics/Ask AI (all referenced above)
> are hidden or removed from the product surface as of today.

### Today follow-up flow (2026-06-07)

**TodayPage.jsx** (new) — standalone at /today; cream design system
- Proper-case greeting using first name
- Prioritized cards: never-contacted donors, unacknowledged gifts, overdue tasks
- Inline log form (call/email/meeting), dismiss, "Draft email" → /dashboard
- ⚠ Lapsing amber pill, daysOverdue in red, lifetime giving shown below donor name
- Action labels: Call / Email / Thank / Meeting

**server.js** — GET /dashboard/today
- Returns up to 15 prioritized follow-up items with donorId, donorName, reason, priority, action, totalGiving, isLapsing, daysOverdue (tasks only)

**LoginPage.jsx** — redirect after login
- isSuperAdmin → /admin; otherwise → /today (was /dashboard)

**main.jsx** — added /today route (RequireOnboarded guard)

### isReadOnly bug fix (2026-06-06)

- DonorProfile (line 660) was missing isReadOnly prop — caused ReferenceError crash in Gifts & Pledges tab
- Added ErrorBoundary class to Donors.jsx (key={selected.id} resets on donor change)
- Added isReadOnly=false to DonorProfile props; passed from Donors render site

### Billing lifecycle hardening (2026-06-06)

**DB (db.js)**
- Added current_period_end TIMESTAMPTZ and grace_until TIMESTAMPTZ columns to orgs (IF NOT EXISTS)

**Access state model (server.js)**
- getOrgAccessState(org) → full | warning | read_only
  - active/trialing → full
  - past_due/canceled within grace_until → warning
  - trial_expired or past grace_until → read_only
  - handles both 'cancelled' and 'canceled' spellings
- checkWriteAccess middleware: 402 {error:"subscription_required"} when read_only
  - Applied to: POST /donors, PUT /donors/:id, POST /donors/:id/gifts, POST /grants, PUT /grants/:id
  - Never blocks GET or export routes
- checkTrialExpiry() job: sets trial_expired when trial_ends_at < NOW(); runs startup+15s + every 6h
- Billing webhook: 4 events — checkout.session.completed, invoice.payment_succeeded, invoice.payment_failed, customer.subscription.deleted; stores grace periods and period_end

**App.jsx** — 4-state banner
- Red persistent: read_only
- Amber not dismissible: warning+past_due (update payment), warning+canceled (grace date + export)
- Green/amber: trialing ≤14d (amber at ≤3d)
- isReadOnly passed to Dashboard, Donors, Grants
- Create buttons disabled with tooltip when isReadOnly

### Sentry v8 startup crash fix (2026-06-06)

- Removed app.use(Sentry.Handlers.requestHandler()) — doesn't exist in v8
- Replaced Sentry.Handlers.errorHandler() with Sentry.setupExpressErrorHandler(app)

---

## Full feature list

- Auth + 3-step onboarding (blank slate — chart of accounts + General Operating fund)
- Today flow — prioritized daily follow-up page; default landing for org users
- Guided tour — 5-stop tooltip overlay on first login after onboarding
- Dashboard — hero stats, AI briefing, pipeline snapshot, lapsed alert, grant deadlines, recent giving, Stripe gifts, quick actions, tasks, activity feed
- Donors — Kanban pipeline, CSV import, AI features, wealth scoring, donor profile (5 tabs: Overview, Gifts & Pledges, Funds, Materials, Activity), stewardship timeline, planned giving, donor materials, custom fields, MGO toolkit
- Grants — CRUD, AI strategy, LOI drafting, grant discovery
- Communications — segmented email campaigns (Resend), AI copy, open tracking, email sequences engine
- Finance — 6 tabs: Overview, Transactions, Accounts, Funds (sparklines), Budgets, Reports; gift sync; audit log
- Events — event CRUD, attendee management, gift logging on attendance
- Volunteers — hours tracking, board candidate AI
- Board — giving levels, attendance, committees, AI board report + PDF export
- Tasks — priority queue, AI prioritization
- Analytics — 7 charts: giving trend, retention, pipeline velocity, grant pipeline, email performance, event performance, top donors
- Settings — Stripe Connect, QR code, embed widget, team management, invite staff, custom fields, demo data loader
- Public donation page (/give/:orgSlug) — Stripe Checkout, recurring gifts
- SaaS billing — trial → seed/growth/impact; 4-state access model; Stripe webhooks
- Admin dashboard — super admin only; org list, impersonation, metrics
- Gmail integration — OAuth connect, inbound sync, send from donor profile
- PWA — service worker, offline-capable
- Password reset, terms, privacy pages
