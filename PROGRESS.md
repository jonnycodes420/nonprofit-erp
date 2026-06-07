# Steward — Build Progress

### Billing lifecycle hardening (2026-06-07)

**DB schema (db.js)**
- Added `current_period_end TIMESTAMPTZ` and `grace_until TIMESTAMPTZ` columns to orgs (IF NOT EXISTS)

**Access state model (server.js)**
- `getOrgAccessState(org)` → `full | warning | read_only`. Logic: active/trialing → full; past_due/canceled within grace_until → warning; trial_expired or past/canceled past grace_until → read_only. Handles both `'cancelled'` and `'canceled'` spellings.
- `checkWriteAccess` middleware: queries org status, returns 402 `{error:"subscription_required"}` when read_only. Non-blocking on DB error.
- Applied to: `POST /donors`, `PUT /donors/:id`, `POST /donors/:id/gifts`, `POST /grants`, `PUT /grants/:id`
- Export route (`GET /org/export`) never blocked

**Webhook expansion (server.js)**
- `checkout.session.completed` → set active, store `current_period_end` (via Stripe subscription retrieve), clear `grace_until`
- `invoice.payment_succeeded` → set active, update `current_period_end`, clear `grace_until`
- `invoice.payment_failed` → set past_due, `grace_until = NOW() + 7 days`
- `customer.subscription.deleted` → set canceled, `grace_until = NOW() + 3 days`

**`GET /org` and `GET /billing/status`**
- Both now include `accessState` in response
- `/billing/status` also returns `graceUntil` and `currentPeriodEnd`

**Trial expiry job (server.js)**
- `checkTrialExpiry()` sets `subscription_status = 'trial_expired'` for orgs where status = 'trialing' AND trial_ends_at < NOW()
- Runs on startup (+15s delay) and every 6 hours via setInterval

**Multi-state banner (App.jsx)**
- read_only: red persistent bar with "Export data →" (→ settings tab) + "Reactivate →" (→ portal)
- warning + past_due: amber "Update payment →" (→ portal)
- warning + canceled: amber with grace date + export + reactivate
- trialing ≤14 days: existing green banner; ≤3 days turns amber with "Choose a plan →"
- Warning/read_only banners are not dismissible

**UI button gating (Dashboard, Donors, Grants)**
- Dashboard Quick Actions: "Add Donor", "Log Gift", "New Grant" disabled (opacity 0.45, not-allowed cursor) with tooltip when isReadOnly
- Donors: `+ Add` and `+ Add Gift` buttons disabled when isReadOnly
- Grants: `+ Add Grant` button disabled when isReadOnly

### Settings reorganization + onboarding sample data + JSON export (2026-06-07)

**Data export (server.js)**
- `GET /org/export` now returns a single JSON file instead of a zip — dead simple, no dependencies
- All tables fetched in parallel via `Promise.all`; donors enriched with custom field key-value map
- Filename: `steward-export-{orgSlug}-{YYYY-MM-DD}.json`; Content-Disposition header triggers browser download
- archiver uninstalled (`npm uninstall archiver`) — was causing `archiver is not a function` errors

**Onboarding sample data (WelcomePage.jsx)**
- Step 2 now offers two choices instead of a single "Enter My Workspace" button:
  1. "Load sample data & explore →" (gold) — calls `POST /org/load-sample-data` then navigates to /dashboard
  2. "Start with my real data" — navigates directly
- `loadingSample` state disables button and shows loading text while API call runs
- Non-fatal: if sample load fails, user still lands on /dashboard

**Settings reorganization (Settings.jsx)**
- Reorganized from flat card list into 6 clearly labeled sections with SecHead dividers (thin ruled line + uppercase label):
  1. **Organization** — user profile + org info card
  2. **Team** — team members list + Invite Staff button
  3. **Integrations** — Payments (Stripe), Donation QR Code, Embed Form, Gmail
  4. **Customization** — Custom Fields
  5. **Your Data** — Export card + Demo Data card (both gold-bordered)
  6. **Account** — Billing + Account Actions (sign out, legal links)
- `SecHead` defined as a const inside the component (before return) — renders a labeled horizontal rule

### Sample Data Loader — one-click demo org (2026-06-07)

**Backend (server.js)**
- `GET /org/sample-data-status` → `{ hasSampleData, sampleDonorCount }`
- `POST /org/load-sample-data` → guards if org has >5 real donors (400 error); seeds 25 donors across all 6 stages, all `assigned_to` current user so My Portfolio strip populates; also seeds 3 sample funds, gifts + historical giving, fin_transactions (income + expense), 4 grants, 2 events with attendees, 1 campaign with briefing + goal, 15 interactions, 5 tasks, 4 volunteers, 5 board members
- `POST /org/clear-sample-data` → deletes all records with `is_sample=true`, each table in its own `.catch(()=>{})`, correct FK order (attendees before events, gifts before donors, transactions before funds)

**Database (db.js)**
- `is_sample BOOLEAN DEFAULT false` added via ALTER TABLE IF NOT EXISTS to: donors, gifts, grants, events, event_attendees, campaigns, interactions, tasks, fin_transactions, fin_funds, volunteers, board_members

**Settings.jsx**
- Demo Data card at very top (after PageTitle), gold left border `#c9a84c`
- Fetches `/org/sample-data-status` on mount; shows Load button or "N sample donors loaded + Clear" depending on state
- Load/Clear both call `window.location.reload()` on success to refresh all data

**Donors.jsx**
- DirectoryView receives `totalDonors`, `onLoadSampleData`, `sampleLoading`, `hasSampleData` props
- When `totalDonors === 0 && !hasSampleData`: shows inviting empty state with Load Sample Data gold button instead of generic "No donors found"

### MGO Toolkit pt 2 — fund affinity, campaign briefings, interaction logging, stewardship timeline (2026-06-07)

**Feature 5: Fund Affinity tab in DonorProfile**
- New "Funds" tab between Gifts & Pledges and Materials in the donor profile left panel
- `GET /donors/:id/fund-affinity` — gifts grouped by fund_id with totals, counts, last dates, percentages
- Visual horizontal bars sorted by giving size; restricted vs unrestricted two-segment bar
- Suggested ask callouts for top funds; "not yet engaged with" list for unvisited active funds

**Feature 6: Campaign Briefings**
- `CampaignBriefing` component renders inside the expanded campaign row in Communications.jsx
- Editable textarea auto-saves on blur (PUT /campaigns/:id/briefing)
- Goal vs raised progress bar — raised is summed from gifts where campaign name or campaign_id matches
- Start/end dates, days remaining display
- DB columns added: `campaigns.briefing`, `campaigns.goal_amount`, `campaigns.raised_amount`, `campaigns.start_date`, `campaigns.end_date`

**Feature 7: Full Interaction Logging**
- Gift logged → auto-logs `type='gift'` interaction with amount and type
- Planned gift indicated → auto-logs `type='planned_gift'` interaction
- Material uploaded → auto-logs `type='material'` interaction with file name
- Stage change → auto-logs `type='stage_change'` interaction 'Moved from X → Y'
- POST /donors/:id/interactions now accepts `metadata` JSONB and stores `logged_by_name`
- Activity Log now shows "by [name]" on every interaction where available
- DB column added: `interactions.logged_by_name`

**Feature 8: Stewardship Timeline**
- Activity tab now has mode toggle: Activity Log | Stewardship Timeline
- Activity Log: type filter pills now include `stewardship` type; each item shows "by [name]"
- "Log Stewardship" button opens quick form: 8 touch types (thank you, recognition, gift sent, impact update, appreciation event, holiday card, birthday, other), detail field, date, note
- Stewardship Timeline: vertical visual timeline with auto-detected milestones (first gift ⭐, largest gift ⭐, 1-year anniversary ⭐, $10k/$25k/$50k/$100k/$250k cumulative thresholds ⭐); gold milestone nodes, color-coded by interaction type
- Stewardship touches stored as `type='stewardship'` interactions with `metadata.stewardship_type`
- Campaign attribution dropdown added to Add Gift form (pulls from /campaigns)

---

### MGO Toolkit pt 1 — officer dashboard, donor map, gifts/pledges tab, materials tab (2026-06-07)

**Feature 1: My Portfolio Strip (Dashboard)**
- Blue-bordered collapsible strip above org-wide stat grid; 6 FY metrics (portfolio count, visits YTD, moves made, gifts raised, pipeline value, lapsed in portfolio)
- `GET /dashboard/my-stats` — scoped to current user, July 1–June 30 fiscal year

**Feature 2: Donor Map**
- "Map" view in Donors toolbar toggle (next to Directory, My Pipeline, Team, Re-engage)
- Leaflet + react-leaflet@4.2.1 (React 18 compatible), OpenStreetMap tiles, Nominatim geocoding
- Color-coded pins by pipeline stage; stage filter checkboxes; "My portfolio only" toggle
- Sidebar lists donors without address on file; popup with "Open profile →"
- City/state/zip fields added to donors table and Edit Donor modal

**Feature 3: DonorProfile Tab System**
- Left panel now has 5 tabs: Overview | Gifts & Pledges | Funds | Materials | Activity
- Overview: unchanged (stat cards, giving history, tags, notes, tasks, touchpoint timeline)
- Gifts & Pledges: full gift table (inline edit/delete), Add Gift form, CSV export, planned giving CRUD
- Materials: drag-and-drop upload, base64 <1MB, view/delete
- Activity: see Feature 8

**Feature 4: Materials**
- `donor_materials` table: id, org_id, donor_id, file_name, file_type, file_url, file_data (base64), notes, uploaded_by, uploaded_at
- Backend: GET/POST /donors/:id/materials, DELETE /materials/:id

---

### Landing page messaging overhaul — outcome-first positioning (2026-06-06)
Complete rewrite of `client/src/pages/Landing.jsx`. New positioning: Steward is not a CRM — it's a fundraising partner built for missions that matter.

**New/updated sections (in page order):**
- **Nav**: Added "How it works" between Features and About; "Book a Demo" → "Book a 15-min demo" everywhere
- **Hero**: New headline "Your donors deserve to be remembered." / new subhead / trust line "Built for development teams doing more with less."
- **ROI Calculator** (new, dark bg): Interactive calculator with donor count, avg gift, retention rate slider. Real-time output: donors lost, revenue at risk, recovered revenue, ROI multiplier. Shows "Your mission can't afford not to." when ROI > 5x. State lives in Landing component; calculations are pure math (no API).
- **Problem**: Rewritten with specific, visceral pain card copy (847-row spreadsheet / lapsed donor / weekend board report)
- **Features**: New headline + subhead; outcome-first copy for all 6 cards
- **How it works** (new, cream bg, `id="howitworks"`): 4-step horizontal layout with gold-numbered circles + dashed connector line on desktop, stacks on mobile
- **Testimonials** (dark bg): New placeholder quotes with org-type tags; moved from white bg to dark to match brand tone
- **About**: Rewritten as founder story — "I built Steward after watching a nonprofit I cared about manage their entire donor program in Google Sheets." Definition block preserved.
- **Pricing**: Growth ($249) as hero dark card; Impact ($499) as secondary card (2-col grid, 3fr/2fr); Seed demoted to footnote link; closer quote added below tiers
- **Final CTA**: New headline "Your donors are waiting to hear from you." with two CTA buttons + muted fine print
- **Footer**: New tagline "Fundraising intelligence for missions that matter."; added ROI Calculator + How it works + Book a 15-min demo links

**Smooth scroll targets added:** `#roi`, `#howitworks` (existing: `#features`, `#about`, `#pricing`)
**Removed section:** Org Health Score (HealthRing component removed — not part of new page structure)
**No app component files touched. No routing changes.**

---

### Onboarding Email Sequence (2026-06-03)
7-email founder-voice drip sequence that fires automatically when a new org signs up. Backend only — pure sequences engine, no frontend changes.

**Pattern:** `sendOnboardingSequence(orgId, userId, userName, userEmail)` is called fire-and-forget at the end of `POST /auth/register-org`. Creates a sequence row + 7 steps + immediate enrollment in one transaction. The existing `processSequences()` engine handles delivery on its hourly tick.

**Trigger type:** `'onboarding'` — new trigger type added to the sequences system. `autoEnroll()` excludes it (no donor matching needed). `processSequences()` branches on `enr.seq_trigger === "onboarding"` to look up `users` table instead of `donors` (because `donor_id` stores the user_id for onboarding enrollments).

**7 emails (delay_days: 0, 2, 4, 7, 10, 18, 28):**
1. Day 0 — "You just made a great decision for your mission" — welcome + founder story + reply ask
2. Day 2 — "The spreadsheet problem (and how to fix it in 10 minutes)" — donor import CTA
3. Day 4 — `What if your CRM texted you "call Sarah today"?` — daily briefing feature
4. Day 7 — "Your board report used to take how long?" — board report PDF CTA
5. Day 10 — "The donors you're about to lose (and how to keep them)" — retention + re-engage CTA
6. Day 18 — "Quick question" — open feedback loop
7. Day 28 — "Your trial ends in 2 days" — upgrade CTA with pricing link

**Sender:** `FOUNDER_EMAIL` env var (default: `jonathan@stewardapp.dev`), not `DEMO_SMTP_FROM`. All onboarding emails include `reply_to: founderEmail`. Donor sequences continue to use `DEMO_SMTP_FROM`.

**Token support:** `{{first_name}}` (first word of name), `{{user_name}}`, `{{donor_name}}`, `{{org_name}}` — all resolved in `processSequences()` via `applyTokens()` helper.

**Interaction logging:** skipped for onboarding sequences (donor_id is a user_id — logging would create bad data).

**New env var needed in Railway:** `FOUNDER_EMAIL=jonathan@stewardapp.dev`
**Resend:** verify `jonathan@stewardapp.dev` as a sender in Resend dashboard.

---

### Events & Meeting Tracking (2026-06-02)
Full event lifecycle management — create events, track attendees, log gifts, create follow-up tasks.

**Database (2 new tables in `db.js`):**
- `events` — id, org_id, name, event_type (gala/cultivation/site_visit/board_meeting/volunteer/webinar/other), date, end_date, location, description, capacity, status (upcoming/completed/cancelled), revenue, cost, notes, created_at
- `event_attendees` — id, event_id (FK→events CASCADE), org_id, donor_id (FK→donors SET NULL), name, email, status (invited/confirmed/attended/no_show/cancelled), gift_amount, notes, UNIQUE(event_id, donor_id)

**Backend routes (all `requireAuth`, added before 404 handler in `server.js`):**
- `GET /events` — org events ordered by date DESC with attendee_count, confirmed_count, no_show_count, invited_count, total_revenue aggregates
- `POST /events` — create event
- `PUT /events/:id` — update event (name, type, date, status, revenue, cost, notes, etc.)
- `DELETE /events/:id` — cascade deletes attendees
- `GET /events/:id` — full event with attendees JOINed to donor data (stage, total_giving)
- `POST /events/:id/attendees` — bulk add donors by donorIds array OR add manual guest by {name,email}
- `PATCH /events/:id/attendees/:attendeeId` — update status/giftAmount; if status=attended + gift>0 + donor_id exists: logs gift to gifts table, updates donor totals, syncs to fin_transactions
- `DELETE /events/:id/attendees/:attendeeId` — remove attendee
- `POST /events/:id/follow-up` — creates tasks for all 'attended' donors with `{{event_name}}` token replacement; returns count
- `GET /donors/:id/events` — all events a donor has been invited to / attended

**Frontend — `client/src/components/Events.jsx`:**
- `PageTitle`: "Your events."
- **Stats strip**: 4 cards — Events This Year, Total Attendees, Event Revenue, Avg Attendance Rate
- **Filter toggle**: Upcoming / Past / All
- **Event cards** (2-col grid, 1-col mobile): type icon + left border color, DM Serif name, date+location, status badge, attendee/capacity progress bar, revenue display, Manage → button
- **NewEventPanel**: slide-in from right; name, type dropdown, date range, location, description, capacity, cost
- **EventDetail** (full-screen overlay): header with type/status badges; 4 stat tiles (Invited/Confirmed/Attended/No Show); Revenue vs Cost bars with net; notes textarea (auto-save on blur); inline attendee table with status dropdown click-to-edit + gift amount inline edit + remove; "Mark all confirmed as attended" bulk action; right panel: event stats (conversion rate, avg gift, top donor), Add Attendees (from directory with checkbox list / manual guest), Follow-up Tasks call-to-action
- **FollowUpModal**: task title template with `{{event_name}}`, due date, priority selector; shows count on success
- **Edit Event modal**: all fields editable inline from detail view header

**`client/src/App.jsx`:**
- Added `{id:"events",label:"Events",icon:"◎"}` to TABS and MORE_TABS
- Import and render `<Events data={data}/>` at `tab==="events"`

**`client/src/components/Donors.jsx`:**
- `DonorProfile`: fetches `GET /donors/:id/events` on mount; shows Events section in right panel (below Custom Fields) when donor has any events — each row shows type icon, event name, date, attendee status badge
- `LogTouchpointModal`: when type="event", loads org's events from `GET /events` and offers a dropdown to select from recent events (falls back to text input if none)

**`client/src/components/Analytics.jsx`:**
- Added Event Performance chart (7th chart): bar chart of attendee count per event (last 6), color-coded by event type; revenue legend below for events with gifts

**`client/src/components/shared.jsx` (GlobalStyles):**
- Added mobile CSS: `.events-stats-grid` 2-col, `.events-grid` 1-col, `.event-detail-body` stacks single column

**Event type color system:** gala=#8b5cf6, cultivation=#10b981, site_visit=#3b82f6, board_meeting=#0d5c3a, volunteer=#f59e0b, webinar=#ec4899, other=#6b7280 — used for card left border, type badges, chart bars.

---

### Terms of Service + Privacy Policy pages (2026-06-02)
Public legal pages at `/terms` and `/privacy`. Linked from Landing footer, Signup form, and Settings.

**New pages:**
- `client/src/pages/TermsPage.jsx` — 14-section Terms of Service. Covers acceptance, service description, accounts, billing (30-day trial, monthly billing, cancellation, failed payments, price changes), data ownership, acceptable use, privacy, IP, termination, limitation of liability, disclaimer of warranties, Kentucky governing law, and changes. Contact: `legal@stewardapp.dev`.
- `client/src/pages/PrivacyPage.jsx` — 13-section Privacy Policy. Covers data collected (account, donor/org data, usage, payments, cookies/localStorage), how it's used, AI features (Anthropic API usage disclosure), data ownership + Supabase/US storage, third parties (Supabase, Railway, Vercel, Stripe, Resend, Anthropic, Google Gmail API, Intercom, Sentry), Gmail integration (Limited Use disclosure), retention, user rights (CCPA/GDPR), children's privacy, security, governing law (Kentucky), and changes. Contact: `privacy@stewardapp.dev`.

**Both pages share:** sticky dark nav with Steward logo + "← Back to home" link; cream `#f0ede6` background; DM Serif Display headings; max-width 720px.

**`client/src/main.jsx`** — added `TermsPage` and `PrivacyPage` imports and routes `/terms` + `/privacy` (public, no auth guard).

**Links added:**
- `client/src/pages/Landing.jsx` footer bottom strip — Terms and Privacy links alongside copyright (muted `C.dark3` color matching existing style)
- `client/src/pages/SignupPage.jsx` — "By signing up you agree to our Terms of Service and Privacy Policy." with underlined links to `/terms` and `/privacy`
- `client/src/components/Settings.jsx` Account Actions section — "Terms of Service" and "Privacy Policy" links below Sign out button (open in new tab)

---

### Intercom live chat widget (2026-06-02)
Users can message from inside the app. Widget appears bottom-right on all authenticated screens.

**`client/index.html`** — standard Intercom loader snippet added to `<head>`. Sets `window.intercomSettings` with `app_id`, then async-loads the widget script.

**`client/src/App.jsx`** — `window.Intercom('boot', {...})` called in a `useEffect([auth])` inside `AppShell`. Passes user name, email, and org context (id, name, plan) so conversations in the Intercom dashboard show the org and plan automatically.

**To activate:** Go to [intercom.com](https://intercom.com) → sign up free → Settings → Installation → copy the App ID → replace `YOUR_INTERCOM_APP_ID` in two places:
- `client/index.html` (lines with `app_id` and widget script URL)
- `client/src/App.jsx` (the `boot` call `app_id` field)

---

### Sentry error monitoring (2026-06-02)
Frontend and backend wired to Sentry. Both only initialize when the DSN env var is set — no-op in local dev without the var.

**Packages installed:**
- `@sentry/node@10.56.0` — root `package.json` (backend)
- `@sentry/react@10.56.0` — `client/package.json` (frontend)

**`server.js`:**
- `Sentry.init()` called at the very top (after `dotenv.config()`, before all other requires), guarded by `if (process.env.SENTRY_DSN)`
- `Sentry.Handlers.requestHandler()` registered immediately after `cors` middleware (first middleware position), conditionally
- `Sentry.Handlers.errorHandler()` registered just before the global 500 error handler, conditionally

**`client/src/main.jsx`:**
- `import * as Sentry from "@sentry/react"` at top of file
- `Sentry.init()` with `browserTracingIntegration()`, guarded by `if (import.meta.env.VITE_SENTRY_DSN)`

**Setup instructions:**
1. Go to [sentry.io](https://sentry.io) → create account (or sign in) → **New Project**
2. For backend: choose **Node.js** → copy the DSN → add to Railway as `SENTRY_DSN`
3. For frontend: choose **React** → copy the DSN → add to Vercel as `VITE_SENTRY_DSN`
4. Both DSNs are different — create two separate Sentry projects for cleaner separation

**New env vars:**
- `SENTRY_DSN` — Railway (backend). Without it, Sentry is entirely skipped.
- `VITE_SENTRY_DSN` — Vercel (frontend). Without it, Sentry is entirely skipped.

---

### Email deliverability setup (2026-06-02)
Infrastructure documentation + startup warning for SPF/DKIM/DMARC via Resend.

**`EMAIL_SETUP.md`** (repo root) — step-by-step guide covering:
1. Adding `stewardapp.dev` in the Resend dashboard
2. Exact DNS records for Vercel nameservers: SPF TXT (`v=spf1 include:amazonses.com ~all`), two DKIM CNAME records (values from Resend), DMARC TXT (`v=DMARC1; p=quarantine; rua=...`)
3. Verifying the domain in Resend (green checkmarks on SPF/DKIM/DMARC)
4. Setting `DEMO_SMTP_FROM=noreply@stewardapp.dev` and `RESEND_DOMAIN_VERIFIED=true` in Railway
5. Testing with mail-tester.com (target 9–10/10)
6. Spam troubleshooting checklist: IP warm-up, MX records, content scoring, Google Postmaster Tools, Resend logs

**`server.js`** — added startup warning in `app.listen` callback:
```js
if (!process.env.RESEND_DOMAIN_VERIFIED) {
  console.warn("[email] WARNING: RESEND_DOMAIN_VERIFIED not set — emails may land in spam");
}
```

**New env var:** `RESEND_DOMAIN_VERIFIED=true` — set in Railway after verifying domain in Resend. Suppresses the startup warning. No runtime effect beyond the check.

---

### Password reset flow (2026-06-02)
Users can request a reset link via email and set a new password.

**Database:** `password_reset_tokens` table — id, user_id, token (UNIQUE), expires_at (`NOW() + INTERVAL '1 hour'`), used BOOLEAN, created_at.

**Backend (`server.js`):**
- Added `const crypto = require("crypto")` at top
- `POST /auth/forgot-password` — finds user by email (silent 200 if not found), generates 32-byte hex token, inserts into `password_reset_tokens`, sends branded HTML reset email via Resend from `noreply@stewardapp.dev`. Subject: "Reset your Steward password".
- `POST /auth/reset-password` — validates token (unused + not expired), bcrypt-hashes new password (min 8 chars), updates `users.password_hash`, marks token `used=true`.

**Frontend:**
- `client/src/pages/ForgotPasswordPage.jsx` — split dark-left / white-right layout matching SignupPage. Email input → "Send reset link →" → success state shows "Check your email — we sent a reset link to [email]." with back-to-login link.
- `client/src/pages/ResetPasswordPage.jsx` — reads `?token=` from URL. New password + confirm inputs with inline validation (min 8 chars, match check). Success: "Password updated! Redirecting to login…" → 2s redirect to `/login`. Error message from API shown in red.
- `client/src/main.jsx` — added `/forgot-password` and `/reset-password` routes (public, no auth guard).
- `client/src/pages/LoginPage.jsx` — "Forgot your password?" link added below password field, right-aligned, muted 12px, links to `/forgot-password`.

---

### PWA — installable app (2026-06-02)
Steward is now installable on iPhone and Android home screens. Runs full-screen with no browser chrome.

**Files created/modified:**
- `client/public/site.webmanifest` — updated with Steward name, `#0f1a12` theme/bg, `start_url: /dashboard`, existing android-chrome PNG icons (192 + 512), `display: standalone`
- `client/public/sw.js` — service worker: caches static assets on install, network-first strategy for all GET requests (API calls pass through uncached), serves `/offline.html` for failed navigation requests
- `client/public/offline.html` — dark `#0f1a12` offline page: Steward mark, "You're offline" in DM Serif, animated green pulse dots, "Try again" button
- `client/index.html` — added `<meta name="theme-color">`, `<meta name="apple-mobile-web-app-capable">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, `<meta name="apple-mobile-web-app-title">`, startup image link
- `client/src/main.jsx` — registers `/sw.js` on `window.load`
- `client/src/components/shared.jsx` (GlobalStyles) — added `overscroll-behavior:none` on body, `-webkit-tap-highlight-color:transparent` globally, `touch-action:manipulation` on all buttons, `.app-header { padding-top: env(safe-area-inset-top) }` for iPhone status bar, `user-select:none` on nav elements (already had safe-area bottom padding)
- `client/src/App.jsx` — `className="app-header"` on sticky header div; `beforeinstallprompt` handler fires after 30s; install banner (above bottom nav, `#0f1a12` bg) with "Add" + × dismiss; dismissed state saved to localStorage

**No new npm packages installed** — uses existing android-chrome PNGs already in `client/public/`.

---

### Gmail integration — Session 2: Send from donor profiles + AI thread context (2026-06-02)
Send emails directly from donor profiles via connected Gmail. Full thread history fed into AI context.

**Backend (`server.js`):**
- `POST /gmail/send` — requireAuth. Gets user's active gmail_connection, builds RFC 2822 email, sends via `gmail.users.messages.send`, retries once on 401 (then sets `status='disconnected'`). Logs `type='email'` interaction with `metadata={gmail_message_id, from, to, subject, direction:'outbound'}`.
- `GET /gmail/thread/:donorId` — requireAuth. Returns last 20 email interactions for donor (type='email'), with parsed `{subject, snippet, direction, created_at}`.

**Frontend (`Donors.jsx` — DonorProfile):**
- `gmailConnected` state: fetches `GET /gmail/status` on mount
- "✉ Send Email" button in AI Intelligence section (same style as AIBtn small)
- Compose panel: inline dark surface (`#1a2e1f`), slides open below AI buttons. Pre-fills To field with `donor.email`. Subject + body inputs + token hint (`{{donor_name}}`, `{{org_name}}`).
- "✦ Draft with AI": fetches thread, streams AI with donor context + thread history. Parses `Subject: X` from first line into subject field, rest into body.
- "Send →": replaces tokens, calls `POST /gmail/send`, shows "✓ Sent and logged" toast for 3s, closes panel, calls `onInteractionAdded` → `reloadDonors`.
- If Gmail not connected: shows "Connect Gmail in Settings" link instead of form.
- If donor has no email: shows "No email address on file" message.
- `getAI` for "email" and "outreach" types: fetches `GET /gmail/thread/:donorId` first, prepends thread history to prompt if ≥1 email exists.

**`api.js`:** `adaptData` interactions mapping now includes `metadata: i.metadata || null` so direction badges work on timeline.

**`shared.jsx TouchpointTimeline`:**
- Email dot → ✉ icon
- "Sent" direction badge changed from grey → blue pale (`#eff6ff`/`#1d4ed8`/`#bfdbfe`)
- "via Gmail" label shown when `meta.gmail_message_id` exists

---

### Gmail integration — Session 1: OAuth connect + sync (2026-06-02)
Donors who email the org auto-log to their interaction timeline.

**Database:** `gmail_connections` table (id, org_id, user_id, email, access_token, refresh_token, token_expiry, last_synced_at, history_id, status, UNIQUE(user_id)). `metadata JSONB` column added to `interactions`.

**Backend (`server.js`):**
- `makeOAuth2Client()` factory (reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`)
- `syncGmail(userId, orgId)` — fetches Gmail messages matching known donor emails (chunked 20 at a time, max 100/chunk), deduplicates via `metadata->>'gmail_message_id'`, inserts `type='email'` interactions with `note="Subject: X\n\nsnippet"` and `metadata={gmail_message_id, from, to, subject, direction}`
- `syncAllGmail()` — iterates all active connections, called on startup (+10s) and every 15 min
- Token auto-refresh via `oauth2Client.on('tokens')` listener; revoked tokens set `status='disconnected'`
- Routes: `POST /gmail/auth-url` (returns OAuth URL), `GET /gmail/callback` (public, exchanges code, upserts connection, kicks initial sync), `GET /gmail/status`, `DELETE /gmail/disconnect` (revokes token), `POST /gmail/sync` (manual trigger)

**Frontend:**
- `Settings.jsx` — new Integrations section with Gmail card: Connect/Reconnect/Disconnect buttons, "Sync now", connected email + last-synced time, success/error toast on redirect back from OAuth
- `shared.jsx TouchpointTimeline` — email interactions parsed into subject (bold) + snippet (muted, 2-line clamp) + direction badge (Received/Sent)
- `Dashboard.jsx` — activity feed shows "Email — [subject]" instead of just "Email" for Gmail-synced messages

**Env vars needed:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://nonprofit-erp-production.up.railway.app/gmail/callback`
**Setup:** Enable Gmail API in Google Cloud Console, add OAuth consent scopes `gmail.readonly` + `gmail.send`, add redirect URI.

---

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
