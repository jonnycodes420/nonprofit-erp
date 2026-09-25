# Mail and notifications

Read this when you touch anything that sends email: Resend, `donorMailDecision`, the mail block, appeals, bulk mail, sequences, notifications, digests, email links, Gmail or calendar links.

## Rules
- **Decide every donor-facing send through `donorMailDecision(kind, email, orgId)`, and add a new kind to
  `DONOR_MAIL_POLICY` before it can send.** An unclassified kind fails closed; `getSuppressionReason` may be
  called only from there (source-scan pinned in `tests/mail-suppression.test.js`). (BUILD-58)
- **Transactional mail ignores the marketing opt-out but never deliverability.** Receipts, year-end,
  dunning, recovered thank-you, recurring changes and card-expiring skip `email_suppressions` opt-outs and
  still honour bounced/complained, `email_unreachable` and `deceased`. (BUILD-58, BUILD-94)
- **Refuse `is_sample` donors, demo orgs and mail-off orgs for every kind, above the transactional split.**
  `orgMaySendEmail` reads `orgs.emails_enabled` + `is_demo_org`, fails closed, and is asked by
  `donorMailDecision`, the digests and the onboarding drip. (INCIDENT 2026-09-22)
- **Send only through the wrapped `resend` client in server.js and never construct another.** Its Proxy logs
  every `emails.send` to `email_log` (recipient DOMAIN only, never the address) and applies the permanent
  block; `opsAlert` and `routes/migc.js` are the known raw sends and check the block themselves. (BUILD-97)
- **Build org-scoped send options with `donorSendOpts` (or set `_stewardOrgId`/`_stewardKind`).** That tag is
  how the proxy attributes the send and refuses it when the org's mail is off. (BUILD-97)
- **Seed scripts create orgs with `emails_enabled=false, is_demo_org=true` and seed addresses only at
  `*.example.com`.** script-guards enforces it; `/admin/orgs/:id/email-switch` refuses to enable a demo org. (INCIDENT)
- **A `provisioned: true` registration is born with mail off and gets no onboarding-sequence row at all.**
  A dormant enrolment fires the day mail comes back on. (INCIDENT)
- **Take From, Reply-To and List-Unsubscribe from `orgSendingIdentity(orgId)` only.** Unverified: Steward's
  domain, the org's display name, a Reply-To that reaches a human. A domain belongs to one org (global unique
  index). (BUILD-88c)
- **Any emailed link that changes state renders a confirm page on GET and acts on POST.** Link scanners
  prefetch; `/unsubscribe` names the org on GET, and the RFC 8058 one-click POST gets a bare 200. (BUILD-94, BUILD-90)
- **Write an unsubscribe to `email_suppressions` as well as `do_not_email`, imports included.** The decision
  reads suppressions; a Mailchimp unsubscribed contact imports as unsubscribed, never reachable. (BUILD-94)
- **A hard bounce sets `email_unreachable` with date and reason; a complaint unsubscribes; both write a
  timeline line.** (BUILD-94)
- **Map a Resend webhook event to an org only by the From address matching exactly one verified sending
  domain, never by payload fields.** Global suppression still applies; `email.opened` stays unsubscribed. (BUILD-94)
- **No postal address, no marketing send: refuse it, do not warn.** Scheduled campaigns go back to draft and
  sequences HOLD without consuming a step; this supersedes the older "footer degrades, never blocks" note. (BUILD-94)
- **An empty explicit segment is zero recipients, in preview and send.** `resolveCampaignRecipients` must
  never fall through to everyone; "All Donors" filters to donors and only "Everyone with an email" crosses
  person types. (BUILD-88c, BUILD-94)
- **A campaign writes exactly one email interaction per recipient (`metadata.via="campaign"`); "Send me a
  test" goes only to the caller and writes no recipient row or interaction.** (BUILD-88c)
- **Render the composer preview with the send's own renderer for a real named recipient, and take the merge
  chips from the renderer's list.** An offered token the renderer lacks ships braces to donors. (BUILD-88c)
- **Report delivered, opened and unsubscribed as counts only, never per person.** Per-person opens is a
  data-handling and customer-agreement change, not a switch. (BUILD-94)
- **Convert a scheduled `datetime-local` with `orgTime.localToInstant`, never straight into timestamptz.**
  (BUILD-94)
- **Sequences: she wrote every word, she turned it on, each send is hers, and no model is on the send path.**
  `/sequences/tracked/:id/turn-on` refuses a super-admin; turn-on is audited and every send's timeline line
  quotes it. (BUILD-94)
- **Sequence enrolment comes only from its closed trigger set and is never retroactive; first-gift fires
  inside `recordGift` after the rollup.** A logged conversation is not a stop. (BUILD-94)
- **Sequences send only in the weekday-morning window of a human-confirmed org timezone.** `validateSequence`
  refuses unknown merge tokens at save and a last track that is not "Everyone else". (BUILD-94)
- **Reserve the idempotency row BEFORE the provider call.** `workflow_runs`, `digest_sends`,
  `notification_sends`, `sequence_sends` are each UNIQUE-keyed; ride the existing 5-min tick, never a second
  scheduler. (BUILD-13, BUILD-17, BUILD-36, BUILD-94)
- **On a real provider failure, release the reservation and queue the send in `notification_failures`.** Send
  helpers return real success; `retryFailedNotifications` retries and `/health` surfaces the count. (BUILD-44)
- **Log a send (`dunning_sent`, a sequence advance, `sent:true`) and stamp any "once" flag only after real
  delivery.** An outage must retry, not eat the only warning. (BUILD-58, BUILD-90)
- **Staff mail (digests, gift alerts, task notices) carries `brandEmailHeaderHtml` and no unsubscribe footer;
  donor marketing carries both.** An all-zero digest shows a nudge or is suppressed, period still reserved. (BUILD-35, BUILD-36)
- **One email per person per event: `notifyUserOnce` keys on (org, event_key, recipient) without channel;
  an opted-out pref reserves nothing.** (BUILD-36)
- **Pass every org or person name entering mail through `displayNameCase`; donor mail names the org via
  `donorFacingOrgName`.** (BUILD-35, BUILD-58)
- **Build every emailed link from `publicAppUrl()`; server.js never reads `FRONTEND_URL` or a request host.**
  Backend links (unsubscribe, card update) ride vercel.json proxies declared before the SPA catch-all. (FIX 2026-08-04)
- **Calendar links: one builder for Outlook, Google and `.ics`; UID `steward-<org>-<task>@stewardapp.dev`
  forever; no time means all-day.** No sync and no OAuth, and `NOT_SYNC_NOTE` stays in the menu. (BUILD-94)
- **BCC logging stays off behind `INBOUND_EMAIL_ENABLED` (404 off, 503 with no secret).** The org is the
  plus-address only, the sender must be an org user, inbound never creates a donor; no provider is chosen. (BUILD-87)

## Gotchas
- **The Resend SDK silently drops `reply_to`.** Pass `replyTo`. (BUILD-88c)
- **Wrapping the Resend client in an object literal deleted `resend.domains`.** Use a Proxy that overrides
  only `emails.send`. (BUILD-97)
- **The per-recipient org gate made bulk sends slow enough to expose a race.** Keep the 5s
  `orgMailGateCache`; the switch route clears it. (INCIDENT)
- **`grep -r` skipped a fixture as binary and called 440 real addresses clean.** For a safety sweep, read the
  bytes in Node. (INCIDENT)
- **Mail suites need the server booted with `RESEND_BASE_URL=http://localhost:5602`.** The local key is a
  dummy, so a real-phone send is Jonathan's step. (BUILD-25, BUILD-88c)
- **A captured email measured at 390px needs a `width=device-width` viewport injected.** A bare email
  document lays out at 980px. (BUILD-88c)
- **Clock-dependent sequence suites pass or fail by the hour.** Pin `now` on `/sequences/tracked/run`
  (TEST_MODE only). (BUILD-94)
- **`POST /workflows/simulate` without `dedupKey` mints a new event.** Pass the real key to test idempotency.
  (BUILD-35)

## Where the code is
- `resend` Proxy + `_logOutboundEmail` (server.js top) — every send, logged to `email_log`
- `donorMailDecision` / `DONOR_MAIL_POLICY` / `orgMaySendEmail` — the one send decision and the org gate
- `donorSendOpts` / `orgSendingIdentity` / `sendingDomainPayload` — sender identity and its sentence
- `/unsubscribe` (GET page, POST action), `/resend/webhook` — opt-outs, bounces, complaints
- `publicUrl.js` `publicAppUrl()` — the only base for emailed links
- `shared/sequenceShape.js`, `shared/emailTemplates.js`, `shared/calendarLinks.js`, `shared/inboundEmail.js`
- `notifyUserOnce`, `retryFailedNotifications`, `reserveDigest`, `sendDigestEmail`, `sendWorkflowEmail`

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## THE PERMANENT MAIL BLOCK (2026-09-24) — Jonathan's list, nobody else edits it
`mailBlock.js` holds addresses Steward must never email, from any org, for any reason: **`hello@justinsplaceky.com`**. It is checked at **the Resend client proxy** in server.js (every send in that file passes through it, including ones written later; a blocked send returns a provider-style error, is logged to `email_log` as `blocked`, and never reaches Resend), in **`donorMailDecision`** (first, above the org switch), in **`opsAlert`** (the one raw-client send) and in **routes/migc.js** (its own client). `tests/mail-block.test.js` (19) plants an invite and a donor receipt to the address, asserts nothing reaches the sink while a control invite does, and pins the entry by name; it is proven able to fail with the proxy check planted off, and its receipt leg proves the donor gate independently. **Remove an address only on Jonathan's word, and in both files.**

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

## Database tables (moved from the old "Database — key tables and columns")

### Email campaigns
- email_campaigns — id, org_id, name, subject, body, audience, status, sent_at, open_count
- email_opens — id, campaign_id, opened_at, donor_id (nullable)
- **CAN-SPAM footer (2026-07-17)**: `unsubscribeEmailFooterHtml(email, orgId, source)` is **async** — it looks up the org's `legal_name`/`name` + `receipt_address` (the tax-receipt settings address) itself and renders an HTML-escaped "Legal Name · address" line above the unsubscribe link; every call site (campaigns, sequences, milestone drafts, dunning, recovery thank-you, pledge reminders, onboarding drip) `await`s it. No `receipt_address` → unsubscribe-only footer (sends are never blocked), and Communications.jsx shows an "Add your mailing address" prompt (checks `GET /me`; admins get an `onNavigate("settings")` button — App.jsx now passes `onNavigate` to Communications) until it's set.

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
- Sequences subtab in Communications.jsx section tabs (after Analytics)
- `SequencesPanel` and `SeqStep` are module-level components (before `export function Communications`)
- DonorProfile (Donors.jsx) has inline enroll dropdown — `sequences` prop passed from `Donors` component which fetches `GET /sequences` on mount

### Route ordering note
`POST /sequences/process` is declared BEFORE `GET /sequences/:id` routes to prevent Express matching "process" as an :id param
