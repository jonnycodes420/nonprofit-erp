# Steward — Build Progress

### Admin dashboard light-mode overhaul (2026-06-02)
Complete flip from dark to light: `#f7f7f5` bg, white sidebar/cards, `#0d5c3a` green accent, soft pill badges (TRIAL amber, ACTIVE green, CHURNED red, SEED blue, IMPACT purple), 32px metric values with colored 3px bottom borders, 40px signup numbers, JetBrains Mono for all numeric data, breadcrumb top bar, `S` logomark, scrollbar + focus-ring global CSS. No logic changes.

### Admin dashboard design pass (2026-06-02)
Design-only refinement of `AdminDashboard.jsx` — no logic changes. Updated color tokens (`#080f09` bg, `#0a110a` sidebar, `#e8f0e8` primary text, `#6b8f6b`/`#3d5c3d` secondary/muted), tighter badge style (9px, 3px radius, per-status bg/border), compact MetricCard (16×20 padding, 10px uppercase labels), monospace numbers via JetBrains Mono, 4px flat bars, table headers at 10px uppercase muted, sidebar text-only logo `STEWARD` in 0.2em letter-spacing, 44px top bar, hover transitions throughout.

---

### Super-admin dashboard (2026-06-02)
Internal ops tool for Steward platform admins. Separate authenticated view at `/admin` — not part of the AppShell.

**Database:** `is_super_admin BOOLEAN DEFAULT false` column added to `users` table via `ALTER TABLE IF NOT EXISTS`. Set via Supabase SQL: `UPDATE users SET is_super_admin = true WHERE email = 'your@email.com'`.

**Backend (server.js + auth.js):**
- `requireSuperAdmin` middleware in auth.js — returns 403 if `req.user.isSuperAdmin` is falsy
- Login route updated: `isSuperAdmin` field included in JWT payload and returned user object
- `PLAN_MRR = { trial:0, seed:99, growth:249, impact:499 }` helper constant
- `orgWithMetrics(org)` async helper — parallel queries for donor_count, grant_count, user_count, last_active, monthly_revenue per org
- Routes (all require `requireAuth + requireSuperAdmin`):
  - `GET /admin/orgs` — all orgs with metrics
  - `GET /admin/metrics` — aggregate platform stats (MRR, ARR, trial conversion rate, plan breakdown, new orgs this/last month, total donors/grants/interactions)
  - `GET /admin/orgs/:id` — single org with users + recent_activity + sequence/enrollment counts
  - `POST /admin/orgs/:id/extend-trial` — extends trial by N days (uses raw template literal INTERVAL)
  - `POST /admin/orgs/:id/change-plan` — updates plan + subscription_status
  - `DELETE /admin/orgs/:id` — cascades through all FK-related tables in safe order (requires `{ confirm: true }`)

**Frontend:**
- `client/src/pages/AdminDashboard.jsx` — ~500 lines, own layout (no AppShell), own `adminFetch()` helper
- Design tokens: `A` object — bg `#0a0f0a`, dark ops-tool aesthetic with green tones
- 3 pages: Overview (KPI cards, MRR breakdown, new signup bars, recent signups table), Organizations (sortable/filterable table + 480px slide-in OrgPanel), Metrics (MRR by cohort, plan distribution bars, trial conversion funnel, top orgs by usage)
- OrgPanel: metrics grid, users table, recent activity, extend trial, change plan, delete with name confirmation
- `client/src/main.jsx` — `RequireSuperAdmin` guard added; `/admin` route added
- `client/src/pages/LoginPage.jsx` — after login: `isSuperAdmin ? "/admin" : "/dashboard"`

---

### Self-serve SaaS billing (2026-06-01)
Strangers can now sign up and pay without talking to anyone.

**Database:** 5 new org columns via `ALTER TABLE IF NOT EXISTS`: `plan TEXT DEFAULT 'trial'`, `trial_ends_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'`, `stripe_customer_id TEXT`, `stripe_subscription_id TEXT`, `subscription_status TEXT DEFAULT 'trialing'`.

**Backend routes (server.js):**
- `POST /auth/register-org` — public self-serve signup. Validates all fields, checks email uniqueness (409), creates org+user, creates Stripe customer via `stripe.customers.create`, updates org with `stripe_customer_id`, returns JWT + `{ token, user, org, stripeCustomerId }`.
- `GET /billing/status` — returns `{ plan, subscriptionStatus, trialEndsAt, trialDaysLeft }`.
- `POST /billing/create-checkout` — maps plan (seed/growth/impact) to `STRIPE_PRICE_SEED/GROWTH/IMPACT` env vars, creates Stripe Checkout session (mode: subscription), returns `{ url }`.
- `POST /billing/create-portal` — creates Stripe Customer Portal session, returns `{ url }`.
- `POST /billing/webhook` — handles `checkout.session.completed` (updates plan/subscription_status/stripe_subscription_id), `customer.subscription.deleted` (sets cancelled/trial), `invoice.payment_failed` (sets past_due). Uses `STRIPE_BILLING_WEBHOOK_SECRET` (falls back to `STRIPE_WEBHOOK_SECRET`).

**Frontend:**
- `client/src/pages/SignupPage.jsx` — full redesign: `#0f1a12` dark left panel (30-day trial benefits, 3 checkmarks), white right card (5 fields: org name, your name, email, password, confirm), client-side validation with inline field errors. Calls `POST /auth/register-org`, saves token, redirects to `/pricing`.
- `client/src/pages/Pricing.jsx` — new public page. 3 plan cards (Seed $99 / Growth $249 highlighted / Impact $499). If authed → `POST /billing/create-checkout` → Stripe Checkout. If not authed → `/signup`. Accessible at `/pricing`.
- `client/src/main.jsx` — `/pricing` route added (public, no auth guard).
- `client/src/App.jsx` — fetches `GET /billing/status` on mount. Trial banner shown when `subscriptionStatus === 'trialing' && trialDaysLeft <= 14`. Banner: `#1a2e1f` bg, gold "Upgrade now →" → `POST /billing/create-portal`. Dismissible per session (× button).
- `client/src/components/Settings.jsx` — new Billing section before Account Actions. Shows plan badge, subscription status pill, trial end date + days left. "Manage billing →" → portal. "Upgrade plan →" link to `/pricing` (shown when plan is trial or seed).
- `client/src/pages/Landing.jsx` — hero, nav, and final CTA updated: "Start Free Trial →" is now primary (green filled, → `/signup`), "Book a Demo →" is secondary (outlined, opens Calendly modal). Pricing section plan buttons now link to `/signup`.

**Access control:** No paywall. Trial expiry and payment failures show banners only — full app access preserved for all plans during pilot phase.

**Env vars needed in Railway:**
- `STRIPE_PRICE_SEED` — Stripe Price ID for $99/mo plan
- `STRIPE_PRICE_GROWTH` — Stripe Price ID for $249/mo plan
- `STRIPE_PRICE_IMPACT` — Stripe Price ID for $499/mo plan
- `STRIPE_BILLING_WEBHOOK_SECRET` — webhook secret for `/billing/webhook` endpoint (can reuse `STRIPE_WEBHOOK_SECRET` if using same endpoint)

---

### Onboarding wizard (2026-06-01)
Full-screen first-run wizard shown to admin users on brand-new orgs (no donors, grants, or financials). Trigger stored in `localStorage["steward_onboarded_" + orgId]` so it never fires twice.

**Backend:** Added 4 new org columns via `ALTER TABLE IF NOT EXISTS` in db.js (`focus_area TEXT`, `annual_budget TEXT`, `founded_year INTEGER`, `website TEXT`). Added `PATCH /orgs/:id` route in server.js (admin-org scoped) that updates all 5 profile fields. `adaptData` in api.js now passes `id`, `focus_area`, `annual_budget`, `founded_year`, `website` through on the org object.

**Frontend:** `client/src/components/OnboardingWizard.jsx` — 5-step wizard:
1. Welcome — 2×2 feature card grid, skip escape hatch
2. Org Profile — mission / focus area / budget / year / website, calls `PATCH /orgs/:id`
3. Import Donors — CSV upload with auto column mapping (reuses CSV_FIELDS/guessField/inferStage logic from Donors.jsx), or skip
4. First Sequence — pick one of 3 preset templates (New Donor Welcome / Lapsed Re-engagement / Major Donor Stewardship), calls `POST /sequences` with inline steps
5. You're Ready — checkmark, import/sequence status summary, 3 first-move action cards

Layout: `#0f1a12` full-screen overlay, left 40% panel (DM Serif headline, sage desc, gold italic, step dots), right 60% white card (36px 40px padding, 20px radius, deep shadow).

---

### Landing page nav + About definition block (2026-06-01)
"About" link added to desktop nav, mobile drawer, and footer nav (all via `replace_all`). About section given `id="about"`. Definition block added after closing gold line: gold `STEWARD` label, sage IPA + "noun", cream definition, sage second sentence — `#1a2e1f` inset card, gold left border.

---

### Landing page redesign (2026-06-01)
Full rebuild of `client/src/pages/Landing.jsx`. Dark hero (#0f1a12) with pure-CSS app UI mockup (stat cards + pipeline strip), Problem section (cream, gold-bordered pain cards), Features grid (3×2, icon-led), Org Health Score section (dark, CSS conic-gradient ring with score 82/B+), Pricing section (3 tiers: Seed $99 / Growth $249 highlighted / Impact $499), social proof, dark final CTA, dark footer. Typography-led, no gradients, no blobs. Calendly link and `/login` routing preserved.

---

### Black → dark green sweep (2026-06-01)
`T.ink` changed from `#0a0a0a` to `#0f1a12`; all hard-coded `#0a0a0a`, `#1a1a1a`, `#000000` (incl. `cc` overlay variants), and `"#111"` values replaced with `#0f1a12` across all component files.

---

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

### Custom Field Filtering (2026-06-01)
**Files:** `server.js`, `client/src/components/Donors.jsx`

Filter donors in the Directory view by their custom field values.

**New backend route:**
- `GET /donors/custom-field-values/all` — returns all `custom_field_values` rows for the org as `[{donorId, fieldId, value}]`. Declared before `GET /donors/:id` to prevent Express collisions.

**Frontend:**
- `Donors` component fetches `GET /custom-fields` and `GET /donors/custom-field-values/all` on mount; builds `cfValues[donorId][fieldId] = value` lookup map
- `cfFilters` state: keyed by fieldId; text/number → string, checkbox → string (""|"Yes"|"No"), dropdown → string[], date → `{from,to}`
- `filtered` computation extended with custom field filter pass (after existing filters)
- `FilterBar` extended with Custom Fields section (only shown when org has fields): dropdown → multi-select pills, checkbox → Any/Yes/No toggle, date → from/to range, text/number → search input
- Active filter count includes custom fields; dismissible pills show in the active filter bar with "Label: value" format
- `clearAll` resets cfFilters alongside standard filters
- `DonorProfile` calls `onCfSaved()` after saving a custom field value → triggers `reloadCfValues()` in parent so filters reflect the latest data

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

### Design system hardening (2026-06-01)
**Files:** `client/src/components/shared.jsx`, `client/src/App.jsx`, `client/src/components/Dashboard.jsx`, `client/src/components/Donors.jsx`, `client/src/components/Grants.jsx`, `client/src/components/Communications.jsx`, `client/src/components/Finance.jsx`, `client/src/components/Settings.jsx`

Full visual redesign. Direction: "Hardened, warm, confident. Attio meets a leather-bound ledger."

**Design tokens (shared.jsx T object):**
- Deep green `#0d5c3a` (greenDk), mid green `#1a6b4a` (greenMid), gold accent `#c9a84c`, near-black ink `#0a0a0a`
- Dark surface `#0f1a12` (bgDark), elevated surface `#1a2e1f` (bgElevated), dark border `#2d4a35`
- Shadow tokens (shadowSm/Md), border radius tokens (r6/r10/r14/r20)

**App shell:**
- Header + tab bar: `#0f1a12` bg with `#1a2e1f` border, cream logo, sage inactive tabs, gold active tab underline
- Avatar: deep green background

**Dashboard:**
- Stat cards: left `3px solid greenDk` border, DM Serif number in near-black
- AI briefing blockquote: gold left border `3px solid #c9a84c`, 19px DM Serif italic
- Quick Actions: dark `#0f1a12` container, `#1a2e1f` button cells, gold icons, sage labels

**Donors, Grants:**
- Kanban column headers: `#0f1a12` dark header block with stage/status color left border
- Right profile panel: full `#0f1a12` background, sage section labels, cream values, `#1a2e1f` surface cards

**Finance:**
- Sub-tab strip: `#0f1a12` bg, gold active underline
- Audit log table header: `#0f1a12` with sage column labels; timestamp column in monospace

**Communications:**
- Sequence cards: `#0f1a12` bg, cream name, sage meta, gold step count
- Campaign table header: `#0f1a12` with sage column labels

**Settings:**
- Custom field rows: `3px solid greenDk` left border on hover
- Account Actions danger zone: `#1a0a0a` bg, `#3d1515` border, `#f87171` sign-out button

**Updated shared components:**
- `Pill`: uppercase, weight 700, tighter padding
- `Card`: `variant="dark"` and `variant="elevated"` props
- `SectionLabel`: weight 800, wide letter-spacing
- `PageTitle`: 32px DM Serif, optional gold accent underline, subtitle prop
- `MetricCard`: shadow token, greenMid/red trend colors
- `AIBtn`: dark gradient, cream text, green glow
- `AIPanel`: `#0f1a12` bg, gold `3px` left border

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
