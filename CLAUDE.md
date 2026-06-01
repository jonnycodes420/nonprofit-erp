# Steward — Nonprofit ERP SaaS

## Stack
- Frontend: React 18 + Vite → deployed on Vercel
- Backend: Node + Express → deployed on Railway
- Database: Supabase PostgreSQL
- Auth: JWT written directly to localStorage (npe_token, npe_user, npe_org)
- AI: Anthropic SDK (claude-sonnet-4-6)
- Email: Resend HTTP API (noreply@stewardapp.dev)
- Payments: Stripe Connect Express

## Live URLs
- Frontend: https://client-five-tau-13.vercel.app (also stewardapp.dev via Vercel nameservers)
- Backend: https://nonprofit-erp-production.up.railway.app
- GitHub: github.com/jonnycodes420/nonprofit-erp
- Demo login: admin@creoarts.org / demo1234

## Required Environment Variables
### Backend (Railway)
- `ANTHROPIC_API_KEY` — claude-sonnet-4-6
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase service role key
- `JWT_SECRET` — JWT signing secret
- `RESEND_API_KEY` — Resend API key for email campaigns
- `STRIPE_SECRET_KEY` — Stripe platform secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `FRONTEND_URL` — used in invite links and Stripe redirects

### Frontend (Vercel / client/vercel.json)
- `VITE_API_URL` — Railway backend URL

## Project structure
- /client/src/App.jsx — AppShell + TABS + App (147 lines, imports from components/)
- /client/src/main.jsx — router, auth context, route guards
- /client/src/pages/Landing.jsx — public landing page (relational copy, mobile responsive)
- /client/src/pages/LoginPage.jsx — login, writes localStorage directly
- /client/src/pages/SignupPage.jsx — signup
- /client/src/pages/WelcomePage.jsx — 3-step onboarding (focus select → animated setup → launch)
- /client/src/pages/GivePage.jsx — public donation page at /give/:orgSlug
- /client/src/api.js — apiFetch, streamAI, adaptData helpers
- /server.js — Express backend (all routes)
- /auth.js — auth middleware (requireAuth, requireAdmin)
- /db.js — Supabase client

## Active tabs (App.jsx TABS array)
dashboard → donors → grants → communications → finance → volunteers (earlyAccess) → board (earlyAccess) → tasks → settings

Mobile bottom bar: dashboard, donors, grants, finance
Mobile "More" drawer: communications, volunteers, board, tasks, settings

## Component files (client/src/components/)
- shared.jsx — T (design tokens), fmt, fmtFull, daysDiff, daysUntil, SC, askClaude, buildContext, STAGES, STAGE_THRESH, STAGE_ACTION, TIER_COLOR, donorScore, retentionRisk, moveUrgency, GlobalStyles, Spin, Pill, Card, SectionLabel, AIBtn, AIPanel, MetricCard, EmptyState, PageTitle, GivingHistoryChart, TpField, TpYesNo, TouchpointTimeline
- Dashboard.jsx — exports AIChat (global chat overlay), Dashboard (hero stats, AI briefing, pipeline snapshot, lapsed alert, grant deadlines, recent giving, quick actions, tasks, activity feed)
- Donors.jsx — exports Donors (includes DonorImport, FollowUpTaskModal, LogTouchpointModal, EditDonorModal, DonorProfile, DonorKanban, ReEngageView internally)
- Grants.jsx — exports Grants (includes GrantProfile, FindGrants internally)
- Communications.jsx — exports Communications (email campaigns, templates, audience segmentation, Resend API, open tracking)
- Volunteers.jsx — exports Volunteers
- Board.jsx — exports Board
- Finance.jsx — exports Finance (6 tabs: Overview, Transactions, Accounts, Funds, Budgets, Reports; includes fund sparklines)
- Tasks.jsx — exports Tasks
- Settings.jsx — exports Settings (Stripe connect, QR code, donation widget embed, team management, invite modal)

## Routing (IMPORTANT)
- / → Landing (public)
- /login → LoginPage (public)
- /signup → SignupPage (public)
- /welcome → WelcomePage (auth required)
- /dashboard → App/AppShell (auth + onboarded required)
- /give/:orgSlug → GivePage (public donation page)
- App.jsx renders <AppShell /> directly — NO internal router

## Auth (IMPORTANT)
- Login writes npe_token, npe_user, npe_org to localStorage directly
- LoginPage uses hardcoded fetch() to Railway URL, not apiFetch
- onboarding_complete comes back as 1 (number) not true (boolean)
- After login: window.location.href = "/dashboard"
- RequireOnboarded guard in main.jsx checks both auth AND onboarding_complete; redirects to /welcome if onboarding_complete is 0

## Onboarding flow (IMPORTANT)
- Signup → /welcome (RequireAuth, not RequireOnboarded)
- WelcomePage: 3 steps — Step 0: focus selection (donors/grants/finance/all); Step 1: animated setup (calls POST /onboarding/complete); Step 2: launch
- POST /onboarding/complete calls seedOrgData(orgId) then sets onboarding_complete=1
- seedOrgData seeds ONLY structural data: 26-account chart of accounts + one General Operating fund (no fake donors/grants/financials)
- New orgs get a true blank slate — no sample data
- InvitePage: dark theme; invited staff land on /dashboard (org already onboarded)

## Database — key tables and columns
### donors
- wealth_score (integer), capacity_tier (text), score_confidence (text), score_last_updated (timestamptz), score_rationale (text) — wealth scoring system
- stage (text), total_giving, last_gift_date, last_gift_amount, gift_count, tags (jsonb), notes

### Finance tables
- fin_transactions — id, org_id, date, description, amount, type (income/expense), category, fund_id, account_id, donor_id (nullable, set when synced from gift)
- fin_accounts — id, org_id, name, type (checking/savings/credit), balance, institution
- fin_funds — id, org_id, name, balance, target, restricted (boolean), description
- fin_budgets — id, org_id, category, amount, period (monthly/annual), fund_id
- fin_audit_log — id, org_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values

### Stripe / donations
- orgs table: org_slug (text, unique), stripe_account_id, stripe_connected_at
- stripe_donations — id, org_id, amount, donor_name, donor_email, stripe_payment_intent_id, created_at, campaign_id (nullable)
- stripe_subscriptions — id, org_id, stripe_subscription_id, donor_email, amount, interval, status

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
- Auth + 3-step onboarding (blank slate — chart of accounts + General Operating fund only)
- Dashboard — hero stat cards, AI daily briefing (pull quote + expandable), donor pipeline snapshot, lapsed donor alert, grant deadlines, recent giving, online gifts (Stripe), quick actions, tasks this week, activity feed
- Donors — Kanban pipeline, CSV import, AI features, editing, interaction timeline (dynamic templates by type: Call/Meeting/Email/Event/Gift/Other), auto follow-up task on touchpoint save, wealth score card (5-component scoring, DB columns, recalculate button)
- Grants — CRUD, AI strategy, LOI drafting, grant discovery (FindGrants merged into Grants tab)
- Communications — segmented email campaigns (Resend HTTP API), AI copy, open rate tracking via pixel, audience filters
- Finance — 6-tab module: Overview (P&L, fund balances, AI forecast), Transactions (CRUD, filter), Accounts, Funds (sparklines), Budgets, Reports; donor gifts auto-sync to fin_transactions; full audit log
- Volunteers — hours tracking, conversion to donor, board candidate AI
- Board — giving levels, attendance, committees, AI board report
- Tasks — priority queue, AI prioritization, add/complete, due dates
- Settings — Stripe Connect Express flow, QR code generator, embeddable iframe widget, team management, invite staff (email + link fallback), NO billing/plan UI
- RBAC — requireAdmin middleware, admin/staff roles
- Public donation page (/give/:orgSlug) — Stripe Checkout, campaign links, recurring gifts via Subscriptions, email gift request from donor profile
- Landing page — relational copy, Steward definition section, Who We Serve, What We Do, Consulting section, announcement bar, NO pricing section; mobile: dark stats card (8+/100%/$0), hamburger nav

## Key patterns
- TpField and TpYesNo MUST stay at module level (not inside components) — defined in shared.jsx. Moving them inside a component causes React to remount inputs on every keystroke.
- Donor wealth score: POST /donors/:id/wealth-score → calcWealthScore() uses 5 components (giving history, recency, frequency, capacity signals, engagement). DB columns: wealth_score, capacity_tier, score_confidence, score_last_updated, score_rationale. TIER_COLOR maps tier → hex color.
- Finance sync: every gift saved via POST /donors/:id/gifts also inserts a row in fin_transactions with donor_id set — one-way sync, no double-write on edit.
- STAGES in shared.jsx is an object array (with color/label). Communications.jsx uses a plain string array called STAGE_LIST — kept separate to avoid shadowing.
- All AI features stream through /ai/stream on backend via askClaude (= streamAI from api.js).
- Stripe Connect: POST /stripe/connect returns a Stripe account link URL; /stripe/webhook handles payment_intent.succeeded and checkout.session.completed.
- Activity log templates: LogTouchpointModal in Donors.jsx has per-type prompt templates. On save, if type is Call/Meeting, a follow-up task is silently created and a toast shown.
- Mobile: GlobalStyles() in shared.jsx is the single CSS home for all @media(max-width:768px) rules. Use className + !important to override inline JSX styles.

## Email Sequences

### Tables
- `sequences` — id, org_id, name, trigger (`lapsed_90`|`lapsed_180`|`new_donor`|`stage_change`|`manual`), trigger_stage, status (`active`|`paused`), created_at
- `sequence_steps` — id, sequence_id (FK→sequences ON DELETE CASCADE), step_order, delay_days, subject, body
- `sequence_enrollments` — id, sequence_id, org_id, donor_id, enrolled_at, current_step, status (`active`|`completed`|`unsubscribed`|`bounced`), next_send_at, completed_at. UNIQUE(sequence_id, donor_id)

### Engine pattern
- `processSequences()` + `autoEnroll()` in server.js (module-level async functions)
- Called on startup via `setTimeout(fn, 5000)` and every hour via `setInterval(fn, 3600000)`
- Also exposed as `POST /sequences/process` (admin-only) for manual trigger
- Email sent via `resend.emails.send()` using `DEMO_SMTP_FROM` env var
- Interaction logged to `interactions` table on each send
- INTERVAL with variable days uses template literal: `` `INTERVAL '${parseInt(n,10)} days'` `` (safe — n is integer from DB)

### Frontend
- Sequences subtab in Communications.jsx sidebar nav (after Analytics)
- `SequencesPanel` and `SeqStep` are module-level components (before `export function Communications`)
- DonorProfile (Donors.jsx) has inline enroll dropdown — `sequences` prop passed from `Donors` component which fetches `GET /sequences` on mount

### Route ordering note
`POST /sequences/process` is declared BEFORE `GET /sequences/:id` routes to prevent Express matching "process" as an :id param

## Custom Fields
- `custom_fields` table: id, org_id, label, field_type (text/number/date/dropdown/checkbox), options (JSONB), required (boolean), field_order, created_at
- `custom_field_values` table: id, org_id, donor_id, field_id (FK→custom_fields ON DELETE CASCADE), value (TEXT), updated_at. UNIQUE(donor_id, field_id)
- `GET /custom-fields` — list org fields ordered by field_order
- `POST /custom-fields` — create field (admin only)
- `PUT /custom-fields/reorder` — reorder fields by passing `ids` array (MUST be declared before `PUT /custom-fields/:id`)
- `PUT /custom-fields/:id` — update field (admin only)
- `DELETE /custom-fields/:id` — deletes values then field (admin only)
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

## Current priorities
- Stripe live mode: confirmed working (production keys active)
- Email: Resend SPF/DKIM verified, sending from noreply@stewardapp.dev
- Custom domain: stewardapp.dev live and routing correctly on all paths

## Org_id scoping (security)
- All donor/grant/task/volunteer/board endpoints use AND org_id = ? on SELECT, UPDATE, DELETE
- calcWealthScore scopes gifts and interactions queries by both donor_id AND org_id
- Stripe webhook looks up org by stripe_account_id (per-org), then inserts scoped records
