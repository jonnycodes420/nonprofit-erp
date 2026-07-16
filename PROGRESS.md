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

## RESOLVED — stage inference bug (was "TOP PRIORITY NEXT SESSION")

**Confirmed fixed** (verified by reading the current code, 2026-07-16) — this entry sat unresolved in this file for several sessions after the actual fix landed; leaving it as a record of what was wrong and where the fix lives, since the same staleness pattern (fixed in code, never marked resolved in the docs) turned out to affect `SECURITY_REPORT.md` too around the same time.

`POST /donors/import-combined`'s stage-inference block (`server.js` ~1925-1958) now runs with **no `WHERE stage='prospect'` guardrail** — the fix direction this entry originally called for. Comment in the code states the reasoning directly: "No prospect-only guardrail here: new donors land as 'cultivate' (DB default), so the guardrail would match zero rows. Combined-import only creates NEW donors — no human-set stages to protect." The `CASE` expression mirrors the client-side `inferStage()` exactly (qualify/solicit bands included) and runs `WHERE org_id=? AND id = ANY(?) AND deleted_at IS NULL` — scoped to just the newly-affected donor IDs from that import batch, not a blanket update.

---

## OTHER PENDING (none blocking, none urgent)

1. UI: consolidate three import buttons (Import / Giving History / Import + History) into ONE "Import" dropdown with three options. Pure polish, no logic change. **Still open** — confirmed 2026-07-16, `Donors.jsx` still renders all 3 as separate buttons.
2. ~~Favicon revert to old dark-green-square no-gold-bar version~~ — **DONE**, same as the "Favicon fix (2026-07-10)" entry below (dropped the gold underline bar, kept badge + "S"). This was the same ask under a different description; resolved without ever being checked off here.
3. CREO test-data cleanup: run `DELETE FROM donors WHERE org_id='org_creo' AND email LIKE '%@example.com';` to clear ~800+ .combo/.final test donors and restore the ~7 real demo records. Not re-checked this pass.
4. /gifts/import-history still has per-row insert N+1 (minor speed; combined route is already bulk). Not re-checked this pass.
5. Combined import Shape B (separate donor file + gift file chained) — deferred. Not re-checked this pass.

DONE (was item 6): Expired-token UX — see "Auth, Gmail, billing/Reactivate, and QA-sweep fixes" below.
6. QA sweep (2026-07-10, `QA_REPORT.md`) — **both Blocking findings now confirmed resolved** (2026-07-16 code-inspection pass): #1 signup mobile overflow — `GlobalStyles()`'s `@media(max-width:768px)` block has working `.signup-shell`/`.signup-left`/`.signup-right`/`.signup-card` rules matching `SignupPage.jsx`. #2 `checkWriteAccess`/read-only gaps — confirmed both server-side (already known) and client-side now too (`isReadOnly`-gated buttons present in Volunteers/Tasks/Events/Communications/Board/Settings, matching CLAUDE.md's "SaaS billing" button list). Both findings sat marked "possibly still open" in this file for several sessions after actually being fixed.
7. Data integrity check requested (orphaned orgs after manual Supabase row deletion, specifically `org_ec6340db`, plus dangling FK refs to deleted user IDs) — diagnostic tooling built (`GET/POST /admin/data-integrity`, see below) but never actually run against production; blocked on missing super-admin credentials in that session. **Still open** as of 2026-07-16.

---

## Earlier sessions (for reference)

### BUILD-04 wrap-up (2026-07-16)

- **OPS_REPORT.md** (the GTM ops gap list, previously untracked) updated with a dated verification-pass table and committed: rate limiting, unsubscribe/suppression, and backend crash capture were already FIXED in the 2026-07-10–07-13 sessions (report was stale); the net remaining ops items are all dashboard-side, no code (Vercel Sentry env vars, Sentry alert-rule check, Supabase backup-tier check, uptime-monitor signup). **QA_REPORT.md** also committed for the same reason (referenced by CLAUDE.md but never tracked).
- **Interaction-delete debt: CLOSED** (Strike 1 — route + UI + Elizabeth Butler cleanup done in production).
- **Ops/monitoring gap item: CLOSED as far as verifiable from code/HTTP** (Strike 4) — remaining steps are named human clicks, listed in OPS_REPORT.md's update block.
- **SECURITY_REPORT.md §1 cross-check: BLOCKED** — the parallel session handling the §1 org-scoping edge cases had not pushed to main by the end of this session (checked twice), so the report still shows §1 as the open punch list. Deliberately did not touch §1 code or the report's §1 wording here, to avoid colliding with that session. Re-check after it lands.

### BUILD-04 Strike 4 — error monitoring verified (backend live, client NOT live) + uptime decision (2026-07-16)

The GTM gap list said "no confirmed error monitoring" while CLAUDE.md documented a full Sentry setup — resolved by verification, not rebuilding. **Outcome: backend monitoring is live and exercised; client monitoring is NOT live — two named env vars missing from Vercel.**

- **Backend — VERIFIED live**: added `sentry: !!process.env.SENTRY_DSN` to `GET /health` (non-secret boolean) — production Railway returns `sentry: true`, so `Sentry.init()` ran. Added `POST /admin/debug/sentry-test?mode=route|rejection` (requireAuth + requireAdmin, safe to keep) and fired both against production with the demo admin: route mode → 500 through `Sentry.setupExpressErrorHandler` as designed; rejection mode → 200 with the process confirmed still up afterward (`unhandledRejection` reports without exiting, per design). **One human step remains**: open the Sentry project and confirm the two `[sentry-test] deliberate ...` events from 2026-07-16 actually arrived — no Sentry dashboard credentials exist in the dev environment, so arrival can't be confirmed from here (everything up to the Sentry ingest boundary is confirmed).
- **Client — NOT live, named gap**: the deployed Vercel bundle (`index-CTZozjYM.js`) contains no DSN string and zero `_sentryDebugId` markers → **`VITE_SENTRY_DSN` is not set in Vercel's build env** (browser errors currently report nowhere) **and `SENTRY_AUTH_TOKEN` isn't either** (no source maps uploaded — any future prod stack trace would be minified). Fix is config-only: set `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in Vercel project env vars and redeploy; the code paths are already built and gated on them.
- **Uptime — decision documented, no code**: external ping (UptimeRobot or Better Stack free tier) on `GET /health` (keyword `"status":"ok"`) + `https://www.stewardapp.dev/give/creo-arts-creo` (public donate path, slug verified live), alerting to the founder email. Setup steps in CLAUDE.md's "Uptime monitoring" section — needs an account signup, so it's a user click-through (~5 min), not automatable from this environment.

### BUILD-04 Strike 3 — four-KPI-card question on Home: RESOLVED, superseded (2026-07-16)

A handoff flagged an unconfirmed ask for "four equally-weighted drillable KPI cards" on Home, while screenshots kept showing three hero metrics. Loop closed — **the four-equal-cards ask was not implemented, and deliberately so: it was superseded by later, explicit founder feedback.** Do not implement it; that would reverse two documented decisions:

- **`436a6b5` (2026-07-13)** — founder's live reaction to the Stewardship Debt hero: "weird," "not a fan." Result: Donor Retention Rate promoted to the single hero (the number development directors actually benchmark — 43% sector average), Stewardship Debt explicitly *demoted* to a slim strip ("demote, don't delete"). Equal visual weight was abandoned there, on purpose.
- **`d72dbd0` (2026-07-15)** — founder feedback that the page read as a "wall of cold statistics" → narrative-first metric copy (a sentence of context with the number as evidence), the opposite of an equally-weighted stat-card grid. The old dashboard's 4-card KPI stat row had already been deliberately removed in the 2026-07-12 action-queue rebuild.

**What actually renders (live-screenshotted this pass, demo org, 2026-07-16)**: goal banner → scope toggle → one relationship-health card holding Donor Retention Rate (hero, sparkline, drillable → `MetricBreakdownPanel` with the real ranked non-retained donor list — verified open with real data), First-Touch Delay (secondary; deliberately no ranked breakdown since it's an average — it surfaces the actual newest-untouched donors as chips instead), and Stewardship Debt (demoted strip, drillable → its own `MetricBreakdownPanel`, verified) → My Portfolio (6 drillable stats, third `MetricBreakdownPanel`) → queue/briefing → funnel + next-grant tile + Recurring Gifts revenue-at-risk card (renders when the org has active recurring gifts — the demo org currently has none, so it's absent from the screenshot; logic confirmed in code). The "fourth KPI" the original ask would have needed (Recurring Revenue at Risk per the handoff's fallback suggestion) already exists on the page as that card — just not as an equal-weight hero, consistent with the hierarchy decision.

### BUILD-04 Strike 2 — dead code stripped: Analytics.jsx + TodayPage.jsx deleted (2026-07-16)

Analytics is dead-not-paused per the documented pivot; TodayPage had been unrouted dead code since the 2026-07-12 home-screen consolidation. Both deleted outright:
- `client/src/components/Analytics.jsx` and `client/src/pages/TodayPage.jsx` removed; App.jsx's Analytics import, render branch, and commented-out `TABS`/`MORE_TABS` entries removed; shared.jsx's `.analytics-grid` mobile CSS rule (only consumer was Analytics.jsx) removed.
- **Server endpoints checked for other callers before deleting**: Analytics.jsx computed all 7 charts client-side from the shared `data` prop plus `GET /campaigns` and `GET /events` — both have other callers (Communications, Events) and were kept. The only zero-caller route was `GET /analytics` itself (no client reference anywhere — not even Analytics.jsx used it); deleted.
- Deliberately untouched: `STAGES` (drives Kanban/Funnel), hidden-but-alive modules (Finance/Volunteers/Board/Tasks/Events), shelved-by-design `VoiceMemoModal`, the `/today` → `/dashboard` redirect in main.jsx (bookmarks; it imports nothing dead — it's a bare `<Navigate>`), main.jsx's `<Analytics />` (that's `@vercel/analytics`, unrelated), and Communications' own internal Analytics subtab.
- Verified: `vite build` passes, `node --check server.js` passes, live click-through of Home/Donors/Grants/Communications/Settings on the deployed app + `/today` still redirecting (see commit).

### BUILD-04 Strike 1 — DELETE /interactions/:id + Gmail resync exclusions (2026-07-16)

Twice now, test/mistaken interaction log entries could only be removed by manual DB surgery — staff will mis-log touchpoints forever, so this is a permanent need, not a one-off cleanup.

- **`server.js`** — `DELETE /interactions/:id`: requireAuth, org-scoped, 404 on zero affected rows; no `checkWriteAccess` (DELETE routes are never gated, per convention). Everything is deletable including Gmail-synced rows.
- **Gmail resync decision**: chose the exclusions-table option (not accept-and-document). Deleting a Gmail-synced interaction would otherwise only last until the next 15-minute sync pass, since the dedup key (`metadata->>'gmail_message_id'`) vanishes with the row. New `gmail_sync_exclusions` table (org_id + gmail_message_id, unique pair) — the DELETE route records the message id before deleting; `syncGmail` loads the org's exclusions into a Set at sync start and skips those message ids ahead of the per-message dedup query.
- **UI** — hover-reveal 🗑 (`.tp-del-btn`, mirrors the existing `.dir-assign-btn` pattern; always visible ≤768px since touch has no hover) on both `TouchpointTimeline` entries (DonorProfile Overview) and the Activity tab's Activity Log cards. Browser-confirm before delete, optimistic removal, profile refetch + alert on error. Grants' use of `TouchpointTimeline` (grant_interactions, a different table) passes no `onDelete` and gets no icon.
- **Verified** (scripted, real `server.js` booted against a real local Postgres 16 with only `googleapis` mocked — 11/11 checks passed): cross-org delete 404s and deletes nothing; same-org delete removes exactly one row (sibling intact, second delete 404s); a deleted Gmail-synced interaction records its exclusion row and does NOT reappear after a forced `syncGmail` run, while an undeleted synced message stays deduped to exactly one row.
- **Demo-org cleanup**: used the new route (via the live API, demo admin login) to delete the self-labeled test entries on Elizabeth Butler's timeline that previously needed manual DB surgery.

Full build per spec: IRS-compliant receipts for online gifts (auto-sent once an org completes tax settings — legal name, EIN, address, signature), one-click (never automatic) receipts for offline/manually-entered gifts, consolidated calendar-year giving statements per donor, and a staff-facing "$250+ needs a tax receipt" queue item. US-only, cash/cash-equivalent gifts only in v1 — **explicit non-goals**: no Canadian/CRA receipts, no in-kind gift receipting. The legal copy embedded in the PDF/email templates is flagged in the commit message for attorney review before this is relied on in production.

- **`db.js`**: `orgs` — `legal_name`, `ein`, `receipt_address`, `receipt_signature_name`, `receipt_signature_title`, `receipt_custom_message`, `receipts_enabled BOOLEAN DEFAULT false`, `receipt_counter INTEGER DEFAULT 0` (atomic per-org receipt-number allocation, never `SELECT MAX()+1`). `gifts` — `deductible_amount`, `quid_pro_quo_desc`, `quid_pro_quo_value` (quid-pro-quo gifts, e.g. a gala ticket, need the deductible portion tracked separately from the gift amount). New `receipts` table (id, org_id, donor_id, gift_id nullable, type `gift`\|`year_end`, tax_year, receipt_number, amount, deductible_amount, `snapshot JSONB` — a frozen copy of everything the PDF needs so a later org-settings edit never changes a past receipt's rendered content, pdf_data base64, sent_to/sent_at, voided_at/void_reason). Two partial-unique indexes enforce the real invariants: `receipts_active_gift_uk (gift_id) WHERE voided_at IS NULL AND type='gift'` (at most one active receipt per gift) and `receipts_active_statement_uk (org_id, donor_id, tax_year) WHERE voided_at IS NULL AND type='year_end'` (at most one active statement per donor per tax year).
- **`server.js`**: `issueGiftReceipt()` is the single choke point for gift receipts — idempotent (checks for an existing active receipt before creating one, backed by the DB constraint as a second line of defense against a race), skips `is_sample` gifts, renders the PDF via `renderReceiptPdf()` (shared by both receipt types via internal branching, avoiding a duplicate PDF-layout implementation), stores it, attempts email via Resend, and sets `gifts.acknowledgement_sent=true` regardless of email outcome — the PDF being generated and stored (available for manual download/mailing) satisfies the IRS "contemporaneous written acknowledgment" requirement even if the send itself fails or the address is suppressed. `issueYearEndStatement()` uses **supersede, not idempotent-reject**, semantics — regenerating a statement voids the prior active one and issues a fresh one, since (unlike a single gift's receipt) a donor's year-end statement legitimately needs to be regenerated as more of the year's gifts land; the partial-unique index guarantees exactly one active statement per donor/year at all times either way. `allocateReceiptNumber()` does an atomic `UPDATE orgs SET receipt_counter = receipt_counter + 1 ... RETURNING receipt_counter`. 7 new routes (`GET /receipts/preview`, `POST /receipts/year-end-run`, `GET /receipts/:id/pdf`, `POST /receipts/:id/void`, `POST /gifts/:id/receipt`, `GET /donors/:id/receipts`, `POST /donors/:id/year-end-statement`). Webhook: `payment_intent.succeeded` now fires `issueGiftReceipt` fire-and-forget after the existing gift-insert. `PUT /gifts/:id` never auto-voids an existing receipt on edit (a receipt is a legal record of what was actually sent, not something that silently changes to match a later edit) — instead `GET /dashboard/today` gained two live-computed queue buckets: "$250+ gift needs a tax receipt" (priority 76 — deliberately one point above the existing "not yet thanked" bucket's 75, so a legally-required receipt wins the `upsertItem` tie when both apply to the same offline gift; verified this actually wins in practice, see Verification below) and "receipt no longer matches its gift" (priority 70, `LEFT JOIN gifts` so a deleted gift is caught too, not just an amount/date edit). Both the admin org-delete cascade and `clear-sample-data` now delete `receipts` before `donors`/`gifts`.
- **`Settings.jsx`**: new `TaxReceiptsManager` module-scope component — legal name/EIN/address/signature fields, live preview (downloads a sample PDF via `GET /receipts/preview`), enable toggle (blocked server-side until required fields are present), year-end statement dry-run/generate-and-send.
- **`Donors.jsx`** (DonorProfile, Gifts & Pledges tab): new "Receipt" column in the gifts table — `Receipt ✓ #2026-00042` (click → downloads the stored PDF) when one exists, a "Send receipt" button (one-click, `isReadOnly`-gated with the standard tooltip) when it doesn't and receipts are enabled, a dash otherwise. "Year-end statement" button + expandable panel in the tab header, plus an admin-only nudge banner when receipts aren't enabled yet.

**Verification** — read CLAUDE.md/PROGRESS.md's "Current-state assumptions" first and confirmed against actual code rather than trusting docs (per this project's repeated stale-docs pattern, see the entries below). Two tiers, both against the real local Postgres/Stripe-Connect test infra from the earlier Stripe test-mode session (port 5544, `steward_test` DB, org_creo connected to `acct_1TtfeL6zhYoZHZmD`) — chose to reuse and extend that infra rather than mock anything:
1. **Scripted, against a real running server + real Postgres**: column types spot-checked directly via `\d` against what the code writes (the `tasks.done` boolean/INTEGER lesson explicitly re-checked — `receipts_enabled` and all new columns are genuinely the types the code assumes). EIN normalization (`471234567` → `47-1234567`) and the enable-requires-legal-fields 400 both verified. Offline one-click receipt: created, idempotent on a second call (409, no duplicate row), voided, correctly re-issued a new sequential receipt number after void. Year-end statement: itemizes multiple gifts correctly, confirmed supersede-not-duplicate behavior (old row's `voided_at` set, new row created) rather than assuming it from the code alone. Both PDF types downloaded and confirmed valid single-page PDFs (re-checked the pdfkit footer-overflow bug pattern specifically — neither spills to a second page). Dashboard queue: confirmed the priority-76-beats-75 tie-break actually happens (not just that the code says it should) by creating a gift that satisfies both bucket conditions for the same donor and observing which one won; confirmed the mismatch bucket fires after editing a receipted gift's amount.
2. **Live Stripe test-mode**: no live `STRIPE_SECRET_KEY` was available in this session (deliberately did not extract one from local config). With the user's approval, verified the real production code path instead of skipping this tier: hand-built a `payment_intent.succeeded` event with real donor metadata, signed it with Stripe's actual HMAC scheme using a webhook secret issued by the authenticated `stripe` CLI (`stripe listen --print-secret` — not an account credential, just a local signing secret), and POSTed it to the real `/stripe/webhook` route. Confirmed: signature verification passed, the gift was created, `issueGiftReceipt` fired fire-and-forget and produced a correctly-numbered receipt with the right amount, `acknowledgement_sent` flipped to true, and the Resend send failure (dummy API key) was caught and logged without crashing the process — end-to-end through the actual webhook handler, not a mocked call.

Test infra torn down cleanly after verification (server + local Postgres stopped).

### Security review verification pass — CRITICALs, RBAC, file upload confirmed fixed (2026-07-16)

Not a fix session — the existing `SECURITY_REPORT.md` (2026-07-10, discovery-only) had 4 CRITICALs and several GAP items still marked open. Re-checked every one directly against current code rather than trusting the doc: **all 4 CRITICALs (C1 custom-fields cross-tenant write+read, C2 `PUT /events/:id` cross-tenant read, C3 `/billing/webhook` signature verification, C4 sequences enroll/enrollments donor PII leak), the RBAC gap (`billing/create-portal`, `billing/create-checkout`, `orgs/:id` PATCH), and the file-upload gap (`donor_materials` size/MIME validation) were already fixed** — someone had done the work in an earlier, undocumented pass, and the report was just never updated to say so. Updated `SECURITY_REPORT.md` in place with file:line evidence for each (rather than rewriting it), so it stops reading as an open punch list. Only remaining open item from that report: §1's org-scoping edge cases (`programs/:id/grants` link+delete, `gmail/send`→`interactions`, `finance/transactions`) and the JWT-algorithm-pinning hardening recommendation.

Also ran a fresh, dedicated audit of the Giving Pages / peer-to-peer fundraising surface (built this session, not covered by the 2026-07-10 report) against the same categories — no CRITICALs. Fixed two small things found there: a stale code comment claiming `GET /giving-pages/:id/fundraisers` was admin-only when it correctly wasn't (donor/fundraiser PII is staff-visible app-wide, same as `GET /donors` — reworded the comment, no behavior change), and missing input validation (length caps, goal-amount sanity) on the admin `POST`/`PUT /giving-pages` routes and the token-authenticated `PUT /peer-fundraisers/manage/:token` route — their public-facing sibling route already had these checks, added a shared `validateGivingPageFields()` helper and matching checks to the other three.

This is the second time in one week a discovery report sat stale after its findings were actually fixed (see the resolved "KNOWN BUG — stage inference" entry above, and PROGRESS.md's own outdated GuidedTour entry from 2026-06-07) — worth treating any "known issue" doc as a claim to verify against current code before acting on it, not a source of truth on its own.

### Stripe test-mode payment verification + silent task-creation bug (2026-07-15/16)

Ran a full real Stripe test-mode payment through the peer-to-peer donation flow end-to-end (isolated local Postgres + local backend/frontend, a genuinely onboarded test-mode Connect account, `stripe listen` forwarding real webhook events) — not a mocked/stubbed test. Confirmed: Checkout Session creation with correct product name/amount/metadata (`giving_page_id` + `peer_fundraiser_id` both present), a real 4242-card payment completing through Stripe's hosted Checkout, webhook signature verification succeeding, and the resulting gift landing with correct `org_id`/`giving_page_id`/`peer_fundraiser_id`/`stripe_payment_id`.

That test surfaced a real, previously-silent bug: **`tasks.done` is `INTEGER`, not boolean**, but 5 separate auto-generated task INSERTs across the codebase were passing JS/SQL `false` — Postgres rejected every one, and since each site was wrapped in `.catch(()=>{})` or the webhook's own outer try/catch, the failures never surfaced anywhere. Fixed all 5 (changed to `0`, matching the 3 other task-creation sites that were already doing it correctly): the online-gift "send thank-you" task, the lapsed-donor re-engagement task, the recurring-donor welcome task (all three in the `/stripe/webhook` handler), the grant-closed 6-month follow-up task (`PUT /grants/:id`), and the volunteer-cultivation task (`PUT /volunteers/:id`). Verified by re-running the same payment before/after the fix — task creation went from silently throwing to succeeding with `done=0`.

### Peer-to-peer fundraising (2026-07-15)

Built on top of Giving Pages: a supporter can start their own personal fundraiser under any active Giving Page (name, email, goal, story, photo — zero account setup), share their own link/QR code, and every gift through it rolls up live into both their personal total and the parent campaign's total (`gifts.peer_fundraiser_id` always accompanies `gifts.giving_page_id`, never one without the other). New `peer_fundraisers` table, extended `POST /donate/:orgSlug` to accept an optional `peerFundraiserId` (re-derives `givingPageId` from the fundraiser row server-side rather than trusting the client), new public routes for creating/viewing a fundraiser page, and an admin takedown panel in Settings.

No login for fundraisers — a long random `edit_token` (same shape as `invites.token`) is the entire v1 auth model, emailed as a "manage your fundraiser" link. A code-review pass before shipping caught and fixed several real issues before they went live: the token was initially being returned directly in the public creation API response (would have let anyone submit a stranger's name+email and hijack a fundraiser instantly — fixed to only ever leave the server via email), `edit_token` was leaking through the admin fundraiser-list endpoint's `SELECT *` (fixed to an explicit column list), unescaped user input was going into the confirmation email's HTML (added `escapeHtml()`), and `peer_fundraisers` was missing an `org_id` column despite the app's documented org-scoping convention (added it, denormalized from `giving_page_id`).

Full design documented in CLAUDE.md's "Peer-to-peer fundraising" section under Database.

### Home dashboard rework + STAGES recolor to brand palette (2026-07-15)

Direct feedback after the goal-banner layout fix: the greeting was in the wrong place (inside the dark goal card), the page's colors read as "AI slop" (never actually constrained to the app's defined palette), there was no way to edit an already-set fundraising goal, and the page felt like a wall of cold statistics. Fixed all four:
- Greeting moved out of the dark card onto the page's own cream background, between the nav and the goal card.
- Every color on Home locked to the five-color brand palette (dark green shades, cream, gold, white, terracotta) — no red/orange/teal/blue/purple anywhere, including status coloring on hero metrics. New rule documented in CLAUDE.md's "Design system" section.
- Admin-gated pencil/edit control added to the goal card — reuses the existing `POST /goals` create flow rather than adding a `PUT /goals/:id` (a new overlapping goal row already supersedes the old one, since `GET /goals/active` picks the most-recently-created row whose period contains today — the real source of truth was already "create wins," so editing just needed a UI entry point, not new backend logic).
- Hero-card copy rebalanced to read as narrative sentences (a sentence of context with the number as supporting evidence) instead of a bare numeral with a small caption underneath.

Follow-up, same day: recolored the shared `STAGES` array (donor pipeline stage colors) to the same five-color palette, since it was the last blue/purple/amber/red on Home's Pipeline Funnel — this cascaded automatically to the Donor Kanban and Analytics' Pipeline Velocity chart too, since all three read from the one array. Caught and fixed a real bug during this pass: Prospect's new color initially matched the exact hex the Kanban's own column-header background already renders on, making its left-border accent invisible against its own column — reassigned to a different dark-green shade. Also deduped a hand-maintained second copy of the same color palette (`Donors.jsx`'s `STAGE_COLORS`, used by the CSV-import preview) to derive from `STAGES` instead of drifting independently.

### Forgot Password fix — case-insensitive email lookups (2026-07-13)

Root cause of "reset emails aren't arriving": every `users` email lookup (`/auth/login`, `/auth/forgot-password`, plus the existing-email checks in `/auth/register`, `/auth/register-org`, `/auth/invite`, `/auth/invite/accept`) ran `WHERE email = ?` with only the *input* lowercased — a row stored with any uppercase (this bit the founder's own production account) matched nothing. `forgot-password` then hit its own anti-enumeration branch and silently returned `{success:true}` with no email sent; `login` returned a generic "Invalid credentials."

- **`server.js`** — all 6 lookup sites changed to `WHERE lower(email) = lower(btrim(?))`. Every write site (`/auth/register`, `/auth/register-org`, `/auth/invite`) now normalizes via `email.trim().toLowerCase()` before INSERT, consistently through to the JWT payload, response body, Stripe customer creation, and the invite email's `to`.
- **`db.js`** — one-time migration appended to `initSchema()`: pre-checks for case-insensitive duplicate emails (skips + `console.error`s the colliding set rather than crashing boot if any exist), then `UPDATE users SET email = lower(btrim(email))` and `CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uk ON users (lower(email))`.
- **`server.js` `/auth/forgot-password`** — was `await resend.emails.send(...)` with only a `try/catch` around it; Resend returns most real failures (unverified `from`, rejected `to`, API-level rejection) in the resolved object's `error` field, not as a throw, so failures were being swallowed silently. Now captures `{ data, error }` and logs the outcome server-side (`no matching user` / `resend error: ...` / `reset email sent, resend id=...`), plus a `console.warn` if `RESEND_API_KEY` is unset. The anti-enumeration `{success:true}` response is unchanged in all cases — logging is server-side only.
- **`server.js` `/auth/reset-password`** — nice-to-have added: on a successful reset, all of that user's other outstanding unused reset tokens are marked `used` too (not just the one consumed), so an old link left in an inbox can't still work after the password's already been changed.
- **Verified** via a scripted test booting the real `server.js` against a mocked `./db` + mocked `resend` (rate limiters no-op'd for the test run only): forgot-password for a mixed-case-stored user with lowercase input correctly finds the user, creates a token row, and calls `resend.emails.send`; nonexistent email → 200 + no token row + no send attempt; a forced Resend `error` response (not a throw) is now caught and logged instead of swallowed; completing the reset updates `password_hash` (bcrypt-verified), marks the token used, and login then succeeds with yet another case variant of the email; a reused token and an expired token are both rejected with 400. All 16 checks passed.
- **Manual QA checklist** (run against the live Railway/Vercel deploy, not just the scripted mock):
  1. On `/forgot-password`, submit an email in a different case than how it's stored in Supabase (e.g. `Founder@StewardApp.dev` if the row has `founder@stewardapp.dev` or vice versa) — confirm the "Check your email" success screen shows either way, and confirm the email actually lands in the inbox.
  2. Check Railway logs for the request — confirm exactly one of `[forgot-password] reset email sent, resend id=...` / `[forgot-password] resend error: ...` / `[forgot-password] no matching user...` appears, not silence.
  3. Click the reset link, set a new password meeting the 8-char minimum, confirm redirect to `/login` and that the new password logs in successfully (try logging in with a third case variant of the email to double check the fix).
  4. Confirm the *old* password no longer logs in.
  5. Re-click the same (now-used) reset link a second time — confirm it's rejected with "Invalid or expired reset link", not silently accepted.
  6. Request a reset, let it sit, request a second reset for the same account, complete the *first* (older) link — confirm the older token still works (both are valid until used/expired) but after completing it, confirm the second (newer) link is now also rejected (both invalidated by the reset).
  7. Submit `/forgot-password` for an email that has never had an account — confirm the same generic success screen (no enumeration leak).
  8. Spot check `/auth/register`, `/auth/register-org` "email already registered" error, and staff invite (`/auth/invite`) each still correctly detect an existing account regardless of the case used at signup vs. the case used when re-registering/inviting.
- **Production note**: this session's `db.js` migration runs automatically on next boot (Railway restart/redeploy) — no manual SQL needed unless the dupe-guard logs a collision, in which case those specific rows need manual resolution before the unique index will succeed.

### Recurring gift recovery — failed-payment dunning (2026-07-13)
New feature, not a fix: nonprofits lose 20–30% of recurring giving to involuntary churn (expired/declined donor cards) and Steward was previously completely blind to it. Built end-to-end: detection, auto-dunning, donor self-service card update, and staff-facing revenue-at-risk tracking. Full design documented in CLAUDE.md under "Recurring gift recovery" (Database section) — summary here.

- **`db.js`** — `donors.stripe_customer_id`; `orgs.recurring_dunning_enabled`/`recurring_dunning_subject`/`recurring_dunning_body`; new tables `recurring_subscriptions` (health record, one row per donor subscription: status `active`\|`past_due`\|`recovering`\|`recovered`\|`canceled`, failure_count, dunning_step, next_dunning_at) and `payment_recovery_events` (append-only log, `stripe_event_id` is the idempotency key for every webhook handler below). Both added to the `DELETE /admin/orgs/:id` cascade (donor_id FKs, ordered before the `donors` delete).
- **`server.js` `/stripe/webhook`** — four new connected-account event handlers: `invoice.payment_failed` (upserts `past_due`, distinguishes a genuinely new failure cycle from Stripe's own retry of the same invoice so the dunning cadence doesn't reset/spam on every Stripe-internal attempt), `invoice.payment_succeeded` (marks `recovered`, sends a thank-you, doesn't touch gift-recording — that's the pre-existing `payment_intent.succeeded` handler, so no double-record), `customer.subscription.updated` (safety-net sync only, never re-sends the thank-you), `customer.subscription.deleted` (marks `canceled` — the "lost" outcome for recovery-rate math). Also: `checkout.session.completed` (subscription) now captures `stripe_customer_id` and seeds an `active` `recurring_subscriptions` row at creation; a new `mode:"setup"` branch handles the donor's card-update flow completing (attaches the new payment method, calls `stripe.invoices.pay()` immediately so the fix feels instant).
- **Dunning engine** — `processDunning()`, same shape as `processSequences()` (startup + hourly `setInterval`, plus `POST /recurring/process-dunning` admin trigger). Fixed cadence `[0, 3, 7, 14]` days from `first_failed_at` (not from the last send, so it can't drift). Stops after the final step and leaves resolution to Stripe's own retries/eventual cancellation.
- **Donor card-update flow** — `GET /recurring/update-card?token=...`, no login, verified via a signed HMAC token (`signRecoveryToken`/`verifyRecoveryToken`, mirrors the existing unsubscribe-token pattern exactly). Deliberately used Stripe Checkout `mode:"setup"` instead of the Billing Customer Portal, since the Portal needs its own per-connected-account configuration across every org and Checkout setup mode is self-contained. `Donate.jsx` gained a `?card_updated=true` confirmation state, same pattern as the existing `?donated=true`.
- **Staff-facing surface** — home-screen "Needs Your Attention" queue gained a `"Recurring gift failed — $X/mo at risk"` row (priority 85) with a "Resend update link" action (`POST /recurring/:donorId/resend`, requireAuth only — an everyday queue nudge, not admin-gated, matching `POST /note-reminders/:id/send`); a new compact revenue-at-risk card on the Dashboard (`GET /recurring/health`); a status chip (Active/Payment failed/Recovering/Recovered/Canceled) + "Send card-update link" button on `DonorProfile`'s Gifts & Pledges tab (`GET /donors/:id/recurring-subscription`).
- **Recovery tracking** — recovery rate = recovered / (recovered + lost) over a trailing 90-day window from `payment_recovery_events`, snapshotted daily into the existing `metric_snapshots` table (same reusable pattern as `stewardship_debt`/`first_touch_delay`).
- **Verified** via a scripted test booting the real `server.js` against a mocked `./db` + mocked `stripe`/`resend` packages (network calls stubbed, real Stripe webhook-signature crypto kept intact): `invoice.payment_failed` → `past_due` + event logged + dunning queued; a duplicate delivery of the same `stripe_event_id` → confirmed no double-processing; the dunning engine walked forward through all 4 cadence steps and confirmed it stops sending after the last one; `invoice.payment_succeeded` → `recovered` + donor status mirrored + no re-send on a duplicate delivery; a second failure cycle after a prior recovery correctly restarts the cadence at day 0; `customer.subscription.deleted` → `canceled`, and recovery-rate math confirmed correct (1 recovered + 1 lost → 50%). All checks passed.
- **Production action required, not yet done**: the Stripe Connect webhook endpoint needs `invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted` added to its subscribed connected-account event types in the Stripe dashboard — `payment_intent.succeeded`/`checkout.session.completed` already flow today, confirming Connect delivery itself works, but these four are new and this feature does nothing in production until they're added.

### Security sweep, strategic pivot to a retention product, and onboarding rebuild (2026-07-10 – 2026-07-12)

Three back-to-back efforts, in order: (1) a full security audit turned up and fixed 6 org-scoping bugs (4 CRITICAL, 2 lower) plus webhook/rate-limit/Sentry gaps; (2) a strategic pivot away from a proposed donor-facing gamified portal toward a staff-facing retention/stewardship engine, plus the AI chatbot's removal; (3) an onboarding rebuild so new orgs finish setup with real data instead of a blank slate. Commits `f8a226f`..`7e6fb03`.

**Security fixes (2026-07-10, commits `f8a226f`..`f328d55`)** — an audit found and fixed 6 org-scoping/data-isolation bugs, 4 of them CRITICAL:
- **CRITICAL — `server.js` `POST /sequences/:id/enroll` + `GET /sequences/:id/enrollments`**: never verified `donorId` belonged to the caller's org before enrolling; the enrollments read then JOINed to `donors` with no org filter, leaking another org's donor name/email. Fixed both sides (write-side org check + read-side JOIN filter).
- **CRITICAL — `server.js` `/billing/webhook`**: registered *after* the global `express.json()` middleware, so its own `express.raw()` was a silent no-op — every real Stripe billing webhook (`checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`) had been rejected with 400 for however long this persisted, meaning `subscription_status`/`plan`/`grace_until` stopped syncing from Stripe automatically in production. Fail-closed (nothing fake got accepted), but needs manual reconciliation against the Stripe dashboard for any org whose billing status looks stale. Fixed by relocating the handler before the global JSON parser, alongside `/stripe/webhook` and `/resend/webhook`.
- **CRITICAL — `server.js` `PUT /events/:id`**: UPDATE was org-scoped but never checked affected-row-count, and the follow-up SELECT that builds the response had no org filter — a guessed event ID from another org returned that org's full event record. Fixed: 404 on zero affected rows, plus org-scoped the re-fetch.
- **CRITICAL — `server.js` `POST /donors/:id/custom-fields` + `GET /donors/:id/custom-fields`**: write never verified the donor belonged to the caller's org; read-side JOIN had no `org_id` filter either, so a planted cross-org value would render in the victim org's own donor profile. Fixed both sides.
- **`server.js` `POST /gmail/send`** (GAP): accepted `donorId` from the request body with no org check, and `GET /donors/:id`'s interactions query was the only interactions read in the codebase with no `org_id` filter — combined, a sender could plant an interaction with attacker-controlled text into a different org's donor timeline. Fixed both the write-side ownership check and the read-side scoping.
- **`server.js` `POST/DELETE /programs/:id/grants` + `GET /programs`** (GAP): link route never verified `grantId` belonged to the caller's org; the JOIN in `GET /programs` had no org filter; delete had no org check at all. Fixed all three.
- **`server.js` `POST /billing/create-checkout`, `POST /billing/create-portal`, `PATCH /orgs/:id`** (GAP): `requireAuth`-only, letting any staff-level user open the Stripe portal or edit org settings. Added `requireAdmin`, matching every other billing/org-settings route.
- **`server.js` `POST /donors/:id/materials`** (GAP): no server-side size/MIME validation — the "base64 <1MB" convention was client-only. Also closed a latent stored-XSS path: `file_type` was stored verbatim and the frontend's `viewMaterial()` opens it as a `Blob` with that MIME type — only inert today because the read routes happen to exclude `file_data`, an accidental protection that a future "fix" to the unrelated "View does nothing" bug could silently undo. Added a MIME allowlist (rejects `text/html`/`image/svg+xml` and anything else) and a real server-side size check, closing the gap at the point untrusted data enters rather than relying on the accident downstream.
- All 8 fixes verified via scripted tests booting the real `server.js` against a mocked store — cross-org attempts confirmed rejected (404) and confirmed to plant no data; legitimate same-org operations confirmed still working.
- **`server.js`** — `app.set("trust proxy", 1)` (correct client IP behind Railway's single edge hop) + `express-rate-limit` on `/auth/login` (stacked per-IP + per-account+IP), `/auth/register`, `/auth/register-org`, `/auth/forgot-password`, `/auth/reset-password`, `/donate/:orgSlug`, plus a loose global baseline (excludes `/health` and webhooks). CORS_ORIGIN now defaults to a known-origin allowlist instead of `"*"` when unset (fail-closed).
- **`server.js`** — CORS hotfix, two rounds: the fail-closed default above initially omitted `www.stewardapp.dev` (`c865ece`, production outage), then a deeper bug was found — the original logic let `CORS_ORIGIN` fully *replace* the default allowlist rather than add to it, so whatever value Railway had it set to was silently locking out all three real production origins (`9e6f4e1`, second production outage same day). Fixed so `CORS_ORIGIN` can only add extra origins, never remove the baseline production list.
- **`server.js`, `client/src/main.jsx`, `vite.config.js`** — Sentry gaps closed: `process.on("uncaughtException"/"unhandledRejection")` added right after `Sentry.init()` as a backstop for background jobs (Gmail sync, `processSequences`, `checkTrialExpiry`) that never flow through Express's error handler; `@sentry/vite-plugin` added for client source-map upload at build time, gated on `SENTRY_AUTH_TOKEN` so an untokened build generates no maps at all rather than generating-then-stripping them. New env vars: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (plus previously-undocumented `SENTRY_DSN`/`VITE_SENTRY_DSN`).
- **`server.js`, `db.js`** — new email suppression system: `email_suppressions` table (org-scoped for donor unsubscribes, global `org_id=null` for bounces/complaints, protecting the shared `stewardapp.dev` sending domain's reputation across all orgs); signed HMAC no-login unsubscribe tokens (`GET /unsubscribe` confirmation page, `POST /unsubscribe` supports RFC 8058 one-click); every campaign/sequence email now carries a real unsubscribe link + `List-Unsubscribe`/`List-Unsubscribe-Post: One-Click` headers; `POST /resend/webhook` verifies Resend's Svix-signed payloads and suppresses globally on bounce/complaint; suppression flips matching `sequence_enrollments` to `unsubscribed`/`bounced`.

**Favicon fix (2026-07-10, `favicon.svg` + regenerated icon set, `index.html`, `sw.js`)** — the shipped favicon didn't match the actual in-app header brand mark (App.jsx's 40×40 dark-green rounded badge, cream serif "S", gold underline bar) — regenerated the full icon set from the real header SVG as the single source of truth. Same day, per direct feedback, simplified further: dropped the gold underline bar entirely (read as cluttered at actual favicon size), keeping just the badge + "S".

**Landing page rewrite (2026-07-10, `client/src/pages/Landing.jsx`)** — honest repositioning: fake testimonials removed, a "Where Steward Is Today" section added, a real product screenshot replaces a mockup.

**Strategic pivot (2026-07-11, `client/src/App.jsx`, `client/src/components/Dashboard.jsx`)** — per direct product feedback, decided against a proposed donor-facing gamified "Lifetime Impact Dashboard" (donor login, tiers, badges) — nonprofit-experienced feedback was that donor-visible tiers/badges/leaderboards feel toxic to donor trust, not warm. Refocused the product around Donors + Grants + Communications instead, hiding Events/Volunteers/Board/Analytics/Tasks/Finance from the nav (UI-visibility only — confirmed zero backend/db changes, all six component files stayed fully imported and intact). `TABS`/`BOTTOM_TABS`/`MORE_TABS` entries commented out with a `DEPRIORITIZED` marker. Dashboard.jsx: removed volunteer/task-derived state and widgets that depended on now-hidden modules, added a "Lapsed Donors" stat card in their place. Landing's Features section swapped its Finance & Reporting card for a Gmail-sync card (`98a1a45`) to match what's actually reachable. AI chat's greeting/suggestion-chip copy updated to stop referencing hidden modules (`5e564be`) — this was a stopgap fixed properly the next day when the chat surface itself was removed (see below).

**Retention & stewardship engine (2026-07-11 – 2026-07-12, `server.js`, `db.js`, `client/src/components/Communications.jsx`, `Settings.jsx`, `Donors.jsx`)** — the staff-facing system built in place of the rejected donor portal: the app notices patterns in donor data and drafts or suggests, a human always reviews and sends.
- **Milestone & anniversary detection** (`a1e3215`) — new `impact_metrics` table (org-configured "at this amount, here's what it funded" copy) and `milestone_drafts` table (AI-drafted emails awaiting staff review, never auto-sent). `computeMilestoneCandidates()` detects fixed-checkpoint crossings ($500/$1k/$2.5k/$5k/$10k) and 6-month/yearly giving anniversaries. `generateMilestoneDraft()` calls claude-sonnet-4-6 with the `{amount}`/`{n}` math pre-computed in JS (not left for the model), and a system prompt that explicitly bans "tier"/"level up"/"unlock"/"badge"/"leaderboard" language. Deliberately draft-and-review, not auto-send — matches the existing human-in-the-loop pattern (AI daily briefing informs, staff acts). New "Milestone Drafts" tab in Communications.
- **Impact Metrics admin panel** (`b5f8537`) — create/edit/delete UI in Settings.jsx, mirroring the existing Custom Fields pattern (impact_metrics had shipped with API-only management the day before).
- **Per-donor Impact Summary PDF** (`4376839`, plus two bugfixes `fac46d4`/`6159672`) — `GET /donors/:id/impact-summary/pdf`, reusing the Board Report's pdfkit pattern. Found live: footer text drawn at `y = page.height - 28` sat below pdfkit's default `maxY`, silently triggering an extra page break per footer `.text()` call — the PDF spilled onto 3 pages instead of 1. Fixed with an explicit `height` option on the footer text calls; the identical latent bug was then proactively fixed in the older Board Report PDF too.
- **AI chatbot removed, AI labels de-branded** (`208f121`) — the global "Ask AI" chat overlay (`AIChat` in Dashboard.jsx) and its header button deleted outright, not hidden — the underlying `askClaude`/`streamAI` infrastructure and every specific AI feature built on it (milestone drafting, LOI drafting, forecasting, wealth scoring) is untouched, only the general-purpose chat surface is gone. Every visible "AI"-branded label across Grants/Donors/Tasks/AnnualFund/Communications/Board/Settings renamed to describe function instead of mechanism (`AIBtn` default "AI Assist" → "Suggest", `AIPanel` badge "AI Intelligence" → "Suggested", "AI Forecast" → "Forecast", "AI Prioritize" → "Prioritize", "Draft with AI" → "Draft this email", etc.). Public Landing/Pricing marketing copy and the Privacy Policy's AI disclosures deliberately left untouched (legal/marketing decisions, out of scope).
- **Personal-note reminders** (`bf74ac2`) — new `note_reminders` table, the non-AI-drafted sibling of milestone drafts. `computeNoteTalkingPoints()` pulls 3 real facts straight from the donor record (no LLM call in this path). Split logic (`isNoteMoment()`): the two highest thresholds ($10k/$5k) and every anniversary get a "write a personal note" nudge; smaller/routine crossings keep the AI-drafted-email flow — reasoning that a $10k+ gift or multi-year anniversary earns a genuinely handwritten note, while frequent routine crossings are better served by an efficient, already-reviewed drafted email.
- **Voice memo capture** (`0978958`) — `POST /voice-memos/transcribe` (Whisper transcription + one narrow Claude extraction pass, saves nothing) / `POST /voice-memos/save` (the only write). Chose OpenAI Whisper over the free Web Speech API specifically for iOS Safari accuracy, confirmed with the user before adding the new dependency. `OPENAI_API_KEY` was never actually added to Railway, so this was never tested end-to-end against the real Whisper API even before being shelved the same day (see "Voice memo capture shelved" below).
- **Stewardship Debt / First-Touch Delay headline metrics** (`444095a`, seed-trend fixes `40552ea`/`529b7c5`) — new generic `metric_snapshots` table (reusable daily-snapshot store, not a bespoke table per metric — the design pattern is now documented in CLAUDE.md's "Product design patterns" section). `computeStewardshipDebt()`: sums (days since last meaningful contact ÷ 30) × (total giving ÷ 1000) across the donor portfolio, "meaningful contact" deliberately excluding gifts/notes/stage-changes/email-opens. `computeFirstTouchDelay()`: average days between first gift and first meaningful touch. Both computed live on every call, never served stale-only. The synthetic 21-day seed trend was initially off by >40x from the real computed value for the demo org (arbitrary illustrative baseline vs. the org's actual ~50 mostly-imported donors) — fixed by deriving the seed baseline from the same formula against real seeded data.

**Action-queue-first home screen (2026-07-12, `server.js`, `client/src/components/Dashboard.jsx`, `Donors.jsx`, `Grants.jsx`, `Communications.jsx`)** — replaced the old stat-card Dashboard entirely.
- Backend (`0d041c9`): `GET /dashboard/today` extended to fold milestone-ready donors into the same ranked queue as lapsed/no-contact/overdue-task items; new `fundraising_goals` table + `GET /goals/active` (computes real progress — `lapsed_recovery` reconstructs "recovered from lapsed" gifts from >365-day gaps in gift history) + `POST /goals`; new `GET /donors/stage-counts` for the funnel panel. Two dedup bugs found and fixed the same day: milestone-ready items (`c8a3b1d`) and lapsed donors as a bucket (`8bb948a`) were both losing a skip-if-claimed race against lower-priority queue reasons — replaced with a shared `upsertItem()` that keeps whichever reason has the higher priority everywhere, not just where it was first noticed.
- Frontend (`5ca26c4`): goal banner, ranked "Needs Your Attention" queue with one real action per row (no placeholders), pipeline funnel with lapsed called out as "leaking out," compact next-grant-deadline tile. Consolidated the two competing home screens (`/today` route and the AppShell "dashboard" tab) into one — `/today` now redirects to `/dashboard`, `TodayPage.jsx` left on disk but unrouted. Deep-link plumbing added across Donors.jsx (`initialView`/`initialLogDonorId`/`initialStageFilter`), Grants.jsx (`initialGrantId`), and Communications.jsx (`highlightDraftId`).
- Two live-testing bugs fixed (`f078aef`): "Next Grant Deadline" had no lower bound and was losing to a 13-month-overdue stale-seed grant; queue's "Mark done" button wasn't checking `isReadOnly` like every other write action (found because the live demo org was trial-expired at the time).
- Mobile polish (`cb899b8`): queue row action buttons were squeezing donor name/reason text unreadably narrow — `flex-basis:100%` drops them to their own line.
- Also fixed same day: Dashboard's Recent Activity feed was permanently empty (`17b2410`) — `GET /donors` never embedded interactions (`adaptData()` hardcoded `donors[].interactions` to `[]`), and Dashboard read from that always-empty field; new `GET /dashboard/recent-activity` route added and pointed at directly instead.
- An earlier same-day pass (`9f7fb62`) had already added a "Milestones Ready" stat card with a deep-link into the Milestone Drafts queue and richer seed data — superseded within hours by the full action-queue rebuild above, but the seed-data richening (9 donors filling previously-empty pipeline stages, near-future grant deadlines, seeded milestone drafts) carried forward.

**Voice memo capture shelved (2026-07-12, `client/src/App.jsx`, `Donors.jsx`)** — hidden from the UI (header button, donor-profile entry point) with `// SHELVED — ...` comments, as an unproven-adoption-assumption bet rather than a broken feature — `OPENAI_API_KEY` was never added to Railway, so it was never live end-to-end regardless. Backend routes, Whisper integration, and extraction logic all left fully intact.

**Admin data integrity tooling (2026-07-12, `server.js`)** — prompted by manually deleting test-user rows directly in Supabase's Table Editor. `DELETE /admin/orgs/:id`'s cascade was found incomplete (missing `milestone_drafts`/`note_reminders`/`donor_materials`/`planned_gifts`/`board_reports`/`fundraising_goals`/`impact_metrics`/`metric_snapshots`/`email_suppressions`) and fixed. New `GET /admin/data-integrity` (reports orphaned orgs + dangling user-ID FK references, changes nothing) and `POST /admin/data-integrity/fix` (nulls dangling refs only, never deletes org/donor data). **Not yet run against production** — see "OTHER PENDING" above.

**Onboarding mismatch fixes (2026-07-12, `client/src/App.jsx`, `WelcomePage.jsx`, `PROGRESS.md`)** — the earlier pivot and AI-chat removal left dead references: `data-tour="nav-finance"`/`"ask-ai"` attributes pointing at nav items that no longer exist (removed — investigation found no `GuidedTour`/`OnboardingWizard` component actually exists in the codebase at all; it was built and deleted the same day, 2026-06-07, per `git show b9fcf7a`, and this PROGRESS.md's own entry documenting the build was never updated for the removal until now), and WelcomePage's focus-selection step still offered "Financial Management" as an option despite Finance being hidden (removed; confirmed the field was pure UI copy with zero server-side effect).

**Onboarding rebuild to finish with real data (2026-07-12, `client/src/pages/WelcomePage.jsx`, `client/src/components/Donors.jsx`, `server.js`)** — replaced the 3-step blank-slate flow with a 5-step flow that finishes with real donor data, a real goal, and a real impact metric, since the new action-queue home screen shows nothing valuable without them. Steps: org basics (`PATCH /orgs/:id`, extended to accept `name`) → import donors (embeds the real `DonorImport`, now exported from Donors.jsx, as the centerpiece; only skippable step) → set first goal (pre-filled from real imported data — lapsed-recovery suggestion if lapsed donors exist, else total-raised) → first impact metric (pre-filled template, guided) → finish (`POST /onboarding/complete` moved to the END of the flow, deliberately, so a user who drops off mid-flow on a non-skippable step doesn't land on a half-set-up `/dashboard` next login). Live-tested end to end with a real CSV import (goal suggestion, queue, funnel all confirmed populated with real data) and the skip-import path (confirmed the good empty states show, not broken ones). Bug found live and fixed: the mount-effect redirecting an already-onboarded org to `/dashboard` was watching `[auth]` instead of `[]`, so it re-fired reactively when the finish step's `refreshOrg()` call updated auth context mid-flow, skipping the "ready" screen (and its conditional sample-data button) entirely before it ever rendered — the same latent bug existed in the old 3-step flow too, just invisibly, since both of its final-step buttons already led to `/dashboard` anyway.

### Auth, Gmail, billing/Reactivate, and QA-sweep fixes (2026-07-09 – 2026-07-10)

Prompted by a live incident (401s on every authenticated route) plus a full pre-launch QA sweep (Playwright, desktop + mobile) that found 3 blocking and 3 cosmetic bugs. Commits `4a9e406`..`d6823e6`.

**auth.js / client/src/api.js / client/src/pages/LoginPage.jsx** — 401 dead-end fix
- `requireAuth` now distinguishes `jwt.verify` failure modes: `{error:"token_expired"}` (TokenExpiredError), `{error:"invalid_token"}` (bad signature/malformed), `{error:"no_token"}` (missing header) — was one generic "Invalid token"/"No token provided"
- `apiFetch`/`streamAI` (api.js) detect any of these (plus the legacy message strings) on a 401, clear `npe_token`/`npe_user`/`npe_org`, and redirect to `/login` with a "session expired" message — instead of a dead-end "Failed to connect / Retry" screen that could never succeed on a bad token
- Root cause of the actual incident: an out-of-band `JWT_SECRET` rotation on Railway invalidated every issued token — not a bug in the sign/verify code, which was already internally consistent. This fix is about graceful recovery from that class of event, not a signing/verification correctness fix.

**server.js — syncGmail()** — Gmail sync retry-forever fix
- Now also catches `invalid_grant` (revoked/expired Google refresh token, thrown as HTTP 400 by google-auth-library at the token-refresh step — NOT a 401) in addition to a genuine 401, and marks the connection `status='disconnected'`
- `syncAllGmail()`'s `WHERE status='active'` query then excludes it from all future runs — previously `invalid_grant` fell through uncaught and retried every 15 minutes forever

**server.js — ensureStripeCustomer(orgId, email)** (new helper) + `POST /billing/create-checkout` / `POST /billing/create-portal`
- Both routes call this first instead of reading `stripe_customer_id` directly — an org with a null `stripe_customer_id` (legacy `/auth/register` signup, or a failed inline creation in `/auth/register-org`) gets a Stripe customer created transparently instead of the routes throwing "No Stripe customer linked to this org"

**client/src/components/PlanPicker.jsx** (new) + App.jsx — Reactivate now opens a plan picker, not the Portal
- New modal: Seed/Growth/Impact plan cards, pulling plan data from `pages/Pricing.jsx` (single source of truth, no duplicated pricing)
- "Reactivate" (read_only banner, canceled/warning banner) and "Choose a plan"/"Upgrade now" (trial banner) now open `PlanPicker` → `POST /billing/create-checkout`, instead of the Stripe Customer Portal (which just showed empty payment-method/invoice states for an org with no subscription yet)
- Portal access preserved where it's actually correct: "Update payment" (past_due banner) and Settings' "Manage billing" (orgs with an active subscription)

**client/src/App.jsx — Export data button**
- Banner's "Export data" button was a no-op (`onClick={()=>setTab("settings")}` — just switched tabs). Now calls the existing `GET /org/export` route directly and downloads a real JSON file (donors/gifts/grants/transactions) via the same blob+anchor pattern already used in Settings.jsx

**client/src/components/shared.jsx (GlobalStyles) / client/src/pages/SignupPage.jsx** — mobile signup overflow fix
- SignupPage's two-column layout had a hardcoded `minWidth:280` left panel + fixed px padding with zero `@media` rules — the math went negative below ~700-750px viewport width, so the form overflowed off-screen with clipped text. Added `@media(max-width:768px)` rules to `GlobalStyles()` (the established single CSS home for this breakpoint) to stack to single-column on mobile.

**server.js — checkWriteAccess** — expanded from 7 routes to 24
- Previously only guarded `POST/PUT /donors*` (5 routes incl. import) and `POST/PUT /grants` (2 routes)
- Now also applied to Volunteers (`POST/PUT`), Tasks (`POST/PUT`), Events incl. attendees (`POST/PUT/PATCH`, plus `/events/:id/follow-up` which inserts tasks directly and would otherwise have bypassed the Tasks gate), Campaigns incl. briefing/send (`POST/PUT`), Board (`POST`), Custom Fields (`POST/PUT/reorder`) — full route list in CLAUDE.md's SaaS billing section
- Matching frontend create/add buttons (12 total, across Dashboard Quick Actions, Grants Kanban + List, Communications, Events, Tasks, Volunteers, Board, Settings) now disable with the same tooltip pattern already used in Donors/Grants when `isReadOnly`. Two were simple pre-existing bugs, not new wiring: Dashboard's "Add Volunteer"/"New Task" Quick Actions were just missing the `isWrite:true` flag other Quick Actions had, and Grants Kanban's own "+ Add Grant" button (distinct from List view's) had no `isReadOnly` check at all.

**client/src/components/Finance.jsx — Overview tab data-source fix**
- Overview's Fund Balances card and Monthly Breakdown chart read `data.financials.funds`/`.revenue`/`.expenses` — a prop from the legacy `GET /financials` endpoint (old `financials`+`funds` tables) — while every other Finance subtab (Transactions/Accounts/Funds/Budgets/Reports) reads the newer `/finance/*` endpoints (`fin_transactions`/`fin_funds`/`fin_accounts`/`fin_budgets`). For CREO Arts the legacy tables still held old seeded balances while the live `fin_*` tables were genuinely empty — Overview showed real-looking numbers ($42k/$35k/$25k/$8.2k) that directly contradicted $0 shown one click away for the same funds.
- Fix: Overview (and the 6-Month Forecast / Risk Analysis AI prompts) now derive from the same `fundBalances` (computed client-side: income − expense per fund from live `funds`+`transactions` state) and `summary.ytdRevenue`/`ytdExpenses` already used by the rest of the module. See CLAUDE.md's "Finance tables" section for the legacy-vs-live table note.

**client/src/components/Donors.jsx / Grants.jsx — profile view layout fix**
- `{selected && <Profile/>}` rendered the donor/grant profile *alongside* the toolbar/list rather than replacing it — both were in the DOM at once, so scrolling down while a profile was open revealed the full list again below it. Changed to `{selected ? <Profile/> : <List/>}` in both files.

**client/src/components/Grants.jsx — Kanban card click handler**
- Kanban cards (the default Grants view) only had `draggable`/`onDragStart`/`onDragEnd` for reordering between pipeline stages — no way to open a grant's profile without knowing to switch to List view. Added `onClick={()=>onSelectGrant(g)}` alongside the existing drag handlers; no custom click-vs-drag threshold logic needed since native HTML5 drag-and-drop already distinguishes the two at the browser level (dragstart only fires past the browser's own movement threshold; a press-release that doesn't cross it fires a normal click and never fires dragstart).

**client/src/components/Settings.jsx — billing status badge fix**
- The plan/status badge's ternary chain (`active ? "Active" : past_due ? "Past Due" : cancelled ? "Cancelled" : "Trialing"`) had no branch for `trial_expired`, so an org whose trial had actually ended still showed "Trialing" — directly under a banner reading "Your free trial has ended" on the same page. Replaced with a `BILLING_STATUS_META` lookup covering `active/trialing/past_due/trial_expired/canceled/cancelled` (both spellings).

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

> **Superseded (2026-06-07, later same day, commit b9fcf7a "Kill guided
> tour...")**: OnboardingWizard.jsx (the GuidedTour described above) was
> deleted entirely. There is currently no post-onboarding tour of any kind —
> this section was never updated to reflect that and caused confusion in a
> later session, which found the 5 `data-tour` attributes still scattered
> across App.jsx with no tour engine left to consume them (now removed).
> If a guided tour is wanted again, it needs to be rebuilt from scratch
> against the current nav (Home/Donors/Grants/Communications/Settings), not
> restored from this entry — Finance/Analytics/Ask AI (all referenced above)
> are hidden or removed from the product surface as of today.

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
- ~~Today flow~~ (superseded 2026-07-12 by the action-queue home screen; `/today` now redirects to `/dashboard`, `TodayPage.jsx` deleted 2026-07-16)
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
- ~~Analytics — 7 charts~~ (deleted 2026-07-16, BUILD-04 Strike 2 — was hidden by the pivot, now removed outright)
- Settings — Stripe Connect, QR code, embed widget, team management, invite staff, custom fields, demo data loader
- Public donation page (/give/:orgSlug) — Stripe Checkout, recurring gifts
- SaaS billing — trial → seed/growth/impact; 4-state access model; Stripe webhooks
- Admin dashboard — super admin only; org list, impersonation, metrics
- Gmail integration — OAuth connect, inbound sync, send from donor profile
- PWA — service worker, offline-capable
- Password reset, terms, privacy pages
