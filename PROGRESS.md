# Steward — Build Progress

**Tagline:** Manage what matters.  
**GitHub:** https://github.com/jonnycodes420/nonprofit-erp  
**Backend (Railway):** https://nonprofit-erp-production.up.railway.app  
**Frontend (Vercel):** https://client-five-tau-13.vercel.app  
**Demo login:** admin@creoarts.org / demo1234

---

## What Was Built

### Session overview
Full-stack nonprofit CRM built from scratch in one session: backend API on Railway, React frontend on Vercel, AI features powered by Claude Haiku routed through the backend (API key never touches the browser), multi-org auth with onboarding flow, and a moves management Kanban with drag-and-drop.

---

## File Structure

```
nonprofit-erp/
├── server.js          # Express API (598 lines)
├── db.js              # sql.js in-memory SQLite + seed data (401 lines)
├── auth.js            # JWT sign/verify + requireAuth middleware
├── package.json       # Node backend deps
└── client/
    ├── index.html     # <title>Steward</title>
    ├── vercel.json    # Vercel config, sets VITE_API_URL
    ├── vite.config.js
    ├── package.json   # React deps (react, react-dom, react-router-dom)
    └── src/
        ├── main.jsx         # AuthContext, route guards, BrowserRouter
        ├── api.js           # apiFetch, streamAI, adaptData (snake→camelCase)
        ├── App.jsx          # All tab components (1291 lines)
        └── pages/
            ├── LoginPage.jsx    # /login
            ├── SignupPage.jsx   # /signup
            └── WelcomePage.jsx  # /welcome — 5-question onboarding wizard
```

---

## Backend API Endpoints

All routes except `/auth/*` and `/health` require `Authorization: Bearer <token>`.

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | /auth/register | Create org + first user. Body: email, password, name, orgName, orgMission, ein |
| POST | /auth/login | Returns token + user + org (including onboarding_complete flag) |
| GET | /me | Returns current user + org |

### Onboarding
| Method | Path | Description |
|--------|------|-------------|
| POST | /onboarding/complete | Seeds org with scaled sample data, marks onboarding_complete=1. Body: { answers } |

### Org
| Method | Path | Description |
|--------|------|-------------|
| GET | /org | Returns org row for current user |

### Donors
| Method | Path | Description |
|--------|------|-------------|
| GET | /donors | All donors for org with interactions (last 10 per donor) |
| GET | /donors/:id | Single donor with all interactions + gifts |
| POST | /donors | Create donor. Body: name, email, phone, status, stage, tags, notes, lastAmount |
| POST | /donors/import | Bulk import. Body: { donors: [...] } |
| PUT | /donors/:id | Update donor |
| PATCH | /donors/:id/stage | Update stage only. Body: { stage } — used by Kanban drag-drop |
| DELETE | /donors/:id | Delete donor |
| POST | /donors/:id/interactions | Log touchpoint. Body: type, note, date |
| POST | /donors/:id/gifts | Record a gift |

### Grants
| Method | Path | Description |
|--------|------|-------------|
| GET | /grants | All grants for org |
| POST | /grants | Create grant |
| PUT | /grants/:id | Update grant |
| DELETE | /grants/:id | Delete grant |

### Volunteers
| Method | Path | Description |
|--------|------|-------------|
| GET | /volunteers | All volunteers |
| POST | /volunteers | Create volunteer |
| PUT | /volunteers/:id | Update volunteer |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | /tasks | All tasks |
| POST | /tasks | Create task |
| PUT | /tasks/:id | Update task |
| DELETE | /tasks/:id | Delete task |

### Board
| Method | Path | Description |
|--------|------|-------------|
| GET | /board | All board members |
| POST | /board | Add board member |

### Financials
| Method | Path | Description |
|--------|------|-------------|
| GET | /financials | Returns { months: [...], funds: [...] } |
| POST | /financials/month | Add/update a month's data |

### Analytics & Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | /analytics | Computed metrics (donor stats, grant totals, etc.) |
| GET | /dashboard | Summary data for dashboard view |

### AI
| Method | Path | Description |
|--------|------|-------------|
| POST | /ai/stream | SSE stream. Body: { systemPrompt, userMessage }. Uses claude-haiku-4-5-20251001 |
| GET | /ai/donor-score | Donor scoring analysis |

---

## Database Schema (sql.js in-memory SQLite)

```sql
orgs          (id, name, mission, ein, onboarding_complete, created_at)
users         (id, org_id, email, password_hash, name, role, created_at)
donors        (id, org_id, name, email, phone, status, stage, total_giving,
               last_gift_amount, last_gift_date, gift_count, tags, notes,
               created_at, updated_at)
gifts         (id, org_id, donor_id, amount, date, type, campaign, notes, created_at)
interactions  (id, org_id, donor_id, type, note, date, created_by, created_at)
grants        (id, org_id, funder, program, amount, received, status, deadline,
               report_due, officer, notes, history, created_at, updated_at)
volunteers    (id, org_id, name, email, hours, skills, last_active,
               convert_potential, employer, notes, created_at)
tasks         (id, org_id, title, due, priority, type, done, donor_id, created_at)
board_members (id, org_id, name, role, employer, term, giving_level,
               committees, attendance, created_at)
financials    (id, org_id, month, year, individual, grants, events, other_revenue,
               programs, admin, fundraising, created_at)
funds         (id, org_id, name, balance, restricted, created_at)
```

**Note:** sql.js is in-memory — data resets on each Railway redeploy. Production would need PostgreSQL.

---

## Features Built

### Authentication & Multi-Org
- JWT auth (7-day tokens), stored in localStorage
- Each org is fully isolated — all queries filter by org_id
- `RequireAuth`, `RequireOnboarded`, `PublicOnly` route guards
- Logout clears localStorage and redirects to /login

### Onboarding Flow (`/signup` → `/welcome` → `/`)
- Signup: org name, mission, EIN, user name, email, password
- 5-question wizard: donor count, budget, grant count, board size, current tools
- Claude AI streams a personalized setup recommendation based on answers
- `seedOrgData()` generates scaled sample data (sm/md/lg/xl tiers based on answers)
- Marks `onboarding_complete=1` on the org, triggering route redirect to dashboard

### Dashboard
- Metric cards: YTD Revenue, Cash on Hand, Active Grants, Grant Pipeline, Lapsed Donors
- Revenue vs. Expenses bar chart (YTD by month)
- Top Donors by lifetime giving
- Urgent Tasks list
- Grant Deadlines with days-remaining urgency color
- Fund Balances (restricted vs. unrestricted)
- AI Daily Briefing (streaming)
- Global AI Chat (full org context, quick-prompt chips)

### Donors — Moves Management (rebuilt)
**Stages:** Prospect → Qualify → Cultivate → Solicit → Steward → Lapsed

**Pipeline view (Kanban):**
- 6 columns, horizontal scroll
- HTML5 drag-and-drop between stages → PATCH /donors/:id/stage
- Cards show: name, lifetime giving, urgency dot + days since contact (thresholds vary by stage), next recommended action
- Per-stage contact urgency thresholds (e.g. Solicit: 7d warn / 14d critical, Steward: 30d / 90d)
- + Log button → LogTouchpointModal (type picker, date, note → POST /donors/:id/interactions)
- View → button → full DonorDetailModal

**Donor detail modal:**
- Stage mover (click to reassign)
- Stats: last gift, days since contact + urgency level, engagement score
- Touchpoint Timeline: vertical dot-connector, color-coded by type (call/email/meeting/gift/event/note), newest-first, relative time stamps
- AI: Next Move Analysis (urgency score 1–10 + exact action + what to say), Outreach Strategy, Draft Email, Call Script

**List view:** same data in expandable card format with inline stage mover + timeline

**donorScore(d):** 0–99 engagement score based on total giving, recency, gift count, tags  
**retentionRisk(d):** low/medium/high churn risk + reason + recommended action  
**moveUrgency(d):** per-stage contact urgency with color (green/amber/red)

### Donor Import
- "↑ Import" button opens modal
- Paste CSV text or upload a file
- Auto-detects column headers (matches common export formats: Bloomerang, Salesforce, spreadsheets)
- Column mapping UI with dropdowns
- Preview table (first 5 rows)
- Bulk POST /donors/import

### Grants
- List view with status badges (active/pending/prospecting/closed)
- Days-to-deadline urgency coloring
- Add/edit grant form
- AI: Application Strategy, Report Narrative, Renewal Strategy streaming from Claude

### Find Grants (tab)
- Reads org mission, budget, and current funders
- Streams Claude analysis of 10 real matching grants ranked by alignment score
- Each result includes: funder, program, typical award range, why you qualify, next step

### Volunteers
- List with hours, skills, convert potential, employer
- Donor linkage (volunteer → donor conversion tracking)

### Board
- Member list with role, giving level, committees, attendance %
- Governance overview

### Finance
- Revenue vs. Expenses chart by month
- Category breakdown (programs / admin / fundraising)
- Fund balances with restricted/unrestricted split

### Tasks
- Priority-sorted task list (high/medium/low)
- Type tags (donor/grant/board/volunteer)
- Mark complete toggle
- High-priority count badge on tab

### AI Infrastructure
- All Claude calls go through `/ai/stream` on the backend — API key never in browser
- SSE (Server-Sent Events) streaming to frontend via `streamAI()` in api.js
- Model: `claude-haiku-4-5-20251001` (fast, cost-effective)
- System prompts are stage/context-aware throughout the app

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend runtime | Node.js + Express 5 |
| Database | sql.js (in-memory SQLite) |
| Auth | bcryptjs + jsonwebtoken (7d expiry) |
| AI | @anthropic-ai/sdk 0.98.x → claude-haiku-4-5-20251001 |
| Frontend | React 18 + Vite 5 |
| Routing | react-router-dom 6 |
| Styling | All inline styles (no CSS framework) |
| Font | DM Sans + DM Serif Display (Google Fonts) |
| Backend deploy | Railway (Node service) |
| Frontend deploy | Vercel |
| Source control | GitHub — jonnycodes420/nonprofit-erp |

---

## Deployment

### Environment variables (Railway)
```
NODE_ENV=production
JWT_SECRET=<generated secret>
ANTHROPIC_API_KEY=sk-ant-api03-...
PORT=8080  (set by Railway automatically)
```

### Vercel build config (`client/vercel.json`)
```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "build": { "env": { "VITE_API_URL": "https://nonprofit-erp-production.up.railway.app" } }
}
```

### SPA routing
Vercel serves `index.html` for all paths (react-router handles client-side routing).

---

## What Was Built (continued)

### PostgreSQL Migration (2026-05-22)
- Migrated from sql.js (in-memory SQLite) to Supabase Postgres
- `db.js` rewritten: `pg` Pool, async `query()`/`run()` with `?`→`$N` conversion, idempotent seed with `ON CONFLICT DO NOTHING`
- `server.js`: all 33 route handlers made async; `datetime('now')`→`NOW()`; financials upsert via `ON CONFLICT (org_id, month, year) DO UPDATE`
- `DATABASE_URL` set in Railway; data now persists across all deploys

### Donor Profile Editing (2026-05-22)
- `EditDonorModal` component: edit name, email, phone, tags (comma-separated), notes, and stage in one form
- "Edit" button added to `DonorDetailModal` header — opens edit modal on top at z-index 400
- On save: PUT /donors/:id, response adapted back to local shape preserving interactions and lastTouchpoint
- State updated in-place (no full reload needed)

### Role-Based Access (2026-05-22)
- **Admin** — full access to everything
- **Staff** — can view all data, log touchpoints, move stages, add/edit donors and grants; cannot delete donors or edit financial data
- Backend: `requireAdmin` middleware applied to `DELETE /donors/:id` and `POST /financials/month` — returns 403 for non-admins
- Frontend: "Delete Donor" button only rendered when `isAdmin=true`; role badge shown in header (purple=admin, grey=staff)
- Role comes from JWT token (`req.user.role`), set at registration as "admin" for org founders

---

## What Needs to Be Built Next

### High priority
- **Email sending** — Wire up SendGrid or Resend so drafted outreach emails can be sent directly from Steward, not just copied to clipboard.
- **Grant report tracking** — Report due dates exist in the schema but there's no dedicated UI for tracking report submissions and attaching content.
- **Invite users** — Email invitation flow so an ED can add development staff to their org (they'd join as "staff" role).

### Moves management enhancements
- **Bulk stage moves** — Select multiple donors and move them all to a new stage at once (useful when onboarding a large existing portfolio).
- **Stage change history** — Log when a donor moves between stages and who made the change (audit trail for development teams).
- **Next contact date** — Let users schedule a follow-up date per donor, surface overdue follow-ups prominently.
- **Goals per stage** — How many donors should be in Solicit at any given time? Show pipeline health vs. targets.

### New modules
- **Communications hub** — Draft, approve, and send batched donor emails (appeals, thank-yous, newsletters). Track opens/clicks via SendGrid webhook.
- **Events** — Track events (galas, site visits, cultivation dinners), link attendees to donor records, log interactions in bulk.
- **Pledge tracking** — Multi-year pledges with payment schedules. Alert when a pledge payment is due.
- **Prospect research** — Paste a name or LinkedIn URL, Claude enriches the prospect profile with capacity estimates and connection paths.
- **Annual fund dashboard** — Separate view for tracking an annual fund campaign: goal, raised, % to goal, donor acquisition vs. renewal.
- **Board engagement scoring** — Score each board member on giving, attendance, committee participation, and referrals. Surface who needs attention.

### Auth & multi-user
- **Audit log** — Track who created/edited what and when.
- **Read-only role** — Third tier below staff: can view data but cannot log interactions or edit anything.

### Infrastructure
- **File uploads** — Attach grant documents, donor correspondence, and reports to records.
- **Automated reminders** — Cron jobs to email staff when grant reports are due, when a donor hasn't been contacted past their stage threshold, etc.
- **Bloomerang / Salesforce sync** — Two-way data sync so orgs can migrate off their old CRM gradually rather than all at once.
- **Mobile-responsive design** — The Kanban board and some dense views don't work well on phone screens.
- **Export** — CSV export for donors, grants, financials for board reports and audits.
