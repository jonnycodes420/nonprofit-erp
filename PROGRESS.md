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
6. Expired-token UX: show login redirect instead of "Failed to connect / Invalid token" error.

---

## Earlier sessions (for reference)

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
