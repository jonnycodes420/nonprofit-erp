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

---

## Earlier sessions (for reference)

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
