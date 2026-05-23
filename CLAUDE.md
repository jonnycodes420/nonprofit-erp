# Steward — Nonprofit ERP SaaS

## Stack
- Frontend: React 18 + Vite → deployed on Vercel
- Backend: Node + Express → deployed on Railway  
- Database: Supabase PostgreSQL
- Auth: JWT written directly to localStorage (npe_token, npe_user, npe_org)
- AI: Anthropic SDK (claude-sonnet)

## Live URLs
- Frontend: https://client-five-tau-13.vercel.app
- Backend: https://nonprofit-erp-production.up.railway.app
- GitHub: github.com/jonnycodes420/nonprofit-erp
- Demo login: admin@creoarts.org / demo1234

## Project structure
- /client/src/App.jsx — entire frontend app (1800+ lines), contains AppShell
- /client/src/main.jsx — router, auth context, route guards
- /client/src/pages/Landing.jsx — public landing page
- /client/src/pages/LoginPage.jsx — login, writes localStorage directly
- /client/src/pages/SignupPage.jsx — signup
- /client/src/pages/WelcomePage.jsx — onboarding wizard
- /client/src/api.js — apiFetch, streamAI, adaptData helpers
- /server.js — Express backend
- /auth.js — auth middleware
- /db.js — Supabase client

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
- Dashboard (AI daily briefing, global chat)
- Donors — Kanban pipeline, CSV import, AI features, editing, interaction timeline
- Grants — CRUD, AI strategy, LOI drafting, Find Grants
- Communications — segmented email, AI copy, SMTP, open rate tracking
- Program management, Finance, Volunteers, Board, Tasks modules
- RBAC — requireAdmin middleware, admin/staff roles
- Landing page with pricing, features, app preview

## Current priorities
1. UI polish — green accent system throughout dark dashboard
2. Landing page — wire CTA buttons to /signup and /login
3. Invite user flow — admin invites staff via email
4. Custom domain — thesteward.dev

## Conventions
- API responses normalized to camelCase on frontend
- All AI features go through /ai/stream on backend
- Dark theme: #0d1117 background, #10b981 green accent
- Never add internal Routes to App.jsx — routing lives in main.jsx only
