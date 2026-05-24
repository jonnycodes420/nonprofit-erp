# Steward — Build Progress

**Tagline:** Manage what matters.  
**GitHub:** https://github.com/jonnycodes420/nonprofit-erp  
**Backend (Railway):** https://nonprofit-erp-production.up.railway.app  
**Frontend (Vercel):** https://client-five-tau-13.vercel.app  
**Demo login:** admin@creoarts.org / demo1234

---

## Current Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | Supabase PostgreSQL (migrated from in-memory SQLite 2026-05-22) |
| Auth | bcryptjs + jsonwebtoken (7d expiry), localStorage |
| AI | @anthropic-ai/sdk → claude-sonnet-4-6 |
| Frontend | React 18 + Vite |
| Routing | react-router-dom 6 |
| Styling | Inline styles, no CSS framework |
| Font | DM Sans + DM Serif Display |
| Backend deploy | Railway (auto-deploy on push to main) |
| Frontend deploy | Vercel (auto-deploy on push to main) |

---

## File Structure

```
nonprofit-erp/
├── server.js              # Express API
├── db.js                  # Supabase pg Pool, async query/run helpers
├── auth.js                # JWT middleware, requireAdmin
├── package.json
└── client/
    ├── vercel.json        # VITE_API_URL env var
    └── src/
        ├── main.jsx       # AuthContext, route guards, BrowserRouter
        ├── api.js         # apiFetch, streamAI, adaptData (snake→camelCase)
        ├── App.jsx        # AppShell + TABS (147 lines — imports from components/)
        ├── pages/
        │   ├── Landing.jsx
        │   ├── LoginPage.jsx
        │   ├── SignupPage.jsx
        │   └── WelcomePage.jsx
        └── components/
            ├── shared.jsx         # T tokens, helpers, all shared UI primitives
            ├── Dashboard.jsx      # AIChat, Dashboard
            ├── Donors.jsx         # Donors + all donor sub-components
            ├── Grants.jsx         # Grants, FindGrants, GrantProfile
            ├── Communications.jsx
            ├── Programs.jsx
            ├── AnnualFund.jsx
            ├── Finance.jsx
            ├── Volunteers.jsx
            ├── Board.jsx
            ├── Tasks.jsx
            └── Settings.jsx
```

---

## Backend API Endpoints

All routes except `/auth/*` and `/health` require `Authorization: Bearer <token>`.

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/register | Create org + first user |
| POST | /auth/login | Returns token + user + org |
| POST | /auth/invite | Admin generates invite link (+ optional email). Body: { email, role } |
| POST | /auth/accept-invite | Invited user sets name + password |
| GET | /me | Current user + org |

### Org
| Method | Path | Description |
|--------|------|-------------|
| GET | /org | Returns org row |
| PUT | /org/smtp | Save SMTP settings |
| GET | /org/team | List all users in org |

### Onboarding
| Method | Path | Description |
|--------|------|-------------|
| POST | /onboarding/complete | Seeds org with sample data, marks onboarding_complete=1 |

### Donors
| Method | Path | Description |
|--------|------|-------------|
| GET | /donors | All donors with last 10 interactions |
| GET | /donors/:id | Single donor with all interactions + gifts |
| POST | /donors | Create donor |
| POST | /donors/import | Bulk import. Body: { donors: [...] } |
| PUT | /donors/:id | Update donor |
| PATCH | /donors/:id/stage | Update stage only (Kanban drag-drop) |
| DELETE | /donors/:id | Admin only |
| POST | /donors/:id/interactions | Log touchpoint |
| POST | /donors/:id/gifts | Record a gift |
| POST | /donors/:id/wealth-score | Recalculate wealth score (server-side, Claude rationale) |

### Grants
| Method | Path | Description |
|--------|------|-------------|
| GET | /grants | All grants |
| POST | /grants | Create grant |
| PUT | /grants/:id | Update grant |
| DELETE | /grants/:id | Delete grant |

### Communications
| Method | Path | Description |
|--------|------|-------------|
| GET | /campaigns | All campaigns |
| POST | /campaigns | Create campaign |
| POST | /campaigns/:id/send | Send campaign to filtered donors |
| GET | /campaigns/:id/recipients | Recipient list with open status |
| GET | /track/open/:recipientId | Open tracking pixel endpoint |

### Programs
| Method | Path | Description |
|--------|------|-------------|
| GET | /programs | All programs with linked grants |
| POST | /programs | Create program |
| PUT | /programs/:id | Update program |
| POST | /programs/:id/grants | Link a grant to a program |
| DELETE | /programs/:id/grants/:grantId | Unlink grant |

### Annual Fund
| Method | Path | Description |
|--------|------|-------------|
| GET | /annual-fund?year=YYYY | Fund summary: goal, raised, monthly, donor counts |
| POST | /annual-fund/goal | Set annual goal. Body: { year, goal } |

### Volunteers / Board / Tasks / Financials
| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PUT | /volunteers | CRUD |
| GET/POST | /board | CRUD |
| GET/POST/PUT/DELETE | /tasks | CRUD |
| GET | /financials | { revenue: [...], expenses: [...], funds: [...] } |
| POST | /financials/month | Add/update a month (admin only) |

### AI
| Method | Path | Description |
|--------|------|-------------|
| POST | /ai/stream | SSE stream. Body: { systemPrompt, userMessage } |
| POST | /ai/column-map | Map CSV headers to donor fields. Body: { headers, sample } |

---

## Database Schema (Supabase Postgres)

```sql
orgs           (id, name, mission, ein, plan, smtp_host, smtp_port, smtp_user,
                smtp_pass, smtp_from, onboarding_complete, created_at)
users          (id, org_id, email, password_hash, name, role, invite_token,
                invite_expires, created_at)
donors         (id, org_id, name, email, phone, status, stage, total_giving,
                last_gift_amount, last_gift_date, gift_count, tags, notes,
                wealth_score, capacity_tier, score_confidence,
                score_last_updated, score_rationale, created_at, updated_at)
gifts          (id, org_id, donor_id, amount, date, type, campaign, notes, created_at)
interactions   (id, org_id, donor_id, type, note, date, created_by, created_at)
grants         (id, org_id, funder, program, amount, received, status, deadline,
                report_due, officer, notes, history, loi_draft, created_at, updated_at)
campaigns      (id, org_id, name, type, subject, body, segment, status,
                sent_at, recipient_count, open_count, created_at)
campaign_recipients (id, campaign_id, donor_id, email, donor_name, sent_at, opened_at)
programs       (id, org_id, name, description, budget, spent, staff,
                participant_count, start_date, end_date, status, outcomes,
                metrics, created_at)
program_grants (id, program_id, grant_id, allocated)
annual_fund_goals (id, org_id, year, goal, created_at)
volunteers     (id, org_id, name, email, hours, skills, last_active,
                convert_potential, employer, notes, created_at)
tasks          (id, org_id, donor_id, title, due, priority, type, done, created_at)
board_members  (id, org_id, name, role, employer, term, giving_level,
                committees, attendance, created_at)
financials     (id, org_id, month, year, individual, grants, events, other_revenue,
                programs, admin, fundraising, created_at)
funds          (id, org_id, name, balance, restricted, created_at)
```

---

## Features Built

### Auth & Multi-Org
- JWT auth (7-day tokens), stored in localStorage as npe_token/npe_user/npe_org
- Each org fully isolated — all queries filter by org_id
- Route guards: RequireAuth, RequireOnboarded, PublicOnly
- RBAC: admin (full access) / staff (no delete, no financials write)
- Invite flow: admin generates link → invited user sets name + password → joins org as staff or admin

### Onboarding
- Signup → 5-question wizard → Claude streams personalized setup advice
- seedOrgData() generates scaled sample data based on org size answers
- Marks onboarding_complete=1 on org

### Dashboard
- Hero stat cards (total raised, active grants, pipeline value, lapsed count)
- AI daily briefing (streaming, full org context)
- Pipeline snapshot by stage
- Lapsed donor alert with re-engage link
- Grant deadlines
- Recent giving feed
- Quick actions
- Tasks this week
- Activity feed
- Global AI chat overlay (Ask AI — full org context, streaming)

### Donors
- **Kanban** — 6 stages (Prospect→Qualify→Cultivate→Solicit→Steward→Lapsed), drag-and-drop, per-stage urgency thresholds
- **Full-screen profile** — two-panel (info left, AI/timeline right), stage mover, engagement score, retention risk
- **Smart CSV import** — AI column mapping via /ai/column-map, auto stage assignment from gift history, preview table
- **Interaction timeline** — color-coded by type, relative timestamps
- **Dynamic touchpoint log** — templates per activity type (Call/Meeting/Email/Event/Gift/Other), each with tailored fields: Key Takeaways ×3, History, Spouse/Partner, Next Steps
- **Follow-up task modal** — surfaces after logging, creates real DB task, visible in donor profile and Tasks tab
- **Edit donor modal** — name, email, phone, tags, notes, stage
- **Donor Wealth Score** — 5-component server-side calc (giving history, capacity signals, engagement, tenure, network), score 1–10, capacity tier (Micro/Small/Mid/Major/Principal), confidence, Claude rationale, Recalculate button
- **Re-engage queue** — lapsed donors sorted by urgency, AI re-engagement plan per donor
- AI features: next move analysis, outreach strategy, draft email, call script, portfolio analysis

### Grants
- CRUD with status badges (active/pending/prospecting/closed)
- Full-screen detail — two-panel layout matching donor profile
- AI: grant strategy, LOI drafting, report narrative, renewal strategy
- **Find Grants** tab — AI scans landscape, returns 10 ranked matches with alignment score, award range, why you qualify, next step

### Communications
- Campaign builder — name, type (appeal/thank-you/grant-ack/tax-receipt/newsletter), subject, body
- Segment by stage and/or donor status
- AI email copy drafting with variable hints ({{donor_name}}, {{gift_amount}}, etc.)
- SMTP configuration per org (Gmail app passwords, Resend, etc.)
- Send to filtered donors
- Open rate tracking — recipient list, opened_at timestamps, progress bar

### Programs
- CRUD — name, description, budget/spent, staff, participants, dates, status, outcomes
- Budget spend progress bar with color coding
- Grant funding links — link/unlink grants, show allocated amounts
- AI impact report (grant report narrative)
- AI theory of change (Activities → Outputs → Outcomes → Long-term Impact)

### Annual Fund
- Year selector (current + prior)
- Goal setting (admin)
- Progress ring (SVG) + progress bar
- Projected year-end at current pace
- Monthly revenue bar chart
- Donor acquisition vs retention breakdown (new vs renewed)
- Retention rate with color coding
- AI forecast and gap-closing strategy

### Finance
- YTD revenue, expenses, net position, program ratio
- Monthly P&L with revenue/expense bars + revenue stream breakdown
- Fund balances (restricted/unrestricted)
- AI 6-month forecast
- AI financial risk analysis

### Volunteers
- Cards with hours, skills, employer, last active
- Convert potential tracking (low/high/converted)
- AI volunteer-to-donor conversion plan
- AI board candidate identification

### Board
- Member cards — role, employer, committees, giving level, attendance
- AI Q2 board report
- AI board ask email (introductions to prospects)

### Tasks
- Priority queue (high/medium/low) with overdue detection
- Add task — title, due date, priority, type
- Toggle complete
- AI prioritization
- High-priority count badge on tab
- Tasks created from donor follow-up modal appear here

### Settings
- Account info, org name + mission
- Billing & plan (Seed/Growth/Impact — UI only, no Stripe yet)
- Team members list
- Invite staff modal — generates invite link, copy to clipboard
- Sign out

---

## To Do

### Near-term
- [ ] Landing page — wire CTA buttons to /signup and /login
- [ ] Custom domain — thesteward.dev

### Backlog
- [ ] Stripe billing integration (upgrade buttons are UI-only)
- [ ] Email open tracking pixel (endpoint exists at /track/open/:id, needs wiring to actual pixel img tag in sent emails)
- [ ] Export donors/grants to CSV
- [ ] Grant calendar / deadline timeline view
- [ ] Mobile-responsive layout (Kanban especially)
- [ ] Role-based field visibility (staff vs admin for wealth score, financials)
- [ ] Audit log — track who changed what and when
- [ ] Automated reminders — cron for grant report due dates, overdue donor contact
- [ ] Bulk stage moves in Kanban
- [ ] Next scheduled contact date per donor
- [ ] Bloomerang / Salesforce import adapters
