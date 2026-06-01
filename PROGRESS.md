# Steward — Build Progress

## Architecture snapshot (current)
- App.jsx: 147 lines — thin shell that imports 9 component files
- 12 component files in client/src/components/
- Active tabs: Dashboard, Donors, Grants, Communications, Finance, Volunteers, Board, Tasks, Settings
- Removed tabs: Annual Fund, Programs (consolidated into Finance/Donors); Find Grants (merged into Grants tab)

---

## Onboarding & Auth (2026-05-25)

### Blank-slate signup flow
New orgs receive zero sample data. `seedOrgData()` in db.js now seeds only:
1. Standard 26-account nonprofit chart of accounts (assets/liabilities/net assets/revenue/expense)
2. One "General Operating" unrestricted fund in `fin_funds`

No fake donors, grants, volunteers, tasks, or financials are created for any new org.

### 3-step WelcomePage
**File:** `client/src/pages/WelcomePage.jsx`

Replaced the 5-question quiz + AI recommendation flow with a clean 3-step onboarding:
- **Step 0:** Single question — "What will you focus on first?" (Donor Management / Grant Tracking / Financial Management / All of the above). One radio selector, one CTA.
- **Step 1:** Animated setup progress — calls `POST /onboarding/complete` in parallel with a 4-item checklist animation. Items tick off as the API works. Auto-advances when both finish.
- **Step 2:** "You're all set!" summary — lists what was configured, CTA navigates to `/dashboard`.

Bug fixed: previous finish() navigated to `"/"` (landing); now correctly navigates to `"/dashboard"`.

### RequireOnboarded guard
**File:** `client/src/main.jsx`

Fixed: `RequireOnboarded` now checks `auth.org?.onboarding_complete` and redirects to `/welcome` if falsy. Previously it was a pass-through that only checked for auth.

### InvitePage dark theme
**File:** `client/src/pages/InvitePage.jsx`

Updated from light theme (#fafaf9/white card) to dark theme matching login/signup pages (#030712 background, #111827 card, #0d1117 inputs). Same functionality, consistent visual identity.

### Org_id scoping fix
**File:** `server.js`

`calcWealthScore()` now scopes `gifts` and `interactions` queries by both `donor_id AND org_id`. Previously these subqueries only filtered by `donor_id`. Also scoped the `UPDATE donors SET wealth_score...` by `AND org_id=?`.

---

## Features built

### Dashboard
**File:** `client/src/components/Dashboard.jsx`

Hero stat cards (Total Donors, Active Grants, Active Volunteers, Open Tasks) each link to their tab. Left column: AI daily briefing (streamed, pull-quote + expandable full text), donor pipeline snapshot (6-stage bar), lapsed donor alert (count + lifetime value + Re-engage button), upcoming grant deadlines, recent giving list, Stripe online gifts feed. Right column: Quick Actions grid (Add Donor, Log Gift, New Grant, Add Volunteer, New Task, Send Email), Tasks This Week (today / this week groups), Activity Feed (10 most recent touchpoints across all donors). Global AI chat overlay (AIChat component, fixed position, quick-prompt chips).

---

### Donor wealth scoring
**File:** `client/src/components/Donors.jsx` (DonorProfile section), `server.js` (POST /donors/:id/wealth-score)

`calcWealthScore()` — 5 components: total giving history (0–40 pts), recency of last gift (0–20 pts), gift frequency (0–20 pts), capacity signals from employer/notes (0–10 pts), engagement score from touchpoint frequency (0–10 pts). Returns: score (0–100), capacity_tier (major/mid/small/prospect), confidence (high/medium/low), rationale (string).

**DB columns on `donors` table:**
- `wealth_score` integer
- `capacity_tier` text
- `score_confidence` text
- `score_last_updated` timestamptz
- `score_rationale` text

UI: score card on DonorProfile with color-coded tier badge (TIER_COLOR map), confidence indicator, rationale text, Recalculate button.

---

### Dynamic activity log templates
**File:** `client/src/components/Donors.jsx` (LogTouchpointModal)

Per-type prompt templates shown when logging a touchpoint. Types: Call, Meeting, Email, Event, Gift, Other. Each type pre-fills a structured note template (e.g., Call → "Called [name]. Discussed: ... Next step: ..."). On save, if type is Call or Meeting, a follow-up task is silently created (POST /tasks) with due date 7 days out, and a toast notification confirms it.

---

### App.jsx refactor
**Before:** 3,195 lines (monolith with all components inline)
**After:** 147 lines (thin shell: imports, TABS array, AppShell, App)

12 component files extracted to `client/src/components/`:
shared.jsx, Dashboard.jsx, Donors.jsx, Grants.jsx, Communications.jsx, Volunteers.jsx, Board.jsx, Finance.jsx, Tasks.jsx, Programs.jsx (inactive), AnnualFund.jsx (inactive), Settings.jsx

---

### Finance module
**File:** `client/src/components/Finance.jsx`

6 sub-tabs:
1. **Overview** — YTD revenue vs expenses P&L chart, fund balance cards, AI forecast + risk analysis (streamed)
2. **Transactions** — full CRUD table with date/description/amount/category/fund filters; inline add row
3. **Accounts** — checking/savings/credit accounts with running balance
4. **Funds** — restricted/unrestricted fund tracking with SVG sparkline (8-week trend per fund), balance vs target progress bar
5. **Budgets** — category budgets (monthly or annual) with actuals vs budget comparison
6. **Reports** — generated P&L, fund summary, and grant allocation reports

**DB tables created:**
- `fin_transactions` (id, org_id, date, description, amount, type, category, fund_id, account_id, donor_id)
- `fin_accounts` (id, org_id, name, type, balance, institution)
- `fin_funds` (id, org_id, name, balance, target, restricted, description)
- `fin_budgets` (id, org_id, category, amount, period, fund_id)
- `fin_audit_log` (id, org_id, table_name, record_id, action, changed_by, changed_at, old_values, new_values)

**Donor → Finance sync:** POST /donors/:id/gifts inserts a corresponding `fin_transactions` row (type: income, category: donation, donor_id set). One-way sync — edits to gifts do not retroactively update fin_transactions.

---

### Email marketing (Communications)
**File:** `client/src/components/Communications.jsx`

Campaign builder with audience segmentation (all donors, by stage, by tag, lapsed). AI copywriting (streamed subject + body). Send via Resend HTTP API (`POST https://api.resend.com/emails`). Open tracking via 1×1 pixel redirect through backend. Campaign analytics (sent count, open count, open rate). Template library (save/reuse campaigns).

**Backend routes:** POST /email/send, GET /email/campaigns, POST /email/campaigns, GET /email/open/:campaignId/:donorId (tracking pixel redirect)

**Env var required:** `RESEND_API_KEY`
**Sending domain:** noreply@stewardapp.dev (Resend domain verified)

---

### Stripe Connect + public donation
**Files:** `client/src/components/Settings.jsx`, `client/src/pages/GivePage.jsx`, `server.js`

- Settings: "Set up Stripe" button → POST /stripe/connect → returns Stripe account link URL → redirects to Stripe onboarding. After return, account ID stored on `orgs` table.
- Public donation page at `/give/:orgSlug` — Stripe Checkout session (one-time and recurring). Donor name/email collected pre-checkout.
- Campaign-specific payment links: grants and campaigns can have a `stripe_payment_link` that routes to a specific Checkout session.
- Recurring gifts: Stripe Subscriptions (monthly/annual interval selector on GivePage).
- Email gift request: button on DonorProfile opens a pre-filled email draft with a donation link.

**DB columns on `orgs` table:** `org_slug` (text, unique), `stripe_account_id`, `stripe_connected_at`

**DB tables:** `stripe_donations`, `stripe_subscriptions`

**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

**Backend routes:** POST /stripe/connect, GET /stripe/status, POST /stripe/checkout, POST /stripe/webhook, GET /stripe/online-gifts

---

### QR code + donation widget
**File:** `client/src/components/Settings.jsx`

- QR code: generated client-side via `qrcode` npm package from `/give/:orgSlug` URL. Download PNG, print (opens print-ready window), regenerate buttons.
- Embed widget: `<iframe>` snippet with copyable code. Live preview rendered inline in Settings.

---

### Landing page rebuild
**File:** `client/src/pages/Landing.jsx`

Sections (in order): announcement bar, sticky nav (Features / Consulting links only — no Pricing), Hero, dark animated mesh card (desktop) / dark stats card (mobile), Steward definition section, What We Do (3 cards), Relational commitment section (dark green bg), Who We Serve (numbered rows: Nonprofits / Churches / Mission-driven orgs), Features grid (6 cards), Consulting section, Social proof (3 quotes), Final CTA, Footer.

Mobile-specific: hamburger nav → bottom sheet drawer; dark `rgba(15,15,15,0.92)` stats card showing **8+** / **100%** / **$0** with green numbers and cream labels (replaces animated mesh on mobile); all sections stack to 1 column.

**No pricing section.** Removed: tier cards, plan comparison, "Replace Bloomerang…" line.

---

### Mobile responsive pass
**File:** `client/src/components/shared.jsx` (GlobalStyles — single source for all @media(max-width:768px) rules)

- Mobile bottom nav bar (4 primary tabs + "More" drawer for secondary tabs)
- Dashboard: 2×2 stat grid, pipeline horizontal scroll inside card, briefing wraps, lapsed card contained
- Donors: toolbar stacks, Kanban horizontal scroll (snap), donor profile single column
- Finance: sub-tab horizontal scroll strip
- Grants: 2-column pipeline, profile stacks to single column
- Communications: sidebar → horizontal scroll top nav
- Volunteers/Board: 3-col → 2-col metric grids
- All modals: bottom sheet (border-radius top corners, full width, 90vh max)
- No element wider than 100vw; `overflow-x:hidden` on html/body

---

### Domain + email
- **stewardapp.dev** purchased, DNS via Vercel nameservers → Vercel handles all routing
- **Resend** domain verification complete for stewardapp.dev — SPF, DKIM records added
- All transactional and campaign email sends from `noreply@stewardapp.dev`

---

### Email Sequences / Drip Campaigns (2026-06-01)
**Files:** `server.js`, `db.js`, `client/src/components/Communications.jsx`, `client/src/components/Donors.jsx`

Automated multi-step email drip campaigns for donors.

**Database (3 new tables):**
- `sequences` — stores each sequence (name, trigger, status, org_id)
- `sequence_steps` — ordered steps per sequence (delay_days, subject, body), cascades on sequence delete
- `sequence_enrollments` — per-donor enrollment state (current_step, next_send_at, status)

**Sequence engine (server.js):**
- `processSequences()` — finds active enrollments where `next_send_at <= NOW()`, sends via Resend, logs to `interactions`, advances step or marks completed. Replaces `{{donor_name}}` and `{{org_name}}` in subject + body.
- `autoEnroll()` — auto-enrolls qualifying donors into active sequences by trigger:
  - `lapsed_90`: stage=lapsed + last_gift_date < 90 days ago
  - `lapsed_180`: stage=lapsed + last_gift_date < 180 days ago
  - `new_donor`: gift_count=1 + last_gift_date within 7 days
- Engine runs on startup (5s delay) and every 1 hour via `setInterval`

**Backend routes (all before 404 handler):**
- `GET /sequences` — list with step_count and active_enrollment count
- `POST /sequences` — create with steps array
- `GET /sequences/:id/steps` — fetch steps for editing
- `GET /sequences/:id/enrollments` — enrollments with donor name/email + total_steps
- `POST /sequences/:id/enroll` — enroll donor, 409 if already active
- `POST /sequences/:id/unenroll` — set status=unsubscribed
- `PUT /sequences/:id` — update name/trigger/status; replaces steps if `steps` array provided
- `PATCH /sequences/:id/status` — quick status toggle (active/paused)
- `DELETE /sequences/:id` — deletes enrollments then sequence
- `POST /sequences/process` — admin trigger for manual engine run (declared BEFORE /:id routes)

**Frontend — Sequences subtab in Communications:**
- New "Sequences" nav item in Communications sidebar (after Analytics)
- `SequencesPanel` module-level component manages all sequence state
- Sequence builder: name, trigger dropdown (4 options), active/paused toggle, multi-step editor
- Each step: delay days, subject, body textarea, "✦ Write with AI" (streams via askClaude), token preview
- Sequence card: name, trigger label, step count, active enrollment count, status badge
- Actions: Edit (loads steps, prefills builder), Delete (confirm), Pause/Resume toggle
- Enrollments panel: inline table per sequence showing donor name, email, step progress, next send date, status, Unenroll button
- "Trigger now →" link for manual engine run

**DonorProfile — Enroll in sequence:**
- "Sequences" section in right panel (only shown if active sequences exist)
- "+ Enroll in sequence" button → inline dropdown of active sequences → Enroll button
- Calls `POST /sequences/:id/enroll` → shows green toast for 3.5s

---

### Custom Fields (2026-06-01)
**Files:** `db.js`, `server.js`, `client/src/components/Settings.jsx`, `client/src/components/Donors.jsx`

Per-org custom fields for the donor profile. Admins define fields in Settings; all staff see and fill them on individual donor profiles.

**Database (2 new tables):**
- `custom_fields` — org-scoped field definitions (label, field_type, options JSONB, required, field_order)
- `custom_field_values` — per-donor values with UNIQUE(donor_id, field_id) + ON DELETE CASCADE from custom_fields

**Field types:** text, number, date, dropdown (options list), checkbox (Yes/No)

**Backend routes (7 routes; reorder before /:id):**
- `GET /custom-fields` — list org fields by field_order
- `POST /custom-fields` — create (adminOnly)
- `PUT /custom-fields/reorder` — reorder by ids array (declared BEFORE /:id)
- `PUT /custom-fields/:id` — update (adminOnly)
- `DELETE /custom-fields/:id` — deletes values then field (adminOnly)
- `GET /donors/:id/custom-fields` — LEFT JOIN fields + values for a donor
- `POST /donors/:id/custom-fields` — upsert value (ON CONFLICT DO UPDATE)

**Settings.jsx:**
- "Custom Fields" section between Team Members and Account Actions
- Lists fields with type badge + dropdown options preview
- Admin: Add Field button → modal with label, type select, options builder (dropdown only), required toggle
- Admin: Edit / Delete per field

**DonorProfile (Donors.jsx):**
- Custom Fields section shown only when org has any fields (cfData.length > 0)
- Each field shows label + current value, inline Edit → saves on button click or Enter
- Input type matches field type: text/number/date input or select for dropdown/checkbox

---

### Analytics Tab (2026-06-01)
**File:** `client/src/components/Analytics.jsx`, `client/src/App.jsx`

New "Analytics" tab added to the main nav (desktop tab bar + mobile More drawer). No AI features — pure data visualization using custom div-based charts (no recharts).

6 charts:
1. **Giving Trend** — vertical bar chart of monthly total revenue (individual + grants + events + other) for all 12 months. Color #10b981.
2. **Donor Retention** — 3-bar chart showing New / Retained / Lapsed donors this year, with color-coded legend.
3. **Pipeline Velocity** — horizontal bar chart of donor count per cultivation stage, using STAGES colors.
4. **Grant Pipeline** — vertical bar chart of total ask value by status (dynamically shows all statuses present in data).
5. **Email Performance** — progress bar list of open rate per sent campaign (last 10 campaigns, fetched from GET /email/campaigns).
6. **Top Donors** — full-width table of top 10 donors by lifetime giving, showing name, last gift date, lifetime total, wealth score, and stage pill.

Layout: 2-column responsive grid (`repeat(auto-fit, minmax(380px, 1fr))`), Top Donors spans full width. Empty states shown for each chart when no data.

---

### Grant Kanban (2026-06-01)
**File:** `client/src/components/Grants.jsx`

Added a Kanban view to the Grants pipeline tab alongside the existing List view. Default view is Kanban. Toggle between Kanban and List via a pill toggle in the toolbar.

**Kanban columns (left to right):** Prospecting · LOI · Applied · Under Review · Awarded · Closed

**Status mapping:** `active/applied → Applied`, `rejected → Closed`, all others map to matching column. New statuses `loi`, `applied`, `awarded` are persisted to the DB (TEXT column, no migration needed).

**Drag-and-drop:** HTML5 drag API. On drop, calls `PUT /grants/:id` with full grant object + new status. Dragged card fades to 45% opacity; drop target column darkens.

**Card shows:** funder name, program, ask amount, deadline color-coded (red <14d, yellow <30d, green otherwise). Column header shows label + count + total pipeline value.

**Mobile:** horizontal scroll with `scrollSnapType: x mandatory`, 260px min-width per column.

**+ Add Grant:** available via "Add Grant" button in the Prospecting column (switches to List view and opens the add form). In List view, button stays in toolbar as before.

---

## What was removed / consolidated
- `AnnualFund.jsx` — tab removed (goal tracking moved to Finance Overview)
- `Programs.jsx` — tab removed (program–grant linking now handled inline in Grants)
- Find Grants — merged into Grants tab (not a separate tab)
- Pricing section — removed from Landing.jsx and Settings.jsx (no plan tiers, no Upgrade buttons)

---

## Key file index
| File | Role |
|------|------|
| client/src/App.jsx | Shell, TABS, AppShell (147 lines) |
| client/src/components/shared.jsx | Design tokens, all shared components, GlobalStyles (all mobile CSS) |
| client/src/components/Dashboard.jsx | AIChat overlay + Dashboard |
| client/src/components/Donors.jsx | Full donor CRM — Kanban, profile, touchpoints, wealth score |
| client/src/components/Grants.jsx | Grant CRUD + discovery merged |
| client/src/components/Communications.jsx | Email campaigns via Resend |
| client/src/components/Finance.jsx | 6-tab finance module |
| client/src/components/Settings.jsx | Stripe, QR, embed, team |
| client/src/pages/Landing.jsx | Public marketing page |
| client/src/pages/GivePage.jsx | Public /give/:orgSlug donation page |
| server.js | All Express routes |
| auth.js | requireAuth, requireAdmin middleware |
| db.js | Supabase client |
