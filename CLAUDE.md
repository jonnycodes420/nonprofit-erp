# Steward — Nonprofit ERP SaaS

## Strategic pivot (2026-07-12) — READ THIS FIRST
Steward pivoted from a full 11-tab nonprofit ERP to a focused **retention/stewardship product** built around Donors + Grants + Communications.

- **What's hidden, not deleted**: Events, Volunteers, Board, Tasks, and Finance are commented out of the nav (`TABS`/`BOTTOM_TABS`/`MORE_TABS` in App.jsx — see "Active tabs" below for the exact current arrays). Their component files, backend routes, and database tables are all still fully intact and functional — this is a UI-visibility change only, deliberately reversible by uncommenting.
- **Analytics is dead, not paused (deleted 2026-07-16, BUILD-04 Strike 2)**: `Analytics.jsx` and the zero-caller `GET /analytics` route were deleted outright (along with the long-unrouted `TodayPage.jsx`). Analytics computed its 7 charts client-side from the shared `data` prop plus `/campaigns` + `/events` — both of those routes have other callers and remain. If analytics is ever wanted again it gets rebuilt against the retention product, not restored.
- **A donor-facing portal was explored and rejected.** A partner brief proposed a donor-facing "Lifetime Impact Dashboard" — donor login, giving tiers, badges, milestone displays. Rejected specifically because nonprofit-experienced feedback identified gamified donor-facing portals (tiers/badges/leaderboards visible to the donor) as damaging to donor trust, not building it. This is why donor login, tiers, and badges were deliberately avoided in what got built instead — see below.
- **What got built in its place**: a staff-facing retention/stewardship engine. The system notices patterns in donor data (giving milestones, anniversaries, contact gaps) and drafts or suggests — a human always reviews and sends. Nothing donor-facing was built; there is no donor login.
- **AI works invisibly, not as a branded feature.** The general-purpose "Ask AI" chatbot (a floating assistant you could ask anything) was **removed entirely** — not hidden, actually deleted (`AIChat`, formerly exported from Dashboard.jsx — see "Component files" below) — because a visible, brandable "AI feature" cuts against the product's actual value: staff shouldn't need to think about *which* moments are AI-touched, they should just see a good suggestion at the right time. Every specific AI-powered action (milestone drafting, LOI drafting, forecast, wealth scoring, etc.) still works exactly as before — only the standalone chat surface is gone. See "Key patterns" for the current de-branded label conventions (`AIBtn`'s default label is "Suggest", not "AI Assist"; `AIPanel`'s badge reads "Suggested", not "AI Intelligence").

## Stack
- Frontend: React 18 + Vite → deployed on Vercel
- Backend: Node + Express → deployed on Railway
- Database: Supabase PostgreSQL
- Auth: JWT written directly to localStorage (npe_token, npe_user, npe_org)
- AI: Anthropic SDK (claude-sonnet-4-6) — used for specific, narrow tasks throughout the app; there is no general-purpose chat interface (see "Strategic pivot" above)
- Email: Resend HTTP API (noreply@stewardapp.dev)
- Payments: Stripe Connect Express

## Live URLs
- Frontend: https://client-five-tau-13.vercel.app (also stewardapp.dev via Vercel nameservers)
- Backend: https://nonprofit-erp-production.up.railway.app
- GitHub: github.com/jonnycodes420/nonprofit-erp
- Demo login: admin@creoarts.org / demo1234 (org_creo)

## Design system
- Colors: cream #f0ede6, dark green #0f1a12, primary green #1a6b4a, accent green #10b981, gold #c9a84c, terracotta (gold-tinted brown accent) #b8593f
- Fonts: DM Serif Display + DM Sans
- **Five-color rule (established 2026-07-15, Home dashboard + STAGES pass)**: nothing outside this set (dark green shades, cream, gold, white, terracotta) anywhere in the authenticated app — no red/orange/teal/blue/purple, even for status/semantic coloring. Gold = positive/on-track/primary emphasis; terracotta = needs-attention/behind/urgent; multiple dark-green shades (ink `#0f1a12`, greenDk `#0d5c3a`, greenMid `#1a6b4a`, green accent `#10b981`, bgElevated `#1a2e1f`) are available and expected to be used deliberately varied (not near-identical shades side by side) when more than one neutral/positive category needs to be visually distinct — see `STAGES` below for the reference example. When a status needs to be visually distinct but doesn't cleanly map to gold/terracotta/green, lean on weight/size/label text before reaching for a color outside this set.

## Required Environment Variables
### Backend (Railway)
- `ANTHROPIC_API_KEY` — claude-sonnet-4-6
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase service role key
- `JWT_SECRET` — JWT signing secret
- `RESEND_API_KEY` — Resend API key for email campaigns
- `STRIPE_SECRET_KEY` — Stripe platform secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (Connect events at /stripe/webhook)
- `STRIPE_BILLING_WEBHOOK_SECRET` — Stripe webhook signing secret for /billing/webhook (platform subscription events; can reuse STRIPE_WEBHOOK_SECRET if same endpoint)
- `FOUNDER_EMAIL` — from address for onboarding email sequence (e.g. jonathan@stewardapp.dev); must be a verified Resend sender
- `STRIPE_PRICE_SEED` — Stripe Price ID for $99/mo Seed plan
- `STRIPE_PRICE_GROWTH` — Stripe Price ID for $249/mo Growth plan
- `STRIPE_PRICE_IMPACT` — Stripe Price ID for $499/mo Impact plan
- `FRONTEND_URL` — used in invite links and Stripe redirects
- `SENTRY_DSN` — backend error reporting; also gates `Sentry.setupExpressErrorHandler` and the process-level `uncaughtException`/`unhandledRejection` handlers (see Error monitoring below) — unset means none of that runs, not a hard failure
- `RECOVERY_SECRET` — optional; signs the donor card-update link token (see "Recurring gift recovery"). Falls back to `JWT_SECRET` if unset — not a hard requirement to add, just lets that token family be rotated independently later

### Frontend (Vercel / client/vercel.json)
- `VITE_API_URL` — Railway backend URL
- `VITE_SENTRY_DSN` — client error reporting (build-time; baked into the bundle, not a runtime secret)
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` — build-time only, used by `@sentry/vite-plugin` to upload source maps during `vite build` so production stack traces resolve to real file/line instead of minified output; the plugin no-ops (via `disable: !process.env.SENTRY_AUTH_TOKEN`) when `SENTRY_AUTH_TOKEN` isn't set, so local/preview builds without the secret still succeed. `SENTRY_AUTH_TOKEN` is a Sentry **org auth token** (from sentry.io → org settings → Auth Tokens), not the DSN — treat it like any other build secret (Vercel project env var, not committed)

## Error monitoring
- Backend: `Sentry.init()` gated on `SENTRY_DSN` (server.js top). `Sentry.setupExpressErrorHandler(app)` catches errors that flow through Express's request/response cycle. `process.on("uncaughtException")` and `process.on("unhandledRejection")` (registered immediately after `Sentry.init()`, before any other require) are the backstop for everything Express never sees — background jobs (`syncAllGmail`, `processSequences`, `checkTrialExpiry`, etc.), truly synchronous throws, or a rejected promise nobody `.catch()`ed. `uncaughtException` reports to Sentry then exits (`Sentry.close()` → `process.exit(1)`) since Node's own guidance is not to keep serving requests after one — Railway restarts the process clean. `unhandledRejection` reports and deliberately does NOT exit, since in this codebase it's overwhelmingly a rejected promise inside a fire-and-forget background job (most of which already have their own local `.catch(console.error)`); killing the whole API over one of those would be worse than the bug itself.
- Client: `Sentry.init()` gated on `VITE_SENTRY_DSN` (main.jsx top), with `browserTracingIntegration()`. Source maps: `vite.config.js` sets `build.sourcemap: !!process.env.SENTRY_AUTH_TOKEN` (not unconditionally `true` — a build with no token generates no maps at all, so there's never a window where maps sit in `dist` unuploaded-and-unstripped) and runs `@sentry/vite-plugin`'s `sentryVitePlugin(...)`, which uploads maps to Sentry at build time then deletes them from the `dist` output (`sourcemaps.filesToDeleteAfterUpload`) regardless of whether the upload itself succeeded — production never publicly serves raw source maps either way.
- **Production status (verified 2026-07-16, BUILD-04 Strike 4)**: **Backend IS live** — `GET /health` now reports `sentry: true/false` (non-secret boolean; Railway returned `true`), and `POST /admin/debug/sentry-test?mode=route|rejection` (requireAuth + requireAdmin) fires one deliberate error down the Express-error-handler or `unhandledRejection` path respectively — both paths exercised against production (route → 500, rejection → 200 with the process staying up, as designed). Event *arrival in the Sentry dashboard* still needs a human check — no Sentry credentials in the dev environment. **Client is NOT live** — the deployed Vercel bundle contains no DSN string and no `_sentryDebugId` markers, meaning `VITE_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` are both missing from Vercel's build env; browser errors currently report nowhere and prod stack traces would be minified. Fix: add both in Vercel project env vars (plus `SENTRY_ORG`/`SENTRY_PROJECT`) and redeploy.

## Uptime monitoring (decision — external ping, no code)
Decided 2026-07-16 (BUILD-04 Strike 4): use a free external ping service rather than building anything — Sentry catches errors *inside* a running process; only an outside observer catches "Railway/Vercel is down entirely."
- **What to monitor**: `GET https://nonprofit-erp-production.up.railway.app/health` (expect 200 + `"status":"ok"` — also carries `db` and `sentry` booleans) and `https://www.stewardapp.dev/give/creo-arts-creo` (frontend + the revenue-critical public donate path — slug verified live 2026-07-16; use the `www.` host, the apex 307s to it).
- **Setup (user click-through, ~5 min)**: create a free UptimeRobot (50 monitors, 5-min interval) or Better Stack (10 monitors) account → add the two HTTP(S) monitors above → set keyword check `"status":"ok"` on the health monitor → alert contact = founder email (jonathan@stewardapp.dev). Not automatable from this environment (needs an account signup).

## Project structure
- /client/src/App.jsx — AppShell + TABS + App, imports from components/. Header is wordmark-only (no icon-in-square logo — icon lives on the favicon only) and has no "Ask AI" button (removed, see Strategic pivot).
- /client/src/main.jsx — router, auth context, route guards — ALL ROUTING LIVES HERE ONLY. `/today` still redirects to `/dashboard` (kept for bookmarks) — `TodayPage.jsx` itself was deleted 2026-07-16 (BUILD-04 Strike 2).
- /client/src/pages/Landing.jsx — public landing page, rewritten for the pivot: fake testimonials removed, honest "Where Steward Is Today" section added, real product screenshot (not a mockup), Features section updated to match what's actually live (Finance & Reporting card replaced with Gmail sync)
- /client/src/pages/LoginPage.jsx — login, writes localStorage directly; post-login redirect is `/dashboard` (was `/today`)
- /client/src/pages/SignupPage.jsx — signup
- /client/src/pages/WelcomePage.jsx — 5-step onboarding that finishes with real data, not a blank slate (org basics → import donors → set first goal → first impact metric → finish). See "Onboarding flow" below.
- /client/src/pages/GivePage.jsx — public donation page at /give/:orgSlug
- /client/src/api.js — apiFetch, streamAI, adaptData helpers
- /server.js — Express backend (all routes)
- /auth.js — auth middleware (requireAuth, requireAdmin)
- /db.js — Supabase client

## Key files
- client/src/components/Donors.jsx — donor list + ALL importers; `DonorImport` is now exported (was module-private) so WelcomePage's onboarding flow can reuse it directly as the import step's centerpiece
- client/src/components/Finance.jsx — hidden from nav, code/routes/tables intact (see Strategic pivot)
- client/src/components/Settings.jsx — includes an Impact Metrics admin panel (create/edit/delete), mirroring the existing Custom Fields UI pattern
- client/src/components/UpgradeModal.jsx
- server.js
- db.js

## Active tabs (App.jsx TABS array — current, post-pivot)
dashboard ("Home") → donors → grants → communications → settings

Events/Volunteers/Board/Tasks/Finance are commented out of `TABS` with a `// DEPRIORITIZED` marker — re-enable by uncommenting, nothing else to restore. (Analytics was deleted outright — see Strategic pivot.)

Mobile bottom bar (`BOTTOM_TABS`): dashboard ("Home"), donors, grants, settings
Mobile "More" drawer (`MORE_TABS`): communications only (Events/Volunteers/Board/Tasks are commented out here too)

## Component files (client/src/components/)
- shared.jsx — T (design tokens, now includes `bgDeep` and `terracotta`), fmt, fmtFull, daysDiff, daysUntil, SC, askClaude, buildContext, STAGES, STAGE_THRESH, STAGE_ACTION, TIER_COLOR, donorScore, retentionRisk, moveUrgency, GlobalStyles, Spin, Pill, Card, SectionLabel, AIBtn (default label "Suggest", not "AI Assist"), AIPanel (badge reads "Suggested", not "AI Intelligence"), MetricCard, EmptyState, PageTitle, GivingHistoryChart, TpField, TpYesNo, TouchpointTimeline, VoiceMemoModal (built but currently unused — see "Voice memo capture (shelved)" below)
- Dashboard.jsx — exports `Dashboard` only. **`AIChat` (the global "Ask AI" chat overlay) was removed entirely**, not hidden — see Strategic pivot. `Dashboard` is now the action-queue-first home screen (goal banner, "Needs Your Attention" queue, pipeline funnel, next-grant-deadline tile, Stewardship Debt/First-Touch Delay headline metrics, recurring-gift-at-risk card) — the old 4-card KPI stat row, Quick Actions sidebar, and Recent Activity feed are gone, not just restyled. See "What's built" below for the full description. **(2026-07-15)** Greeting ("Good evening, {name}") lives on the page's own cream background between the nav and the goal card, not inside the dark card. Every color on this page is locked to the five-color palette (see "Design system" above) — no exceptions, including hero-metric status coloring. The goal card has an admin-gated pencil/edit control next to the label that reopens the same set-goal modal pre-filled with current values — editing works by submitting a new overlapping `POST /goals` row (there's no `PUT /goals/:id`; `GET /goals/active` always resolves to the most-recently-created row whose period contains today, so a new submission supersedes the old one by design, not a special-cased edit path). Hero-card copy is narrative-first (a sentence of context with the number as supporting evidence), not a bare numeral with a caption. **(2026-07-16)** The metric hierarchy (Retention Rate hero → First-Touch Delay secondary → Stewardship Debt demoted strip) is a deliberate, founder-driven decision (`436a6b5` "demote, don't delete" after live "not a fan" feedback on the debt hero; `d72dbd0` after "wall of cold statistics" feedback) — an older "four equally-weighted drillable KPI cards" ask was investigated (BUILD-04 Strike 3) and resolved as superseded by that feedback; do not resurrect equal-weight stat cards here without new direction.
- Donors.jsx — exports Donors, and now also exports `DonorImport` (reused directly by WelcomePage's onboarding flow) (includes FollowUpTaskModal, LogTouchpointModal, EditDonorModal, DonorProfile, DonorKanban, ReEngageView internally). `DonorProfile`'s Gifts & Pledges tab shows a recurring-gift status chip (Active/Payment failed/Recovering/Recovered/Canceled) + "Send card-update link" button when at-risk — see "Recurring gift recovery" under Database
- Events.jsx — exports Events (EventCard, EventDetail, NewEventPanel, FollowUpModal internally) — **hidden from nav**, code/routes/tables intact
- Grants.jsx — exports Grants (includes GrantProfile, FindGrants internally). GrantProfile now accepts an `initialGrantId` prop for deep-linking (used by the home screen's next-grant-deadline tile)
- Communications.jsx — exports Communications (email campaigns, templates, audience segmentation, Resend API, open tracking, Sequences, Milestone Drafts review queue). Accepts `initialNav`/`highlightDraftId` props for deep-linking from the home screen's queue. See "Retention & stewardship" below.
- Volunteers.jsx — exports Volunteers — **hidden from nav**, code/routes/tables intact
- Board.jsx — exports Board — **hidden from nav**, code/routes/tables intact
- Finance.jsx — exports Finance (6 tabs: Overview, Transactions, Accounts, Funds, Budgets, Reports; includes fund sparklines) — **hidden from nav**, code/routes/tables intact
- Tasks.jsx — exports Tasks — **hidden from nav**, code/routes/tables intact
- Settings.jsx — exports Settings (Stripe connect, QR code, donation widget embed, team management, invite modal, Custom Fields manager, Impact Metrics manager — same UI pattern as Custom Fields)
- PlanPicker.jsx — exports default PlanPicker(open, onClose) modal; Seed/Growth/Impact plan cards pulling plan data from pages/Pricing.jsx (single source of truth); selecting a plan calls POST /billing/create-checkout. Used by App.jsx banner "Reactivate"/"Choose a plan" buttons — NOT the Stripe Customer Portal (see SaaS billing section)

## Routing (IMPORTANT)
- / → Landing (public)
- /login → LoginPage (public)
- /signup → SignupPage (public)
- /welcome → WelcomePage (auth required)
- /dashboard → App/AppShell (auth + onboarded required)
- /give/:orgSlug, /give/:orgSlug/:pageSlug, /give/:orgSlug/:pageSlug/:fundraiserSlug → Donate.jsx (public — org-wide page, Giving Page, and peer-to-peer fundraiser page, one component, not three forks; see "Giving Pages"/"Peer-to-peer fundraising")
- /fundraiser/manage/:token → ManageFundraiser.jsx (public, token-authenticated — a peer fundraiser's own "edit my page" screen, no login)
- /admin → AdminDashboard (super admin only — RequireSuperAdmin guard checks localStorage npe_user.isSuperAdmin)
- App.jsx renders <AppShell /> directly — NO internal router

## CRITICAL WORKING RULES
- After every change, run: git add -A && git commit -m "..." && git push origin main. Always run `git status` and `git log --oneline -3` to CONFIRM the commit landed — do not report work as "done" until git confirms it's committed and pushed.
- IMPORTANT donor table distinction: there are TWO separate columns: `status` (giving-tier: new/mid/major/lapsed) and `stage` (pipeline: prospect/qualify/cultivate/solicit/steward/lapsed). The UI Kanban/Directory pipeline views read `stage`; giving-tier/retention logic reads `status`. They are NOT the same and must not be conflated.
- inferStage outputs only: 'prospect' (no data), 'cultivate' (gift exists, not recent), 'steward' (gift <90 days), 'lapsed' (last gift >365 days). It never produces 'qualify' or 'solicit' (those are human-only).
- Fiscal year = July 1 boundary (reuse fyStart logic from /dashboard/my-stats). Finance has a fiscal/calendar toggle (localStorage key "steward_fin_yearmode", default fiscal).

## Gmail integration

### Tables
- `gmail_connections` — id, org_id, user_id (UNIQUE), email, access_token, refresh_token, token_expiry, last_synced_at, history_id, status (`active`|`disconnected`)
- `interactions.metadata JSONB` — added column; Gmail interactions store `{ gmail_message_id, from, to, subject, direction: 'inbound'|'outbound' }`
- `gmail_sync_exclusions` — id, org_id, gmail_message_id, created_at, UNIQUE(org_id, gmail_message_id). Written by `DELETE /interactions/:id` when the deleted row was Gmail-synced; checked by `syncGmail` (loaded into a Set per org at sync start, before the per-message dedup query) so a staff-deleted email interaction never resyncs — without it, deletion would only last until the next 15-min pass

### Auth flow
- `POST /gmail/auth-url` (requireAuth) → returns `{ url }` for frontend to redirect to
- `GET /gmail/callback` (public) → exchanges code, upserts gmail_connections, redirects to `${FRONTEND_URL}/dashboard?gmailConnected=true`
- `makeOAuth2Client()` factory in server.js reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

### Sync logic (inbound)
- `syncGmail(userId, orgId)` — async function, chunks donor emails 20 at a time, deduplicates via `metadata->>'gmail_message_id'`, inserts `type='email'` interactions
- `syncAllGmail()` — iterates connections `WHERE status='active'` only; called on startup (+10s) and every 15 min via setInterval — a connection marked `disconnected` is excluded from all future runs, so it stops being retried
- Token refresh: `oauth2Client.on('tokens')` persists new tokens; a dead connection is detected two ways, both set `status='disconnected'`: a genuine 401 from the Gmail API, OR `invalid_grant` (message === "invalid_grant", HTTP 400 — thrown by google-auth-library when the refresh token itself has been revoked/expired at the token-refresh step, *before* any Gmail API call happens). `invalid_grant` is NOT a 401 and was previously falling through uncaught, retrying forever every 15 min — both are now caught in the same `catch` in `syncGmail`'s `gmail.users.messages.list` call
- Interaction note format: `"Subject: X\n\nsnippet"` — parsed by TouchpointTimeline into subject + snippet display

### Send route
- `POST /gmail/send` (requireAuth) — body: `{donorId, to, subject, body}`. Builds RFC 2822 message, sends via gmail.users.messages.send, retries once on 401. Logs `type='email'` interaction with `direction:'outbound'` in metadata.
- `GET /gmail/thread/:donorId` (requireAuth) — returns last 20 email interactions for AI context. Response: `[{id, date, created_at, subject, snippet, direction, note}]`

### Env vars required
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

### Frontend pattern
- Settings Integrations section calls `POST /gmail/auth-url` then redirects; reads `?gmailConnected` on return
- `TouchpointTimeline` in shared.jsx parses email note format and shows direction badge (Received=green, Sent=blue), ✉ icon, "via Gmail" label when `metadata.gmail_message_id` exists
- Dashboard activity feed shows "Email — [subject]" for Gmail-synced messages
- `DonorProfile` (Donors.jsx): fetches `GET /gmail/status` on mount; "✉ Send Email" button opens inline compose panel. `draftWithAI` fetches thread + streams AI; `sendEmail` replaces {{tokens}} and calls `POST /gmail/send`.
- `getAI` in Donors component: fetches thread for "email"/"outreach" types and prepends to prompt
- `adaptData` in api.js includes `metadata` in interactions so direction badges render from DB data

## Super admin pattern
- `is_super_admin BOOLEAN DEFAULT false` column on `users` table
- Set via: `UPDATE users SET is_super_admin = true WHERE email = 'your@email.com'` in Supabase
- Login route includes `isSuperAdmin` in JWT payload and returned user object
- `requireSuperAdmin` middleware in auth.js — returns 403 (not 404)
- All `/admin/*` routes require both `requireAuth` + `requireSuperAdmin`
- After login: always `"/dashboard"` — super admins navigate to `/admin` manually
- `RequireSuperAdmin` component in main.jsx reads localStorage (not AuthCtx) so it works without re-render on redirect
- AdminDashboard.jsx has its own `adminFetch()` helper (not apiFetch) and its own layout — no AppShell
- Design tokens: `A` object (not `T`) — bg `#0a0f0a`, dark ops-tool aesthetic

## Admin data integrity
Diagnostic tooling added after manually deleting test-user rows in Supabase's Table Editor left open questions about orphaned data (see "Current priorities" — the actual investigation is still outstanding, this section documents the tooling only).
- `GET /admin/data-integrity` (requireAuth + requireSuperAdmin) — reports orgs with no matching `users` row, plus dangling foreign-key references to deleted user IDs, without changing anything.
  - `DANGLING_USER_REF_CHECKS` — columns that reference a user but aren't unique/required, checked for stale IDs: `interactions.created_by`, `donors.assigned_to`, `donor_materials.uploaded_by`, `milestone_drafts.reviewed_by`, `note_reminders.sent_by`, `board_reports.generated_by`, `fin_audit_log.user_id`, `ai_log.user_id`, `invites.invited_by`.
  - `DANGLING_USER_ROW_CHECKS` — whole rows keyed to a now-missing user: `gmail_connections.user_id` (org-scoped), `password_reset_tokens.user_id` (not org-scoped).
- `POST /admin/data-integrity/fix` (requireAuth + requireSuperAdmin) — nulls the dangling FK references found above; does NOT delete orgs or donor/gift data as a side effect (orphaned-org cleanup is a separate, deliberate action — see below).
- **`DELETE /admin/orgs/:id` cascade fixed** — was missing `milestone_drafts`, `note_reminders`, `donor_materials`, `planned_gifts` (all ordered BEFORE the `donors` delete, since they carry `donor_id` FKs), plus `board_reports`, `fundraising_goals`, `impact_metrics`, `metric_snapshots`, `email_suppressions` (org_id only, no ordering constraint). Use this route (not manual table deletes) to remove a throwaway/test org — it deletes everything scoped to the org in FK-safe order.

## Auth (IMPORTANT)
- Login writes npe_token, npe_user, npe_org to localStorage directly
- LoginPage uses hardcoded fetch() to Railway URL, not apiFetch
- onboarding_complete comes back as 1 (number) not true (boolean)
- After login: `window.location.href = data.user.isSuperAdmin ? "/admin" : "/dashboard"`. `/today` still exists as a route in main.jsx but is now just `<Navigate to="/dashboard" replace />` (kept for bookmarks) — `TodayPage.jsx` was deleted 2026-07-16.
- RequireOnboarded guard in main.jsx checks both auth AND onboarding_complete; redirects to /welcome if onboarding_complete is 0
- `requireAuth` (auth.js) distinguishes `jwt.verify` failure modes and returns a distinct error code + message rather than one generic message: `{error:"token_expired"}` (TokenExpiredError), `{error:"invalid_token"}` (bad signature/malformed — e.g. what a server-side `JWT_SECRET` rotation looks like to every previously-issued token), `{error:"no_token"}` (missing/malformed Authorization header)
- Client (`api.js` `apiFetch`/`streamAI`) detects any of these three codes (plus the legacy `"Invalid token"`/`"No token provided"` message strings, for compatibility during a deploy) on a 401, clears `npe_token`/`npe_user`/`npe_org`, and redirects to `/login` with a "Your session expired — please log in again" message via `sessionStorage` — instead of leaving the app on a dead-end "Failed to connect" screen with a Retry button that could never succeed on a bad token
- A real production incident of this kind was traced to an out-of-band `JWT_SECRET` rotation on Railway invalidating all issued tokens — not a bug in the sign/verify code itself, which was already internally consistent. The fix above is about graceful recovery from that class of event (expected or accidental), not a correctness fix to token signing/verification.

## Onboarding flow (IMPORTANT)
- Signup → /welcome (RequireAuth, not RequireOnboarded)
- WelcomePage is now a **5-step flow that finishes with real, working data** — not a blank slate. Rebuilt because the new home screen (goal banner, queue, funnel) shows nothing valuable until there's real donor data, a goal, and at least one impact metric configured. There is no guided-tour step — no GuidedTour/OnboardingWizard component exists in the codebase (see "What's NOT built" note below); a comment in WelcomePage.jsx marks where one would slot in if built later.
  1. **Org basics** — org name + mission/tagline → `PATCH /orgs/:id` (route extended to accept an optional `name` field for this; previously mission/focusArea/annualBudget/foundedYear/website only)
  2. **Import your donors** — centerpiece step. Embeds the real `DonorImport` component (now exported from Donors.jsx, was module-private) as a modal — same CSV import used everywhere else in the app, not a simplified onboarding-only version. Only skippable step: "I don't have a list ready yet — I'll do this later." Skipping sets `importSkipped` state, checked in step 5.
  3. **Set your first goal** — pre-fills from real imported data via `useMemo` over a `GET /donors` snapshot: if lapsed donors exist, suggests `{goalType:"lapsed_recovery", label:"Win back $X in lapsed giving"}`; otherwise suggests `{goalType:"total_raised", label:"Raise $X this quarter"}`. Calls `POST /goals`.
  4. **First impact metric** — pre-filled template built from the org name (string concatenation, not a template literal — `{amount}`/`{n}` must appear as literal placeholder text in the saved template for the backend's own `.replace()` logic to fill in later, not be evaluated as JS). "+ Add another metric" reveals an optional second one. Calls `POST /impact-metrics` once or twice.
  5. **Finish** — calls `POST /onboarding/complete` (seedOrgData + `onboarding_complete=1`) **at the end of the flow, not the start**, deliberately: goal/metric steps are non-skippable, so flipping the flag early would let a user who drops off mid-flow land on a half-set-up `/dashboard` on next login. Then an animated checklist, then a "ready" screen with "Go to my home screen →" always, plus a conditional "Load sample data & explore →" button shown only when `importSkipped && donorsSnapshot.length === 0`.
- `seedOrgData` still seeds only structural data (26-account chart of accounts + one General Operating fund) — real donor/goal/metric data now comes from steps 2–4 above, not from seeding.
- Known-fixed bug: the mount-effect that redirects an already-onboarded org straight to `/dashboard` must have an empty dependency array (`[]`, mount-only) — watching `[auth]` re-fires reactively when step 5's `refreshOrg()` updates the auth context mid-flow, force-navigating away and skipping the "ready" screen (and its conditional sample-data button) before it renders. This exact bug existed latently in the old 3-step flow too, just invisibly, since both old final-step buttons already led to `/dashboard`.
- InvitePage: dark theme; invited staff land on /dashboard (org already onboarded)

## Database — key tables and columns
### donors
- wealth_score (integer), capacity_tier (text), score_confidence (text), score_last_updated (timestamptz), score_rationale (text) — wealth scoring system
- stage (text), total_giving, last_gift_date, last_gift_amount, gift_count, tags (jsonb), notes
- status (text) — giving tier: new/mid/major/lapsed (separate from stage!)
- assigned_to (text), assigned_to_name (text) — MGO portfolio assignment
- city, state, zip — for Donor Map geocoding
- planned_giving (boolean) — set true when first planned gift is indicated
- stripe_customer_id (text) — captured at subscription checkout completion; needed to build a card-update Checkout session without the donor logging in (see "Recurring gift recovery" below)

### gifts
- amount, date, type, campaign, notes, stripe_payment_id, campaign_id
- fund_id TEXT — for fund affinity tracking
- payment_method TEXT — how gift was received
- acknowledgement_sent BOOLEAN DEFAULT false

### interactions
- type: call | meeting | email | gift | event | note | stewardship | stage_change | planned_gift | material | email_open
- created_by (user_id), logged_by_name (user name display string)
- metadata JSONB — Gmail interactions store `{gmail_message_id, from, to, subject, direction}`; stewardship stores `{stewardship_type, detail}`
- `DELETE /interactions/:id` (requireAuth, org-scoped, 404 on zero rows; no `checkWriteAccess` per the DELETE-routes convention) — removes a mis-logged touchpoint. Everything is deliberately deletable, including Gmail-synced rows: the route records the message id in `gmail_sync_exclusions` first (see Gmail integration → Tables) so the deletion sticks across sync passes. UI: hover-reveal 🗑 (class `tp-del-btn`, always visible ≤768px) on `TouchpointTimeline` entries (Overview tab) and the Activity Log cards in Donors.jsx — browser-confirm, optimistic removal, refetch on error. Grants.jsx also renders `TouchpointTimeline` but for `grant_interactions` rows — it passes no `onDelete`, so no icon there (this route only handles `interactions`)

### MGO toolkit tables
- `planned_gifts` — id, org_id, donor_id, type (bequest/charitable_remainder_trust/charitable_lead_trust/annuity/ira_beneficiary/life_insurance/real_estate/other), estimated_value, date_indicated, notes, created_at
- `donor_materials` — id, org_id, donor_id, file_name, file_type, file_url, file_data (base64 <1MB), notes, uploaded_by, uploaded_at. `donor_materials` and `planned_gifts` were missing from the org-deletion cascade (`DELETE /admin/orgs/:id`) — fixed to delete both (and `milestone_drafts`, `note_reminders`) BEFORE `donors`, since they carry `donor_id` FKs. See "Admin data integrity" below.

### Retention & stewardship (goals, impact metrics, milestone detection)
The system behind the pivot's staff-facing retention engine (see "Strategic pivot" at top) — notices patterns in donor data and drafts or suggests, a human always reviews and sends. No donor-facing surface, no donor login.

- `fundraising_goals` — id, org_id, period_start, period_end, goal_type (`lapsed_recovery`|`total_raised`), goal_amount, label, created_at. Only one goal is "active" at a time: `GET /goals/active` picks the most recently created row whose period contains today — creating a new overlapping goal replaces the prior one with no delete/deactivate step needed. `lapsed_recovery` progress is reconstructed live from gift history (a gift counts if it's a donor's most recent gift in the period AND followed a >365-day gap since their prior gift), not from a stage-history table. `POST /goals` is `checkWriteAccess`-gated.
- `impact_metrics` — id, org_id, name, dollar_threshold, outcome_template, active, created_at. Org-configured "at this cumulative giving amount, here's what it funded" copy — `dollar_threshold` doubles as cost-per-unit-of-impact used to compute `{n}` in the template (threshold=300 + donor total=1200 → n=4). Settings.jsx has a manager panel mirroring the Custom Fields UI pattern. `POST`/`PUT /impact-metrics/:id` are `checkWriteAccess`-gated.
- `milestone_drafts` — id, org_id, donor_id, sequence_enrollment_id, milestone_key, subject, body, status (`pending_review`|`dismissed`|`sent`), created_at, reviewed_by, sent_at. AI-drafted milestone/anniversary emails land here for staff review — deliberately never auto-sent. `MILESTONE_THRESHOLDS = [10000, 5000, 2500, 1000, 500]` (fixed checkpoints, separate from `impact_metrics` which is org-configured content for what to SAY, not when to fire) plus giving anniversaries (6-month, then yearly) detected in `computeMilestoneCandidates()`. `milestoneKey` (e.g. `threshold_1000`, `anniversary_year_3`) lets `autoEnroll()` tell a genuinely new milestone apart from one already handled, without a separate tracking table. `ensureMilestoneSequences()` lazily provisions one `trigger='milestone'` sequence per org that has configured ≥1 active `impact_metrics` row — content is generated per-donor by `generateMilestoneDraft()`, not from `sequence_steps.body` like other trigger types. Routes: `GET /milestone-drafts`, edit/dismiss/send under `/milestone-drafts/:id`.
- `note_reminders` — id, org_id, donor_id, sequence_enrollment_id, milestone_key, talking_points (JSONB), status (`pending`|`sent`|`dismissed`), created_at, sent_at, sent_by. Non-AI-drafted sibling of `milestone_drafts` — major milestones/anniversaries get a "write a personal note" nudge with real, computed talking points (`computeNoteTalkingPoints()`) instead of a drafted email. No note content is ever generated or stored — `talking_points` are reference facts only. `POST /note-reminders/:id/send` marks it sent and logs a `stewardship` interaction confirming a note went out (never writes the note's actual content); `POST /note-reminders/:id/dismiss`.
- `metric_snapshots` — id, org_id, metric_key, value, snapshot_date, created_at. UNIQUE(org_id, metric_key, snapshot_date) — re-snapshotting the same day updates in place. Generic daily history store shared by `stewardship_debt`/`first_touch_delay` and any future metric of the same shape (see "Product design patterns" below), rather than a bespoke table per metric. `GET /metrics/stewardship-summary` computes both metrics live on every call (never served stale-only) and persists today's snapshot as a side effect, on top of a periodic background snapshot job.

### Voice memo capture (shelved)
Backend, Whisper transcription, and extraction logic are fully built and functional — **shelved from the UI only** (2026-07-12) as an unproven-adoption-assumption bet, not a broken feature. Re-enable by uncommenting the `VoiceMemoModal` import/state/button in App.jsx and Donors.jsx (marked `// SHELVED — ...` at each site).
- Two-step, human-in-the-loop flow: `POST /voice-memos/transcribe` uploads audio + transcribes via Whisper + runs one narrow Claude extraction pass, but **saves nothing** — the officer reviews the transcript and suggestions client-side first. `POST /voice-memos/save` (checkWriteAccess) is the only route that persists anything (the interaction, and optionally the extracted detail/follow-up task, only for whichever the officer confirmed).
- Requires `OPENAI_API_KEY` (Whisper) — was never actually added to Railway, so this was never live end-to-end even before being shelved. If unset, `/voice-memos/transcribe` returns a clear 500 rather than failing silently or stubbing a fake transcript.
- `VoiceMemoModal` component still lives in shared.jsx, unused but intact.

### campaigns (extended)
- briefing TEXT — strategy/talking points, editable auto-save
- goal_amount NUMERIC, raised_amount NUMERIC DEFAULT 0
- start_date DATE, end_date DATE
- Raised is calculated live from gifts where campaign=name OR campaign_id=id

### MGO backend routes
- `GET /dashboard/my-stats` — 6 FY metrics for current user (portfolioCount, visitsYtd, madeYtd, giftsYtd, pipelineValue, lapsedCount); fiscal year July 1–June 30
- `GET /donors/:id/fund-affinity` — gifts grouped by fund_id with totals, counts, last dates, percentages; includes activeFunds for suggested asks
- `PUT /campaigns/:id/briefing` — save briefing, goal_amount, start_date, end_date (any campaign status)
- `GET /campaigns/:id/progress` — goal, raised (sum from gifts), donorCount, daysRemaining
- `PUT /gifts/:id`, `DELETE /gifts/:id` — inline gift editing/deletion
- `GET/POST /donors/:id/planned-gifts`, `PUT/DELETE /planned-gifts/:id` — planned giving CRUD
- `GET/POST /donors/:id/materials`, `DELETE /materials/:id` — donor materials CRUD

### DonorProfile tab system (left panel)
- Tabs: Overview | Gifts & Pledges | Funds | Materials | Activity
- Overview: stat cards, giving history chart, tags, notes, tasks, touchpoint timeline (unchanged)
- Gifts & Pledges: full gift table with inline edit/delete, Add Gift form with campaign attribution, CSV export, planned giving section
- Funds: fund affinity bars, restricted vs unrestricted split, suggested ask callouts
- Materials: drag-and-drop upload, base64 <1MB, view/delete grid
- Activity: mode toggle (Activity Log | Stewardship Timeline); type filter pills; Log Stewardship form (8 types); vertical timeline with auto-detected milestones

### Events tables
- `events` — id, org_id, name, event_type (gala/cultivation/site_visit/board_meeting/volunteer/webinar/other), date DATE, end_date DATE, location, description, capacity INTEGER, status (upcoming/completed/cancelled), revenue NUMERIC, cost NUMERIC, notes, created_at
- `event_attendees` — id, event_id (FK→events CASCADE), org_id, donor_id (FK→donors SET NULL), name, email, status (invited/confirmed/attended/no_show/cancelled), gift_amount NUMERIC, notes, UNIQUE(event_id, donor_id). PATCH to 'attended' + gift_amount > 0 auto-logs gift to donors/gifts/fin_transactions.
- Event type colors: gala=#8b5cf6, cultivation=#10b981, site_visit=#3b82f6, board_meeting=#0d5c3a, volunteer=#f59e0b, webinar=#ec4899, other=#6b7280
- Routes: GET/POST /events, PUT/DELETE/GET /events/:id, POST /events/:id/attendees, PATCH/DELETE /events/:id/attendees/:attendeeId, POST /events/:id/follow-up, GET /donors/:id/events

### Finance tables
- fin_transactions — id, org_id, date, description, amount, type (income/expense), category, fund_id, account_id, donor_id (nullable, set when synced from gift)
- fin_accounts — id, org_id, name, type (checking/savings/credit), balance, institution
- fin_funds — id, org_id, name, balance, target, restricted (boolean), description
- fin_budgets — id, org_id, category, amount, period (monthly/annual), fund_id
- fin_audit_log — id, org_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values
- LEGACY (do not use for new Finance UI): `financials` (monthly pre-aggregated rows) + `funds` (old fund balances), served by `GET /financials`. `Finance.jsx`'s Overview subtab used to read fund balances + monthly breakdown from this legacy pair via the `data.financials.*` prop, which had diverged from the live `fin_*` data shown on every other Finance subtab. Fixed: Overview now derives from the same `/finance/funds` + `/finance/transactions` state (`fundBalances`, computed client-side as income − expense per fund) that Funds/Accounts/Budgets/Reports/Transactions already use — including the 6-Month Forecast / Risk Analysis AI prompts. The `financials`/`funds` tables and `GET /financials` route still exist but should be treated as legacy/unused going forward.

### SaaS billing (platform)
- orgs table: `plan TEXT DEFAULT 'trial'`, `trial_ends_at TIMESTAMPTZ`, `stripe_customer_id TEXT`, `stripe_subscription_id TEXT`, `subscription_status TEXT DEFAULT 'trialing'`, `current_period_end TIMESTAMPTZ`, `grace_until TIMESTAMPTZ`
- Plans: `trial` | `seed` | `growth` | `impact`
- Subscription statuses: `trialing` | `active` | `past_due` | `canceled` | `trial_expired` (note: old rows may have `cancelled` with 2 l's — code handles both)
- `POST /auth/register-org` — public self-serve signup (creates Stripe customer inline; wrapped in try/catch that only logs on failure, so `stripe_customer_id` can still end up null — see `ensureStripeCustomer` below). The older `POST /auth/register` route (still mounted) never attempts Stripe customer creation at all.
- `GET /billing/status` — returns plan, subscriptionStatus, trialEndsAt, trialDaysLeft, graceUntil, currentPeriodEnd, accessState
- `ensureStripeCustomer(orgId, email)` helper — looks up `orgs.stripe_customer_id`; if null, creates a Stripe customer from the org name + given email, persists it, and returns it. `POST /billing/create-checkout` and `POST /billing/create-portal` both call this first instead of reading `stripe_customer_id` directly, so an org with no Stripe customer (legacy-route signup, or a failed inline creation) gets one transparently instead of the routes throwing "No Stripe customer linked to this org"
- `POST /billing/create-checkout` — creates Stripe Checkout session for subscription
- `POST /billing/create-portal` — creates Stripe Customer Portal session — for managing an *existing* subscription (payment method, invoices) only. NOT used by Reactivate/upgrade flows anymore (see PlanPicker below) since the Portal shows confusing empty states for an org with no subscription yet.
- `POST /billing/webhook` — handles checkout.session.completed (active + period_end + clear grace), invoice.payment_succeeded (active + period_end + clear grace), invoice.payment_failed (past_due + grace 7d), customer.subscription.deleted (canceled + grace 3d)
- `getOrgAccessState(org)` → `full | warning | read_only`. active/trialing → full; past_due/canceled within grace_until → warning; trial_expired or past/canceled past grace_until → read_only
- `checkWriteAccess` middleware: returns 402 `{error:"subscription_required"}` when read_only. Applied to all create/update routes across Donors, Grants, Volunteers, Tasks, Events, Campaigns, Board, and Custom Fields:
  `POST /donors`, `POST /donors/import-combined`, `PUT /donors/:id`, `POST /donors/:id/gifts`, `POST /gifts/import-history`,
  `POST /grants`, `PUT /grants/:id`,
  `POST /volunteers`, `PUT /volunteers/:id`,
  `POST /tasks`, `PUT /tasks/:id`,
  `POST /events`, `PUT /events/:id`, `POST /events/:id/attendees`, `PATCH /events/:id/attendees/:attendeeId`, `POST /events/:id/follow-up`,
  `POST /campaigns`, `PUT /campaigns/:id`, `PUT /campaigns/:id/briefing`, `POST /campaigns/:id/send`,
  `POST /board`,
  `POST /custom-fields`, `PUT /custom-fields/reorder`, `PUT /custom-fields/:id`,
  `POST /goals`, `POST /impact-metrics`, `PUT /impact-metrics/:id`, `POST /voice-memos/save`.
  DELETE routes are intentionally never gated (consistent across all of the above). Never blocks GET or export.
- `checkTrialExpiry()` job: sets trial_expired when trial_ends_at < NOW(). Runs on startup (+15s) + every 6h.
- Multi-state banner in App.jsx: read_only=red persistent; warning+past_due=amber update payment; warning+canceled=amber with grace date; trialing≤14d=green (amber at ≤3d). Warning/read_only not dismissible. "Reactivate" (read_only + canceled/warning banners) and "Choose a plan"/"Upgrade now" (trial banner) open `PlanPicker.jsx` → `POST /billing/create-checkout`, not the Portal. "Update payment" (past_due banner) still opens the Portal, since that org has an existing subscription/payment method to fix.
- Create/add buttons disabled with the `"Reactivate your subscription to make changes."` tooltip when `isReadOnly`, matching client-side the routes `checkWriteAccess` gates server-side: Add Donor/Log Gift/New Grant (Dashboard Quick Actions), Send Email (Dashboard Quick Action → Communications), "+ Add" (Donors), "+ Add Grant" (Grants List view AND Kanban view's own Add Grant button — these are two separate buttons), "+ New Campaign" (Communications), "+ New Event"/"Create Your First Event" (Events), "+ Add" (Tasks), "+ Add Volunteer" (Volunteers), "+ Add Board Member" (Board), "+ Add Field" (Settings custom fields)
- Settings.jsx billing badge: `BILLING_STATUS_META` lookup (label + bg/color/border per `subscriptionStatus`) covering `active | trialing | past_due | trial_expired | canceled | cancelled` — replaced an earlier ternary chain that had no `trial_expired` branch (fell through to "Trialing" for an org whose trial had actually ended)

### Stripe / donations
- orgs table: org_slug (text, unique), stripe_account_id, stripe_connected_at
- stripe_donations — id, org_id, amount, donor_name, donor_email, stripe_payment_intent_id, created_at, campaign_id (nullable)
- stripe_subscriptions — id, org_id, stripe_subscription_id, donor_email, amount, interval, status

### Recurring gift recovery (failed-payment dunning) — 2026-07-12
Nonprofits lose 20–30% of recurring giving to involuntary churn (expired/declined donor cards) with nobody ever noticing. This detects it, emails the donor a warm branded card-update link, surfaces revenue-at-risk to staff, and tracks recovery. Entirely about donors' recurring gifts on **connected** Stripe accounts — separate from `/billing/webhook` (Steward's own platform subscription).

- **`orgs`** — `recurring_dunning_enabled BOOLEAN DEFAULT true` (org-level kill switch), `recurring_dunning_subject`/`recurring_dunning_body` (nullable per-org template override, `{{token}}` convention matching campaign/sequence bodies; NULL = use the built-in `DEFAULT_DUNNING_SUBJECT`/`DEFAULT_DUNNING_BODY`).
- **`recurring_subscriptions`** — one row per donor subscription (health record layered on top of `donors.stripe_subscription_id`/`stripe_subscription_status`, which only ever hold `active`/`past_due`/`canceled` and can't distinguish `recovering`). Columns: id, org_id, donor_id, stripe_subscription_id (UNIQUE), stripe_customer_id, amount, interval, status (`active`\|`past_due`\|`recovering`\|`recovered`\|`canceled`), failure_count, first_failed_at, last_failed_at, recovered_at, canceled_at, dunning_step, next_dunning_at. Created `active` at subscription checkout (`checkout.session.completed`, mode=subscription) so every recurring gift has a row from day one — the `invoice.payment_failed` handler falls back to inserting one on the fly for a pre-existing subscription that never went through that path.
- **`payment_recovery_events`** — append-only log: id, org_id, donor_id, subscription_id, type (`payment_failed`\|`dunning_sent`\|`card_updated`\|`payment_recovered`\|`subscription_canceled`), stripe_event_id, detail (JSONB), created_at. `stripe_event_id` is the idempotency key — every webhook handler below checks `recoveryEventAlreadyProcessed(event.id)` before doing anything, so a redelivered Stripe event is a safe no-op. Also the source of truth for recovery-rate math (recovered vs. lost, `COUNT(DISTINCT subscription_id)` per type over a trailing window — the same subscription_id can appear in both buckets across separate failure cycles over time, which is correct: it measures event-level outcomes, not one final fate per subscription).

**Webhook handlers** (added to the existing `/stripe/webhook`, connected-account events — `event.account` → org via `stripe_account_id`, donor matched by `donors.stripe_subscription_id`, falling back to the subscription's own `metadata.donor_email`):
- `invoice.payment_failed` → upserts `recurring_subscriptions` to `past_due`, increments `failure_count`, sets `next_dunning_at=NOW()` (queues the day-0 send for the dunning engine's next tick, not sent synchronously in the webhook), mirrors `donors.stripe_subscription_status='past_due'`. Distinguishes a genuinely NEW failure cycle (previous status was `active`/`recovered`/`canceled` — restarts the cadence from day 0) from Stripe's own retry of the same invoice (already `past_due`/`recovering` — bumps `failure_count` but leaves the cadence alone, since resetting it on every Stripe-internal retry would spam the donor).
- `invoice.payment_succeeded` → if the subscription was `past_due`/`recovering`, marks `recovered`, mirrors donor `active`, sends a short thank-you email (gated on `recurring_dunning_enabled`). The actual gift/renewal recording is untouched — that's the pre-existing `payment_intent.succeeded` handler, fired separately by Stripe for the invoice's underlying charge; this handler never writes to `gifts`, so there's no double-record risk.
- `customer.subscription.updated` → safety net only: if Stripe's own status flips to `active` while our status is still `past_due`/`recovering` (Stripe's own smart retry resolved it without `invoice.payment_succeeded` landing first), syncs status/logs but does **not** re-send the thank-you (that's `invoice.payment_succeeded`'s job, expected to normally arrive first). Also keeps `amount` in sync on plan changes.
- `customer.subscription.deleted` → marks `canceled` — the "lost" outcome for recovery-rate math. Mirrors donor `stripe_subscription_status='canceled'`.
- `checkout.session.completed` (mode=`setup`) → the donor's card-update flow completing (see below): attaches the new payment method as the subscription's `default_payment_method`, then calls `stripe.invoices.pay()` on the latest open invoice immediately (so updating a card feels instant rather than waiting for Stripe's next scheduled retry) — the resulting `invoice.payment_succeeded` does the recovered/thank-you bookkeeping.

**Dunning engine** — `processDunning()`, module-level async function, same shape as `processSequences()`: runs on startup (`setTimeout`, 5s) and hourly (`setInterval`), also `POST /recurring/process-dunning` (requireAuth + requireAdmin, matches `/sequences/process`). `DUNNING_SCHEDULE_DAYS = [0, 3, 7, 14]` — fixed checkpoints measured from `first_failed_at` (not "N days after the last send"), so the schedule never drifts. Selects `recurring_subscriptions WHERE status IN ('past_due','recovering') AND next_dunning_at <= NOW()`, sends via `sendDunningEmail()` (skips if `recurring_dunning_enabled=false` or the address is suppressed), advances `dunning_step`, computes the next `next_dunning_at` from the schedule. After the final step, `next_dunning_at` is set NULL and Steward stops sending — status stays `recovering` until Stripe's own retries either resolve it (`invoice.payment_succeeded`) or exhaust and cancel it (`customer.subscription.deleted`).

**Donor card-update flow (public, no login)** — `signRecoveryToken(subscriptionId, orgId)`/`verifyRecoveryToken()` mirror `signUnsubscribeToken`/`verifyUnsubscribeToken` exactly (HMAC + `timingSafeEqual`, same pattern). `GET /recurring/update-card?token=...` verifies the token, creates a Stripe Checkout Session in `mode:"setup"` on the connected account, and redirects the donor to it. **Checkout setup mode was chosen over the Stripe Billing Customer Portal** because the Portal requires its own per-connected-account configuration (branding, enabled features) across every one of Steward's connected orgs — not something Steward can provision centrally — while a setup-mode Checkout Session is fully self-contained per request. Success redirects to `/give/:orgSlug?card_updated=true`, which `Donate.jsx` reads the same way it already reads `?donated=true`, showing a "Card updated — thank you!" confirmation (no donor login, no dashboard, no tiers/badges — see "Strategic pivot").

**Staff-facing surface**:
- `GET /dashboard/today` folds any donor with a `past_due`/`recovering` subscription into the same ranked queue (`upsertItem`, priority 85) as a `"Recurring gift failed — $X/mo at risk"` row; its action calls `POST /recurring/:donorId/resend` (requireAuth only, not requireAdmin — matches `POST /note-reminders/:id/send`, the other everyday "queue nudge" any staff member can trigger; doesn't touch `dunning_step`/`next_dunning_at`, so a manual resend never interferes with the automatic cadence).
- `GET /recurring/health` (requireAuth) → `{ activeCount, atRiskCount, mrrAtRisk, recoveredThisMonth, lostThisMonth, recoveryRate }`. Recovery rate = recovered / (recovered + lost) over a trailing 90-day window (`computeRecoveryRate()`), snapshotted daily into `metric_snapshots` (key `recovery_rate`) via the existing `snapshotMetricsForOrg()` — same reusable pattern as `stewardship_debt`/`first_touch_delay`. Dashboard.jsx shows a compact "$X/mo at risk · N donors · recovery rate Y%" card next to the funnel/next-grant tiles.
- `GET /donors/:id/recurring-subscription` (requireAuth) — per-donor health record backing the `DonorProfile` status chip (Active/Payment failed/Recovering/Recovered/Canceled) in the Gifts & Pledges tab, with a "Send card-update link" button when at-risk (isReadOnly-gated like other write buttons).

**Env vars**: `RECOVERY_SECRET` (optional — falls back to the same secret as `JWT_SECRET`/`UNSUB_SECRET` if unset; separated so the two token families can be rotated independently later without sharing a blast radius).

**Production setup required**: the Stripe Connect webhook endpoint must be subscribed to `invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted` for connected accounts — these are new event types this feature depends on; `payment_intent.succeeded`/`checkout.session.completed` already flow, confirming Connect delivery itself is live, but the four above still need to be added to the endpoint's subscribed events in the Stripe dashboard.

Tone/scope guardrails (deliberate): auto-send is correct here (unlike milestone/stewardship drafts, which stay human-reviewed) because failed-payment dunning is transactional and time-sensitive — standard practice, not a stewardship judgment call. No gamification language anywhere in the templates (no "tier"/"level"/"badge"/"leaderboard"); this is a stewardship touch, not a collections notice. No donor-facing dashboard, login, or donor-visible history — donor-side surface is limited to the dunning/thank-you emails and the one-time card-update Checkout session (see "Strategic pivot").

### Giving Pages — 2026-07-15
Campaign-specific donation pages, e.g. `/give/:orgSlug/:pageSlug` — distinct from the one org-wide `/give/:orgSlug` page, and **not** the same concept as the `campaigns` table (email campaigns). A gift can carry neither, either, or both of `gifts.campaign_id` (which *email* got them here) and `gifts.giving_page_id` (which *donation page* they gave through) — two independent questions.

- **`giving_pages`** — id, org_id, slug (unique per org, not globally — the public URL is already namespaced by org_slug), title, goal_amount, story, image_url, fund_id (nullable — a page designated to a fund IS that fund's ask, and `Donate.jsx` hides the fund selector when set), status (`active`\|`archived`), created_at, updated_at.
- **`gifts.giving_page_id`** — nullable, no FK constraint (deleting a page never fails/cascades; existing gifts simply keep an id that no longer resolves — same "tolerated dangling reference" pattern as elsewhere, see "Admin data integrity"). Progress bars are always `SUM(gifts.amount) WHERE giving_page_id = ?`, computed live, never a manually-set counter.
- **Archiving** (`PUT /giving-pages/:id`, `{status:'archived'}`) makes the public view route 404 (indistinguishable from never-existing) and makes `POST /donate/:orgSlug` reject new donations against it with 400 — both enforced by `WHERE status='active'` clauses, not a soft UI-only hide. Hard delete (`DELETE /giving-pages/:id`) is separate and irreversible; gifts already attributed to a deleted page are preserved (dangling reference, as above).
- `Donate.jsx` (`client/src/pages/Donate.jsx`) renders the org-wide page, every Giving Page, and every peer-to-peer fundraiser page (below) from one component — not three forks. It branches on whether `useParams()` has `pageSlug`/`fundraiserSlug`, fetches the matching public data endpoint, and threads `givingPageId`/`peerFundraiserId` into `POST /donate/:orgSlug`'s Stripe Checkout metadata.
- `QrCodeBlock`/`EmbedCodeBlock` (`client/src/components/ShareBlocks.jsx`) — one QR/embed mechanism parameterized by URL, reused for the org-wide page, each Giving Page, and each peer fundraiser's own link. Deliberately doesn't import the admin app's `T` design tokens (see file comment) — it renders on both the authenticated Settings screen and fully public pages, which carry their own separate token sets.
- Settings.jsx's `GivingPagesManager` — list/create/edit/archive/delete UI, each page's row expands into a "Share" panel (QR/embed) and (as of peer-to-peer fundraising below) a "Fundraisers" panel.

### Peer-to-peer fundraising — 2026-07-15
A supporter starts their own personal fundraiser under a live Giving Page — turning one donor-facing page into many supporter-facing ones, each shareable to a network the org itself has no relationship with. The single most-cited differentiator of Givebutter-style tools in this product's competitive research; everything else built this session makes Steward better at managing donors it already has, this is the one growth-loop feature.

- **`peer_fundraisers`** — id, org_id (denormalized from giving_page_id specifically so the codebase's "AND org_id = ?" convention — see "Org_id scoping" below — works directly on this table without every query needing the join), giving_page_id (`ON DELETE CASCADE` — a fundraiser cannot outlive its parent campaign, "no such thing as a fundraiser not tied to a campaign"), name, email, slug (unique per giving_page_id, not globally), personal_goal_amount, story, image_url, status (`active`\|`archived`), edit_token (unique, long random value), created_at, updated_at.
- **`gifts.peer_fundraiser_id`** — nullable, no FK (same tolerated-dangling-reference pattern as giving_page_id). A peer-fundraiser gift always carries **both** `peer_fundraiser_id` and the parent's `giving_page_id` — `POST /donate/:orgSlug` re-derives `giving_page_id` from the fundraiser row server-side rather than trusting the client, so the two can never disagree. This is what makes rollup free: the parent page's own `SUM(amount) WHERE giving_page_id=?` already includes every peer gift with zero extra aggregation, and the fundraiser's personal total is the identical pattern one level down (`SUM(amount) WHERE peer_fundraiser_id=?`).
- **No account system for v1** — `edit_token` (same shape as `invites.token`: two concatenated stripped UUIDs, 64 hex chars, stored and looked up directly) is the entire "manage your fundraiser" auth model. `POST /org/:orgSlug/giving-page/:pageSlug/fundraisers` (public, `donateLimiter`) creates the row and emails the supporter a `/fundraiser/manage/:token` link via `sendFundraiserManageEmail()` — **the token is deliberately never returned in the create response itself**, only via email to the address the caller claims is theirs. (Unlike `invites.token`, which is safely returned to the *authenticated admin's own* response because the caller is already a trusted, accountable staff member — this route is fully public and unauthenticated, so returning the token directly would let anyone submit a stranger's real name+email and get durable control of a page attributed to them.) `GET`/`PUT /peer-fundraisers/manage/:token` (public, own `fundraiserManageLimiter` — a separate budget from `donateLimiter` so a fundraiser owner editing their page can't get rate-limited out by unrelated donor traffic sharing their IP) can edit name/goal/story/image but never status/slug/email — status is admin-only (below), slug/email changes would break the link already shared.
- **Admin takedown** — anyone can spin up a public page under an org's name, so `GET /giving-pages/:id/fundraisers` (requireAuth) lists every fundraiser under a page in Settings.jsx's expandable "Fundraisers" panel, and `PUT /peer-fundraisers/:id` (requireAdmin + checkWriteAccess, status-only — not a general edit route, content edits are the owner's own business via their token) lets staff archive one immediately. Archiving has the exact same effect as archiving a Giving Page: the public fundraiser page 404s and `POST /donate/:orgSlug` rejects new donations against it. Both admin routes explicitly omit `edit_token` from their SELECT column list — the admin UI has no legitimate reason to see a supporter's own credential.
- **Leaderboard** (public Giving Page view, ranked by amount raised, active fundraisers only) — this is a fundraiser-facing leaderboard (people who opted in to solicit on the org's behalf), not the donor-facing tiers/badges/leaderboards the "Strategic pivot" section documents as deliberately rejected. That rejection was about gamifying a *donor's own* giving history in a donor-facing portal; this ranks *fundraisers'* voluntary campaign performance, the same standard mechanic every P2P fundraising product (walk-a-thons, Givebutter teams, GoFundMe teams) ships — a different concept, not a quiet reversal of that decision.
- New routes on `Donate.jsx`: `/give/:orgSlug/:pageSlug/:fundraiserSlug` (fundraiser's own public page, same component as the org-wide/Giving-Page cases) and `/fundraiser/manage/:token` (`ManageFundraiser.jsx` — separate lightweight page, not a `Donate.jsx` branch, since it's an edit form not a donation form).
- `client/src/pages/publicTheme.js` — shared `T`/`fmtMoney` for the app's fully public pages (`Donate.jsx`, `ManageFundraiser.jsx`), which render outside the authenticated app shell and don't use `components/shared.jsx`'s `T` (a different, admin-app palette). Factored out once a second public page needed the exact tokens `Donate.jsx` already had locally, rather than letting a hand-copied second `T` drift from the first.

### Tax Receipting & Year-End Giving Statements — 2026-07-16
Compliant, branded tax receipts for gifts, plus consolidated calendar-year giving statements per donor. **US-only v1, cash/cash-equivalent gifts only — explicit non-goals: no Canadian/CRA receipts, no in-kind gift receipting.** Statements are always **calendar year**, never fiscal year, even though the org's own fiscal year starts July 1 (see "Fiscal year" under CRITICAL WORKING RULES) — every date range in this feature's UI copy is labeled "tax year," not "fiscal year." The legal copy in the PDF/email templates is flagged for attorney review before being relied on in production — this is compliance-adjacent copy, not verified by counsel as part of this build.

- **`orgs`** — `legal_name`, `ein` (normalized to `XX-XXXXXXX`), `receipt_address`, `receipt_signature_name`, `receipt_signature_title`, `receipt_custom_message` (nullable per-org override, `{{token}}` convention), `receipts_enabled BOOLEAN DEFAULT false` (server refuses to flip true unless `legal_name`/`ein`/`receipt_address` are all present), `receipt_counter INTEGER DEFAULT 0` (atomic per-org receipt-number allocation via `UPDATE ... RETURNING`, never `SELECT MAX()+1`).
- **`gifts`** — `deductible_amount` (nullable; null means "equals amount", the common case — only set when a quid-pro-quo gift's deductible portion differs), `quid_pro_quo_desc`, `quid_pro_quo_value`.
- **`receipts`** — id, org_id, donor_id, gift_id (nullable — null for a `year_end` statement), type (`gift`\|`year_end`), tax_year (nullable — only set for `year_end`), receipt_number, amount, deductible_amount, `snapshot JSONB` (a frozen copy of everything the PDF needs, so a later edit to org tax settings never changes what an already-issued receipt says), pdf_data (base64), sent_to, sent_at, voided_at, void_reason, created_at. Two partial-unique indexes carry the real invariants: `receipts_active_gift_uk (gift_id) WHERE voided_at IS NULL AND type='gift'` (at most one active receipt per gift) and `receipts_active_statement_uk (org_id, donor_id, tax_year) WHERE voided_at IS NULL AND type='year_end'` (at most one active statement per donor per tax year).
- **`issueGiftReceipt(gift, org, donor, {send})`** (server.js) — the single choke point for gift receipts. Idempotent: checks for an existing active receipt before creating one (the partial-unique index is the second line of defense against a race between that check and the insert). Skips `is_sample` gifts and orgs with `receipts_enabled=false`. Renders the PDF via `renderReceiptPdf(snapshot)` (shared with year-end statements via internal branching on `snapshot.type`, avoiding a duplicate PDF-layout implementation), stores it, attempts a Resend email, and sets `gifts.acknowledgement_sent=true` **regardless of email outcome** — the PDF existing and being stored (downloadable/mailable by staff even if the send failed or the address is suppressed) is what satisfies the IRS "contemporaneous written acknowledgment" requirement (IRC §170(f)(8), IRS Pub 1771), not the send succeeding.
- **`issueYearEndStatement(org, donor, year, {send})`** — deliberately **supersede, not idempotent-reject**: regenerating a statement for a donor/year voids the prior active one (`void_reason='Superseded by a newly generated statement'`) and issues a fresh one covering all that year's gifts. Unlike a single gift's receipt, a donor's year-end statement legitimately needs regenerating as more of the year's gifts land — the partial-unique index still guarantees exactly one active statement per donor/year at any moment.
- **Routes**: `GET /receipts/preview` (sample PDF for Settings, doesn't touch the DB), `POST /receipts/year-end-run` (admin bulk-generate across all donors with tax_year gifts), `GET /receipts/:id/pdf` (streams stored PDF, requireAuth + org-scoped), `POST /receipts/:id/void`, `POST /gifts/:id/receipt` (`checkWriteAccess` — the one-click offline path, never automatic), `GET /donors/:id/receipts`, `POST /donors/:id/year-end-statement` (`checkWriteAccess`, body is `{year, send}` — not `taxYear`).
- **Webhook integration**: `payment_intent.succeeded` in `/stripe/webhook` fires `issueGiftReceipt` fire-and-forget after the existing gift-insert — this is the auto-send path for online gifts, gated purely on `org.receipts_enabled`.
- **Offline gifts are never automatic** — `POST /gifts/:id/receipt` is the only path for a manually-entered gift, by design: staff often backfill historical gift data they don't want re-receipted the moment it's entered.
- **Gift-edit-after-receipt-issued**: `PUT /gifts/:id` never auto-voids or auto-updates an existing receipt — a receipt is a legal record of what was actually sent to a donor, not something that should silently drift to match a later correction. Instead, `GET /dashboard/today` surfaces it for a human: a `receipt_mismatch` queue item (priority 70) when a receipted gift's amount/date has since changed or the gift was deleted (`LEFT JOIN gifts` so a deleted gift is caught too, comparing against `snapshot->>'giftDateRaw'`, the raw ISO date stored alongside the human-formatted `giftDate` specifically so this comparison doesn't need to reparse a formatted string).
- **Dashboard queue — "$250+ needs a tax receipt"** — `GET /dashboard/today`, priority **76** (deliberately one point above the pre-existing "not yet thanked" bucket's 75, not the same number — `upsertItem`'s tie-break is strict `<`, so a legally-required receipt needs to outrank, not tie, the stewardship nudge when both apply to the same offline gift; this was verified to actually happen at runtime, not just assumed from the priority numbers — see PROGRESS.md). Scoped to gifts ≥$250, unacknowledged, non-sample, within the last 60 days. In practice this bucket only ever surfaces offline gifts — online gifts auto-receipt near-instantly via the webhook and so already show `acknowledgement_sent=true` by the time this query runs.
- **Frontend**: `Settings.jsx`'s `TaxReceiptsManager` (module-scope component, mirrors the Impact Metrics/Custom Fields manager pattern) — legal/EIN/address/signature fields, a live PDF preview, and the year-end dry-run/generate-and-send controls. `DonorProfile`'s Gifts & Pledges tab gained a "Receipt" column per gift (`Receipt ✓ #2026-00042`, click → PDF download; or a one-click "Send receipt" button, `isReadOnly`-gated with the standard tooltip; a dash if receipts aren't enabled for the org) and a "Year-end statement" button + expandable panel in the tab header.
- **Cascades**: both the admin org-delete cascade (`DELETE /admin/orgs/:id`) and `clear-sample-data` delete `receipts` before `donors`/`gifts`, matching the FK-ordering convention documented under "Admin data integrity."
- **Verified**: real local Postgres + Stripe-Connect test infra (not mocks) — schema types spot-checked against what the code writes, EIN normalization, the enable-requires-legal-fields gate, one-click issue + idempotency + void + re-issue, year-end supersede behavior, both PDF types confirmed single-page (re-checked the pdfkit footer-overflow bug pattern specifically), the priority-76-beats-75 dashboard tie-break, and the mismatch bucket — all exercised live, plus a real Stripe-signed `payment_intent.succeeded` webhook (HMAC-signed with a `stripe listen`-issued secret, no live platform API key needed) POSTed to the real `/stripe/webhook` route, confirming the full auto-receipt path fires end-to-end from the actual production code. Full detail in PROGRESS.md's "Tax Receipting & Year-End Giving Statements" entry.

### Email campaigns
- email_campaigns — id, org_id, name, subject, body, audience, status, sent_at, open_count
- email_opens — id, campaign_id, opened_at, donor_id (nullable)

## Vercel config
- Root directory: blank (not "client")
- vercel.json at project root handles build
- client/vercel.json has VITE_API_URL env var
- GitHub connected: auto-deploys on push to main
- Custom domain: stewardapp.dev → DNS via Vercel nameservers
- Resend domain verified: stewardapp.dev, sends from noreply@stewardapp.dev

## What's built
- Auth + 5-step onboarding that finishes with real data (org basics → import donors → set first goal → first impact metric → finish) — see "Onboarding flow" above
- Dashboard — now an **action-queue-first home screen**, not a KPI stat grid: goal banner (from `fundraising_goals`), "Needs Your Attention" queue (milestone drafts, note reminders, lapsed donors, never-contacted donors — mixed and prioritized), pipeline funnel, next-grant-deadline tile (deep-links into GrantProfile via `initialGrantId`), Stewardship Debt / First-Touch Delay headline metrics (see "Product design patterns"). The old hero stat cards, AI daily briefing, Quick Actions sidebar, and standalone Recent Activity feed are gone, not just restyled — deep-links go straight to Communications' Milestone Drafts queue (`initialNav`/`highlightDraftId`) or a donor profile.
- Donors — Kanban pipeline, CSV import (now also the centerpiece of onboarding step 2 — `DonorImport` exported from Donors.jsx), AI features, editing, interaction timeline (dynamic templates by type: Call/Meeting/Email/Event/Gift/Other), auto follow-up task on touchpoint save, wealth score card (5-component scoring, DB columns, recalculate button), per-donor Impact Summary PDF download (`GET /donors/:id/impact-summary/pdf`)
- Grants — CRUD, AI strategy, LOI drafting, grant discovery (FindGrants merged into Grants tab)
- Communications — segmented email campaigns (Resend HTTP API), AI copy, open rate tracking via pixel, audience filters, Sequences, **Milestone Drafts review queue** (staff approves/edits/dismisses AI-drafted milestone emails before sending — see "Retention & stewardship")
- Finance, Volunteers, Board, Tasks — **hidden from nav** as of the 2026-07-12 pivot (see "Strategic pivot" at top); code/routes/tables fully intact, reversible by uncommenting. (Analytics was hidden by the same pivot but then deleted outright 2026-07-16 — see Strategic pivot.) Descriptions below are the still-accurate feature list, kept for whenever these are re-enabled:
  - Finance — 6-tab module: Overview (P&L, fund balances, AI forecast), Transactions (CRUD, filter), Accounts, Funds (sparklines), Budgets, Reports; donor gifts auto-sync to fin_transactions; full audit log
  - Volunteers — hours tracking, conversion to donor, board candidate AI
  - Board — giving levels, attendance, committees, AI board report
  - Tasks — priority queue, AI prioritization, add/complete, due dates
- Settings — Stripe Connect Express flow, QR code generator, embeddable iframe widget, team management, invite staff (email + link fallback), Custom Fields manager, **Impact Metrics manager** (same UI pattern as Custom Fields), NO billing/plan UI; Demo Data card (gold left border) at top
- Sample data loader — `POST /org/load-sample-data` (refused if >5 real donors; seeds 25 donors across all stages, gifts, funds, transactions, grants, events, campaign, interactions, tasks, volunteers, board members; all tagged `is_sample=true`); `POST /org/clear-sample-data` (per-table `.catch(()=>{})` deletes); `GET /org/sample-data-status` → `{ hasSampleData, sampleDonorCount }`; DirectoryView shows inviting empty state with Load button when org has 0 donors; also offered inline on onboarding's "ready" screen when a new org skipped CSV import and still has 0 donors
- RBAC — requireAdmin middleware, admin/staff roles
- Public donation page (/give/:orgSlug) — Stripe Checkout, campaign links, recurring gifts via Subscriptions, email gift request from donor profile
- Recurring gift recovery — detects failed/expired-card payments on donors' recurring gifts (invoice.payment_failed on the connected Stripe account), auto-sends a warm branded card-update link on a fixed 0/3/7/14-day cadence, tracks recovery, and surfaces revenue-at-risk + recovery rate to staff (home-screen queue + card, DonorProfile status chip) — see "Recurring gift recovery" under Database
- Tax receipting & year-end giving statements — auto-sent IRS-compliant receipts for online gifts once an org completes tax settings, one-click (never automatic) receipts for offline gifts, consolidated calendar-year statements per donor, staff queue for un-receipted $250+ gifts — see "Tax Receipting & Year-End Giving Statements" under Database. US-only, cash/cash-equivalent gifts only in v1
- Landing page — rewritten for the pivot (2026-07-12): fake testimonials removed, honest "Where Steward Is Today" section added, real product screenshot (not a mockup), Features section updated to match what's actually live (Finance & Reporting card replaced with Gmail sync); simplified favicon (icon-only, no wordmark); mobile: dark stats card, hamburger nav; NO pricing section

## What's NOT built (despite prior docs)
- **No guided tour / OnboardingWizard component exists.** One was built and then deleted the same day (commit b9fcf7a, "Kill guided tour...", 2026-06-07) — PROGRESS.md documented the build but was never updated for the removal until this pass. Do not assume `GuidedTour`/`OnboardingWizard` exists without checking the actual file tree first.
- **No general-purpose AI chat.** `AIChat` (the floating "Ask AI" overlay, previously exported from Dashboard.jsx) was deleted entirely, not hidden — see "Strategic pivot."
- **No donor-facing portal, donor login, or donor-visible tiers/badges** — explored and deliberately rejected, see "Strategic pivot."

## Key patterns
- TpField and TpYesNo MUST stay at module level (not inside components) — defined in shared.jsx. Moving them inside a component causes React to remount inputs on every keystroke.
- Donor wealth score: POST /donors/:id/wealth-score → calcWealthScore() uses 5 components (giving history, recency, frequency, capacity signals, engagement). DB columns: wealth_score, capacity_tier, score_confidence, score_last_updated, score_rationale. TIER_COLOR maps tier → hex color.
- Finance sync: every gift saved via POST /donors/:id/gifts also inserts a row in fin_transactions with donor_id set — one-way sync, no double-write on edit.
- Sample data flag: `is_sample BOOLEAN DEFAULT false` column exists on donors, gifts, grants, events, event_attendees, campaigns, interactions, tasks, fin_transactions, fin_funds, volunteers, board_members. Clear route deletes in FK-safe order (children before parents). Sample funds use hardcoded IDs: `fund_smpl_general`, `fund_smpl_edu`, `fund_smpl_capital`.
- STAGES in shared.jsx is an object array (with color/label). Communications.jsx uses a plain string array called STAGE_LIST — kept separate to avoid shadowing. **(2026-07-15)** Stage colors are locked to the five-color palette (see "Design system"): prospect=bgElevated, qualify=gold, cultivate=greenMid, solicit=green(accent), steward=greenDk, lapsed=terracotta — deliberately alternating green shades with gold/terracotta rather than four greens in a row, so adjacent pipeline stages stay visually distinct. prospect specifically avoids `T.ink` because that's the literal hex the Donor Kanban's column-header background already renders on (`Donors.jsx`'s `DonorKanban`), which would make prospect's left-border accent invisible against its own column. This cascades automatically to the Pipeline Funnel (Home), Donor Kanban, and the CSV-import stage-assignment preview (`Donors.jsx`'s `STAGE_COLORS`, now derived from `STAGES` instead of a separate hand-maintained palette). (It previously also cascaded to Analytics' Pipeline Velocity chart — Analytics deleted 2026-07-16.)
- All AI features stream through /ai/stream on backend via askClaude (= streamAI from api.js).
- Stripe Connect: POST /stripe/connect returns a Stripe account link URL; /stripe/webhook handles payment_intent.succeeded and checkout.session.completed.
- Activity log templates: LogTouchpointModal in Donors.jsx has per-type prompt templates. On save, if type is Call/Meeting, a follow-up task is silently created and a toast shown.
- Mobile: GlobalStyles() in shared.jsx is the single CSS home for all @media(max-width:768px) rules. Use className + !important to override inline JSX styles.

## Product design patterns
- **Name the vague anxiety as a number.** When a feature is answering a fuzzy staff worry ("are we neglecting our best donors?", "are new donors falling through the cracks?"), don't default to a generic stat card — compute it into one concrete, trackable, trending number instead. Two examples so far, sharing the same `metric_snapshots` table/trend mechanism (org_id, metric_key, value, snapshot_date; one row per org+metric+day, `snapshotMetricsForOrg()`/`snapshotAllOrgMetrics()` in server.js) rather than a bespoke history table per metric:
  - `stewardship_debt` — donors weighted by (days since last meaningful contact) × (giving significance), summed across the portfolio. Up = donors are going quiet relative to what they've given.
  - `first_touch_delay` — average days between a donor's first gift and their first personal (non-gift) touch. Up = new donors waiting longer for a human response.
  Both are computed live on every `GET /metrics/stewardship-summary` call (never served stale-only) and featured as a headline number on the home screen (Dashboard.jsx), not buried in a stat grid. When building the next feature that's really answering an anxiety rather than reporting a fact, reach for this pattern — a real formula + a trend — before reaching for a plain count or dollar total.

## Email Sequences

### Tables
- `sequences` — id, org_id, name, trigger (`lapsed_90`|`lapsed_180`|`new_donor`|`stage_change`|`manual`|`onboarding`), trigger_stage, status (`active`|`paused`), created_at
- `sequence_steps` — id, sequence_id (FK→sequences ON DELETE CASCADE), step_order, delay_days, subject, body
- `sequence_enrollments` — id, sequence_id, org_id, donor_id, enrolled_at, current_step, status (`active`|`completed`|`unsubscribed`|`bounced`), next_send_at, completed_at. UNIQUE(sequence_id, donor_id)

### Engine pattern
- `processSequences()` + `autoEnroll()` in server.js (module-level async functions)
- Called on startup via `setTimeout(fn, 5000)` and every hour via `setInterval(fn, 3600000)`
- Also exposed as `POST /sequences/process` (admin-only) for manual trigger
- Email sent via `resend.emails.send()` using `DEMO_SMTP_FROM` env var (or `FOUNDER_EMAIL` for onboarding trigger)
- Interaction logged to `interactions` table on each send (skipped for `onboarding` trigger — donor_id stores user_id)
- INTERVAL with variable days uses template literal: `` `INTERVAL '${parseInt(n,10)} days'` `` (safe — n is integer from DB)
- Token replacements: `{{donor_name}}`, `{{user_name}}`, `{{first_name}}` (first word of name), `{{org_name}}`

### Onboarding trigger
- Trigger type `'onboarding'` is reserved for the signup drip sequence — excluded from `autoEnroll()`
- `sendOnboardingSequence(orgId, userId, userName, userEmail)` called fire-and-forget at end of `POST /auth/register-org`
- Stores `userId` in `donor_id` column of `sequence_enrollments` (no FK constraint on that column)
- `processSequences()` detects `seq_trigger === "onboarding"` and looks up `users` table instead of `donors`
- Sender: `FOUNDER_EMAIL` env var (default `jonathan@stewardapp.dev`), with `reply_to` set to same
- 7 steps at delay_days: 0, 2, 4, 7, 10, 18, 28

### Frontend
- Sequences subtab in Communications.jsx sidebar nav (after Analytics)
- `SequencesPanel` and `SeqStep` are module-level components (before `export function Communications`)
- DonorProfile (Donors.jsx) has inline enroll dropdown — `sequences` prop passed from `Donors` component which fetches `GET /sequences` on mount

### Route ordering note
`POST /sequences/process` is declared BEFORE `GET /sequences/:id` routes to prevent Express matching "process" as an :id param

## Custom Fields
- `custom_fields` table: id, org_id, label, field_type (text/number/date/dropdown/checkbox), options (JSONB), required (boolean), field_order, show_in_directory (boolean, default false), created_at
- `custom_field_values` table: id, org_id, donor_id, field_id (FK→custom_fields ON DELETE CASCADE), value (TEXT), updated_at. UNIQUE(donor_id, field_id)
- `GET /custom-fields` — list org fields ordered by field_order
- `POST /custom-fields` — create field (admin only)
- `PUT /custom-fields/reorder` — reorder fields by passing `ids` array (MUST be declared before `PUT /custom-fields/:id`)
- `PUT /custom-fields/:id` — update field (admin only)
- `DELETE /custom-fields/:id` — deletes values then field (admin only)
- `GET /donors/custom-field-values/all` — returns all custom_field_values for the org as `[{donorId, fieldId, value}]`. Declared BEFORE `GET /donors/:id` to avoid Express collision.
- `GET /donors/:id/custom-fields` — returns fields + values joined (LEFT JOIN) for a donor
- `POST /donors/:id/custom-fields` — upsert a value for a field on a donor (ON CONFLICT DO UPDATE)
- Settings.jsx: Custom Fields section between Team Members and Account Actions. Field manager with add/edit/delete. Dropdown type shows option builder.
- DonorProfile (Donors.jsx): Custom Fields section shown only when org has custom fields (cfData.length > 0). Inline edit per field with appropriate input type.

## Board Reports
- `board_reports` table: id, org_id, quarter, year, generated_at, generated_by, generated_by_name, metrics (TEXT/JSON), pdf_data (TEXT/base64)
- `GET /reports/board` — list past reports (no pdf_data in response)
- `GET /reports/board/:id/pdf` — stream stored PDF back as binary (requireAuth + org scoped)
- `POST /reports/board` — generate report: pulls live Finance/Donor/Grant/Comms/Task data, calls claude-sonnet-4-6 for 3-para executive summary, builds 5-page PDF via pdfkit (bufferPages: true), saves pdf_data as base64, returns PDF binary
- pdfkit installed: `pdfkit ^0.18.0` in package.json
- Board.jsx subtabs: "members" | "reports"; raw fetch() for binary PDF download (not apiFetch)
- **`GET /donors/:id/impact-summary/pdf`** (requireAuth) — one-page printable/mailable per-donor PDF: cumulative giving, milestones reached, org-configured impact translations from `impact_metrics`. Reuses the same pdfkit pattern as `/reports/board` (buffer-to-Promise, page-footer loop) rather than a new rendering system.
- **pdfkit footer bug, fixed in both routes**: footer text drawn at `y = page.height - 28` sits below pdfkit's default `maxY` (page.height − bottom margin), which silently auto-triggers a page break on each footer `.text()` call — the Impact Summary PDF was spilling onto 3 pages instead of 1, found via a live download test against the demo account (`fac46d4`), then the identical latent bug was proactively fixed in the older Board Report PDF too (`6159672`). Fix: pass an explicit `height` option on the footer `.text()` calls so pdfkit doesn't treat it as overflow.

## Current priorities
- Stripe live mode: confirmed working (production keys active)
- Email: Resend SPF/DKIM verified, sending from noreply@stewardapp.dev
- Custom domain: stewardapp.dev live and routing correctly on all paths
- **QA sweep dated 2026-07-10 (`QA_REPORT.md`) — both Blocking findings now confirmed resolved (2026-07-16 code-inspection pass, not a live re-run of the Playwright suite itself)**: #1 signup mobile overflow — `shared.jsx`'s `GlobalStyles()` `@media(max-width:768px)` block has `.signup-shell`/`.signup-left`/`.signup-right`/`.signup-card` rules matching `SignupPage.jsx`'s actual class names, stacking correctly. #2 read-only/`checkWriteAccess` gaps — confirmed both server-side (`checkWriteAccess` present on the documented route list, see "SaaS billing" below) and client-side (`isReadOnly`-gated buttons present in Volunteers.jsx, Tasks.jsx, Events.jsx, Communications.jsx, Board.jsx, Settings.jsx, matching the button list already documented in "SaaS billing" below). This file previously said both findings were "possibly still open" pending re-verification — they were already fixed by the time that caution was written, same staleness pattern as `SECURITY_REPORT.md` (see below).
- **`SECURITY_REPORT.md`'s 2026-07-10 findings — CRITICALs (C1–C4), the RBAC gap, and the file-upload gap are all confirmed fixed** (re-verified 2026-07-16, see the file's own inline update notes for exact file:line evidence). The Giving Pages/peer-to-peer fundraising surface (built after that report) was separately audited 2026-07-16 with no CRITICALs found; two small gaps found there (a stale RBAC comment, missing input validation on the admin Giving Pages routes) are also fixed. The only items from the original 2026-07-10 report **not** re-verified: the §1 org-scoping edge cases (`programs/:id/grants` link+delete, `gmail/send`→`interactions`, `finance/transactions`) and the JWT-algorithm-pinning hardening recommendation (§5) — still open.
- **Data integrity check requested but not completed**: after manually deleting several test-user rows from Supabase's Table Editor, the user asked for a check of orphaned orgs (no matching `users` row), specifically whether `org_ec6340db` ("SMOKE TEST — DELETE ME") still exists and needs deleting, and any dangling FK references (`created_by`/`assigned_to`/etc.) to the deleted user IDs. Tooling for this was built (see "Admin data integrity" below) but the actual queries were never run against production — blocked on missing super-admin credentials in that session. Still needs to be run.

## Org_id scoping (security)
- All donor/grant/task/volunteer/board endpoints use AND org_id = ? on SELECT, UPDATE, DELETE
- calcWealthScore scopes gifts and interactions queries by both donor_id AND org_id
- Stripe webhook looks up org by stripe_account_id (per-org), then inserts scoped records
