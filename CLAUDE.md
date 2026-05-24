# Steward — Nonprofit ERP SaaS

## Stack
- Frontend: React 18 + Vite → deployed on Vercel
- Backend: Node + Express → deployed on Railway  
- Database: Supabase PostgreSQL
- Auth: JWT written directly to localStorage (npe_token, npe_user, npe_org)
- AI: Anthropic SDK (claude-sonnet-4-6)

## Live URLs
- Frontend: https://client-five-tau-13.vercel.app
- Backend: https://nonprofit-erp-production.up.railway.app
- GitHub: github.com/jonnycodes420/nonprofit-erp
- Demo login: admin@creoarts.org / demo1234

## Project structure
- /client/src/App.jsx — AppShell + TABS + App (147 lines, imports from components/)
- /client/src/main.jsx — router, auth context, route guards
- /client/src/pages/Landing.jsx — public landing page
- /client/src/pages/LoginPage.jsx — login, writes localStorage directly
- /client/src/pages/SignupPage.jsx — signup
- /client/src/pages/WelcomePage.jsx — onboarding wizard
- /client/src/api.js — apiFetch, streamAI, adaptData helpers
- /server.js — Express backend
- /auth.js — auth middleware
- /db.js — Supabase client

## Component files (client/src/components/)
- shared.jsx — T (design tokens), fmt, fmtFull, daysDiff, daysUntil, SC, askClaude, buildContext, STAGES, STAGE_THRESH, STAGE_ACTION, TIER_COLOR, donorScore, retentionRisk, moveUrgency, GlobalStyles, Spin, Pill, Card, SectionLabel, AIBtn, AIPanel, MetricCard, EmptyState, PageTitle, GivingHistoryChart, TpField, TpYesNo, TouchpointTimeline
- Dashboard.jsx — exports AIChat (global chat overlay), Dashboard
- Donors.jsx — exports Donors (includes DonorImport, FollowUpTaskModal, LogTouchpointModal, EditDonorModal, DonorProfile, DonorKanban, ReEngageView internally)
- Grants.jsx — exports Grants, FindGrants (includes GrantProfile internally)
- Communications.jsx — exports Communications
- Volunteers.jsx — exports Volunteers
- Board.jsx — exports Board
- Finance.jsx — exports Finance
- Tasks.jsx — exports Tasks
- Programs.jsx — exports Programs
- AnnualFund.jsx — exports AnnualFund
- Settings.jsx — exports Settings (includes invite modal)

## Routing (IMPORTANT)
- / → Landing (public)
- /login → LoginPage (public)
- /signup → SignupPage (public)
- /welcome → WelcomePage (auth required)
- /dashboard → App/AppShell (auth + onboarded required)
- App.jsx renders <AppShell /> directly — NO internal router

## Auth (IMPORTANT)
- Login writes npe_token, npe_user, npe_org to localStorage directly
- LoginPage uses hardcoded fetch() to Railway URL, not apiFetch
- onboarding_complete comes back as 1 (number) not true (boolean)
- After login: window.location.href = "/dashboard"

## Vercel config
- Root directory: blank (not "client")
- vercel.json at project root handles build
- client/vercel.json has VITE_API_URL env var
- GitHub connected: auto-deploys on push to main

## What's built
- Auth + onboarding wizard
- Dashboard — AI daily briefing, global chat overlay
- Donors — Kanban pipeline, CSV import, AI features, editing, interaction timeline, wealth score, follow-up tasks
- Grants — CRUD, AI strategy, LOI drafting, Find Grants
- Communications — segmented email, AI copy, SMTP, open rate tracking
- Programs — CRUD, grant linking, AI impact report, theory of change
- Annual Fund — goal tracking, monthly chart, donor acquisition vs retention, AI forecast
- Finance — monthly P&L, fund balances, AI forecast and risk analysis
- Volunteers — conversion tracking, board candidate AI
- Board — giving, attendance, committees, AI board report
- Tasks — priority queue, AI prioritization, add/complete
- Settings — billing plans, team management, invite staff
- RBAC — requireAdmin middleware, admin/staff roles
- Landing page with pricing, features, app preview

## Key patterns
- TpField and TpYesNo MUST stay at module level (not inside components) — defined in shared.jsx. Moving them inside a component causes React to remount inputs on every keystroke.
- Donor wealth score: DB columns wealth_score, capacity_tier, score_confidence, score_last_updated, score_rationale. TIER_COLOR maps tier → hex. Recalculate button hits POST /donors/:id/wealth-score.
- STAGES in shared.jsx is an object array (with color/label). Communications.jsx uses a plain string array called STAGE_LIST — kept separate to avoid shadowing.
- All AI features stream through /ai/stream on backend via askClaude (= streamAI from api.js).

## Current priorities
1. Landing page — wire CTA buttons to /signup and /login
2. Invite user flow — admin invites staff via email
3. Custom domain — thesteward.dev

## Conventions
- API responses normalized to camelCase on frontend (adaptData in api.js)
- Design tokens in T object: bg, bg2, bg3, white, ink, ink2, ink3, green (#10b981), greenDk (#1a6b4a)
- Never add internal Routes to App.jsx — routing lives in main.jsx only
