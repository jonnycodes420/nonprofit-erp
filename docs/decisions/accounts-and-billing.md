# Accounts and billing

Read this when you touch sign-in, signup, onboarding, invites, roles, super admin, Settings, or platform billing (plans, prices, the close link, the trial).

## Rules
- **Keep platform billing and donation Stripe apart.** `billingStripe` (`STRIPE_BILLING_SECRET_KEY`, falls
  back) serves checkout/portal/`/billing/webhook`. `stripe` (`STRIPE_SECRET_KEY` only) serves Connect and
  donations. Never cross-wire them. (BUILD-24)
- **Store the platform customer per Stripe mode:** `stripe_customer_id` (live) and `stripe_customer_id_test`.
  `ensureStripeCustomer` touches only the current mode's column and self-heals a missing customer.
  (BUILD-24)
- **Reserve the event id in `billing_webhook_events` before any org mutation.** Ignore non-subscription
  events without reserving a row. (BUILD-24)
- **Derive the plan from the live price (`planFromSubscription` in billingPlans.js).** Use `metadata.plan`
  only as the fallback, because a Portal switch leaves it stale. (BUILD-24)
- **Never flatten Stripe's `trialing` to `active` in `customer.subscription.updated`.** Doing so erased the
  trial from Settings on a card update. (BUILD-90)
- **Send plan changes and payment updates for an existing subscription to the Stripe Customer Portal.**
  Never rebuild it. Checkout is only for a new subscription. (BUILD-24, BUILD-31)
- **Return typed billing errors, never a raw 500:** `plan_not_configured`, `plan_mode_mismatch`,
  `portal_not_configured` via `billingConfigError`. The client shows them through `billingErrorMessage`.
  (BUILD-24)
- **`pricing.json` is the one price list, and it is the only place a number lives.** One plan,
  everything included, unlimited users, month to month; three bands on ACTIVE donors — $199 up to
  1,000, $299 up to 5,000, $499 up to 10,000, and above that a conversation. Yearly is two months
  free ($1,990 / $2,990 / $4,990). It is JSON, not a module, because the server needs it
  synchronously at require time and the client needs it in the bundle, and a root CommonJS file
  cannot be bundled (Rollup's CommonJS transform covers only node_modules). `pricing.js` adds the
  lookups; `closeLink.js` builds `TIER_CLOSE_PLANS` from it; the client imports the JSON. (GTM-1a)
- **An active donor is one sentence, and it is `activeDonorSentence`.** A gift OR a logged
  conversation in the last 24 months. The pricing page, the signup page and the over-band notice
  all render that constant. (GTM-1a)
- **A plan id is `<band>_<cadence>`** (`t5000_yearly`). A yearly plan's first charge is the YEARLY
  figure: read it with `planAmountUsd(plan)`, never `plan.monthlyUsd`, which is still the monthly
  number on purpose. `planInterval(plan)` is what the Stripe price-check compares cadence against.
  (GTM-1a)
- **The legacy three (Founding $199, Core $249, Team $499) do not move.** Real organisations are on
  those Stripe prices; `LEGACY_CLOSE_PLANS` and their env vars are untouched, recognised by the
  webhook for ever, and no longer offered anywhere. (GTM-1a)
- **The $1 internal price is never public, and that is enforced in three places, not one:** it is
  not in `pricing.json` (so it is not in the browser bundle at all), not in `TIERS` (so no estimate
  resolves to it and no public route can name it), and `validateCloseLink` refuses it by name. The
  one door is `POST /admin/orgs/:id/internal-test-price`, super-admin only, on an org that already
  exists. `tests/gtm1a-internal-price.test.js`. (GTM-1a)
- **Public signup IS a close link.** `POST /public/signup` writes a `close_links` row with
  `signup_source='public'` and hands back the same Stripe Checkout; the org, the first admin and
  the subscription are created by the same webhook, with the same thirty days from signing, the
  same seven-day reminder and the same two-click cancel. There is no second org-creation path, and
  a signup that is never paid for leaves two rows and nothing else. (GTM-1a)
- **A click-through acceptance names a version AND a sha256.** `legal/customer-agreement.md` is
  served by `GET /public/agreement`; `customerAgreement.js` bumps `VERSION` with the document and
  `verifyVersion()` refuses a mismatch. Rows in `terms_acceptances` are append-only, carry the
  sha256 of the exact bytes served, and learn their `org_id` when Checkout completes. A signup body
  whose `termsVersion` is stale is refused rather than recorded. The document lives in `legal/`,
  not `claude/`, because `.railwayignore` excludes `claude/` — the product must have the document
  it serves. (GTM-1a)
- **An org is never moved between bands silently.** `checkActiveDonorBand` counts, records ONE
  open notice (`orgs.tier_notice_*`), tells the admin in-app and by email, and dates the change at
  least `TIER_NOTICE_DAYS` = 30 out. It never writes `orgs.plan`, never calls Stripe, and never
  changes an amount. A second check that finds the same band is the same notice and does not
  restart the clock; falling back inside the band withdraws it. Dismissing hides the banner and
  keeps the notice. A legacy plan (core/team/founding) has no band and is never measured against
  one. `tests/gtm1b-band-notice.test.js`. (GTM-1b)
- **The active-donor count is the pricing page's sentence, in SQL.** A DISTINCT non-deleted donor
  with a gift OR a conversation inside `activeDonorMonths`. Four gifts from one person is one
  person. Changing the sentence changes the count. (GTM-1b)
- **The founding discount is a COUPON, not a price.** `Gv9E1KkK` ($50 off, code `STEWARD50`) is
  applied at checkout for any org with `orgs.founding_partner`, on whichever band they pick — a
  price could not follow an org that grew, and a founding partner would have lost what they were
  promised the day they outgrew the first band. Backfilled from `plan='founding'`. (GTM-1b)
- **The Agent's free thirty days allow 25 plans, and the cap lifts at the first charge.** Counted
  as rows in `agent_instructions` for the org, for ever — a deleted plan was still a model call, and
  refunding the allowance on delete makes a cap advisory. Refused ABOVE `agentBuildPlan`, because a
  refusal after the model answers has already spent what the cap exists to prevent. (GTM-1b)
- **Every signup emails the founder, one message per signup.** Not `opsAlert`, which dedupes by
  kind and hour: two organisations signing up in the same hour is news, not a repeat. (GTM-1a)
- **A configured price id is not a correct price.** The close link retrieves the Stripe price and compares
  the amount before minting (`plan_price_mismatch`). `GET /admin/close-links` reports `ready`. (BUILD-90)
- **Guard prices by the data and the rendered page, never by banning a string in source.** The price is
  interpolated from a number. (BUILD-90)
- **Charge first thirty days after signing, with no clauses.** `orgs.signed_at` is stamped once by the close
  link. `trialEnd.js` is the one definition. Nothing an org does, such as an import, moves the date.
  (BUILD-90)
- **Write `orgs.trial_ends_at` from Stripe's `subscription.trial_end`.** Never recompute it. (BUILD-90)
- **Checkout lands her signed in, on onboarding (FIX-32).** A NEW-org close link (public signup or
  super-admin) carries a one-time key in its `success_url` (`/signed-up?session_id={CHECKOUT_SESSION_ID}&k=`);
  `close_links.signin_key_hash` holds only its sha256. `POST /public/checkout-signin` trades key + session id
  for a session only when both match the link, Stripe says the session is `complete`, the org exists, and
  `signin_used_at` is still null (spent atomically; dead 24 hours after the link was made). Until the
  webhook has made the org it answers 202 `pending` and the page waits 30 seconds, then offers the link
  by email (`/public/checkout-signin/email`), never a bare login form. An existing-org link still lands on
  `/login`: that admin already has a password, and the key must never open an account with data in it.
  Two-step and super-admin accounts are refused the trade. Golden journey J11; `npm run status` checks the
  page and the route.
- **Bring new customers in only through the super-admin close link.** Public `/signup` redirects to
  `/invitation`. No org, user or subscription exists until `checkout.session.completed`. (BUILD-90)
- **To put an org that already exists on a plan, pass `orgId` to `POST /admin/close-links`.** Completion
  attaches to that org instead of creating one. `users.email` is globally unique. (BUILD-92)
- **Send the trial reminder once:** stamp `trial_reminder_sent_at` only after delivery, and only for an org
  with a real `stripe_subscription_id`. Its cancel link confirms on GET and cancels on POST. (BUILD-90)
- **Cancel before the first charge with `subscriptions.cancel`, and after it with
  `cancel_at_period_end`.** Assert what Stripe was told. (BUILD-90)
- **Show a manually granted plan (`hasSubscription:false`) as a manual grant.** Never open an empty Customer
  Portal for it. (BUILD-31)
- **Keep plan bands soft for core/team/founding and every tier plan (`SOFT_BAND_PLANS`).** A band is a
  conversation and thirty days' notice, never a door. If bands are ever enforced, count ACTIVE donors,
  not every record. (BUILD-24)
- **One plan, everything included: no route, panel or tab is gated on a tier.** `orgPlanTier` returns
  `"team"` (the full CRM) for every org except `plan='portal'`, and `requireCrm` refuses only the Portal
  tier (403 `crm_not_included`). There is no `requirePlan`, no `plan_required`, no `LockedFeature`, no
  `goToPricing` and no Core-hidden tab; `tests/upgrade-checkout.test.js` scans every client file and every
  route file for them. Writes are gated by billing state (`checkWriteAccess`, 402) and nothing else.
  (FIX-32, replacing BUILD-45 F-1)
- **Keep `/auth/invite` write-ungated.** Seats are unlimited on every plan, the trial and the legacy
  Core/Team/founding prices included (FIX-32). An import may assign donors to `invite:<id>`, and they are
  held until accept. (BUILD-45, invites FIX)
- **A subscription that ends inside the free thirty days takes nothing away.** `markSubscriptionEnded`
  (webhooks.js) and the in-trial `/billing/cancel` set `subscription_status='canceled'` and
  `grace_until = trial_ends_at`, never rewrite `orgs.plan`, and `getOrgAccessState` reads a cancelled org
  whose trial end is still ahead as `full`. `/billing/status` says `trialCanceledSentence` ("Your trial
  ends Nov 6 and you won't be charged."), and the only offer is **Keep Steward**: `POST
  /billing/create-checkout {keep:true}`, which reads the plan from the org's close link and carries the
  org's own `trial_ends_at` onto the new subscription. A trialing org never sees Reactivate or a plan
  picker. After the first charge, ending a subscription is three days' grace as before. (FIX-32)
- **Stripe's $0 `subscription_create` invoice is not a payment.** `invoice.payment_succeeded` with
  `amount_paid: 0` and `billing_reason: "subscription_create"` changes nothing; it used to flip a brand-new
  org from `trialing` to `active` in the second it was born. (FIX-32)
- **The plan picker (`PlanPicker.jsx`) renders `pricing.json`'s bands and nothing else.** It opens only
  for an org whose PAID subscription has lapsed. The retired Core $249 / Team $499 list is gone from the
  client. (FIX-32)
- **Enforce cross-officer visibility (all portfolios, the officer filter, bulk assign) as admin-only on the
  server.** Do not merely hide it. (BUILD-31, BUILD-36)
- **Revoke sessions by bumping `users.sessions_valid_after`** on password reset, role change or removal.
  `requireAuth` checks it through a 30s cache. `requireAdmin`/`requireSuperAdmin` read live. (BUILD-38)
- **Verify two-step codes with `totp.js`; accept a code at most once (`users.mfa_last_counter` advances
  atomically).** The secret is sealed with `secretBox`. An unset `STEWARD_CREDENTIAL_KEY` gets 503.
  (BUILD-98 P8)
- **Give an admin without two-step a setup-only session when `orgs.require_admin_mfa` is on.** It reaches
  only `/me/mfa`, `/me/mfa/setup` and `/me/mfa/enable`. The org rule refuses to lock out its own admin.
  It is default off. (BUILD-98 P8)
- **`GET /org/export/full` finds org tables from `information_schema`.** It withholds secrets by column
  name, is admin only, and is never write-gated. A lapsed org can always leave. (BUILD-98 P8)
- **Default "already welcomed" (`users.welcomed_at DEFAULT NOW()`).** `/auth/register-org` sets it NULL by
  name, so fixtures and existing users are never greeted. (BUILD-94)
- **Pass `provisioned:true` to `/auth/register-org` when creating an org for someone.** It is born with mail
  off and marked as fiction. (INCIDENT-2026-09-22-outbound-email.md)
- **Provision the ledger at birth on every org-creation path through `ensureOrgLedger`.** The paths are
  register, register-org, network signup and the close link. (BUILD-58 W-3)
- **Compute setup-checklist items live from org data.** Only the dismissal is stored
  (`orgs.setup_card_state`). The `team` item is on every org now that there is one plan. (BUILD-35, FIX-32)
- **Show a setting's payoff on one screen, or cut the setting from the UI** while keeping the data model.
  (BUILD-31)
- **Make the first login a non-dead-end for every tier.** `tests/first-login-matrix.test.js` is a data
  table, and a plan literal without a row fails. (BUILD-58 W-2)

### FIX-AUTH — a revoked session is refused, and the client acts on it
- **A 401 on a request that CARRIED a token is an unusable token, whatever the server calls
  the reason.** `client/src/api.js` decides on the status and the token, never on a list of
  codes. It held an allowlist of three and `requireAuth` returns six, so `session_revoked`,
  `user_not_found` and `account_deactivated` cleared nothing and redirected nowhere: the app
  sat on "Failed to connect" with a Retry that could not work. The codes now choose only the
  WORDING, and an unknown one falls through to a general sentence. (FIX-AUTH)
- **A sign-out is not an outage, and `leavingForLogin()` is checked BEFORE the
  `loadErr||!data` branch in `App.jsx`.** The 401 starts the navigation to `/login` and then
  throws; that throw landed in `loadData`'s catch and painted the outage screen over a
  redirect already on its way. (FIX-AUTH)
- **`sessions_valid_after` is a security control, so the client honouring it is pinned**
  (`tests/auth-revocation.test.js`): every 401 `auth.js` can return is typed and reachable, a
  revoked session and a removed account really are refused end to end, and there is no
  allowlist left to fall behind. (FIX-AUTH)

### The demo request form (LANDING-2, FIX-13; moved from BLOCKED-landing-2.md by FIX-19)

- The marketing site's `/demo` form posts to `POST /lost-and-found/lead` (routes/billing.js)
  with `ref: "book-a-demo"`. The row lands in `lost_and_found_leads`, which super admin's
  Lost & Found view reads, with source `book-a-demo`.
- Every field is picked out of the body by name: name, email, organization, ref, and (since
  FIX-13) `org_size` and `current_system`. Never a spread.
- The route emails Jonathan only (`FOUNDER_EMAIL`, reply-to set to the person). The person who
  asked is never emailed. A demo request is named one in the subject and body; the "ran the
  audit" sentence is for audit leads only.

## Gotchas
- **`ADD COLUMN IF NOT EXISTS … DEFAULT x` does nothing when the column exists, including the default.**
  Follow it with `ALTER COLUMN … SET DEFAULT`. (BUILD-94)
- **`orgTz(orgId)` returns an object, and passing it to `Intl` throws.** Use `orgTzName()`. (BUILD-90)
- **`tests/invitation-only.test.js` deliberately scans comments for retired prices.** Never write an old
  price into a comment. Other source-grep guards strip comments. (BUILD-90)
- **A test/live mismatch between the billing key and the `STRIPE_PRICE_*` ids surfaces as
  `plan_mode_mismatch`.** Check `/health.billing` or `GET /admin/billing-diagnostic`. (BUILD-24)
- **The Customer Portal must be configured in the same mode as the key and prices, with plan switching
  on.** Otherwise it opens but offers no switch. (BUILD-24)
- **The close-link suites need `STRIPE_BILLING_API_BASE` (mock on `BILLING_MOCK_PORT`) and all three
  `STRIPE_PRICE_*` ids.** Without a configured price, the close link refuses. (BUILD-90)
- **Capture a GoldMoment's celebrate decision once, at fetch time.** The component stamps its flag on
  mount, so re-reading it kills the banner. (BUILD-35)

## Where the code is
- `auth.js` — `requireAuth` (session revocation, setup-only MFA sessions), `requireSuperAdmin`
- `closeLink.js` (`CLOSE_PLANS`, `formatChargeDate`) · `trialEnd.js` · `billingPlans.js` · `stripeKeys.js`
- `totp.js` · `shared/secretBox.js` — two-step sign-in
- `server.js` `app.post("/billing/webhook")`, `POST /admin/close-links`, `ensureStripeCustomer`,
  `checkBillingPriceModes`, `orgPlanTier`/`requirePlan`, `checkWriteAccess`
- `client/src/pages/Pricing.jsx`, `components/PlanPicker.jsx`, `shared.jsx` `goToPricing`, `api.js`
  `billingErrorMessage`
- `scripts/create-billing-products.js` — provisions prices (test first; `--live` required for live)
- `tests/close-link`, `trial-billing`, `one-date`, `billing`, `build92-close-existing`,
  `permissions-matrix`, `build98-security`, `first-login-matrix`

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Super admin pattern
- `is_super_admin BOOLEAN DEFAULT false` column on `users` table
- Set via: `UPDATE users SET is_super_admin = true WHERE email = 'your@email.com'` in Supabase
- Login route includes `isSuperAdmin` in JWT payload and returned user object
- `requireSuperAdmin` middleware in auth.js — returns 403 (not 404)
- All `/admin/*` routes require both `requireAuth` + `requireSuperAdmin`
- After login: always `"/dashboard"` — super admins navigate to `/admin` manually
- `RequireSuperAdmin` component in main.jsx reads localStorage (not AuthCtx) so it works without re-render on redirect
- AdminDashboard.jsx has its own `adminFetch()` helper (not apiFetch) and its own layout — no AppShell
- Design tokens: `A` object (not `T`) — bg `#0a0f0a`, dark ops-tool aesthetic
- `POST /admin/orgs/:id/extend-trial` (2026-07-16 rewrite — previously crashed with "pool is not defined", dead pg-style code): extends `trial_ends_at` by `{days}` from `GREATEST(trial_ends_at, NOW())` (an expired trial extends from now, not from the past), and restores `subscription_status='trialing'` if it was `trial_expired` so the extension actually lifts read_only. `GET /admin/orgs` computes per-org metrics via grouped aggregates (one query per table), not per-org queries — `orgWithMetrics` remains only for `GET /admin/orgs/:id`.

## Auth (IMPORTANT)
- Login writes npe_token, npe_user, npe_org to localStorage directly
- LoginPage uses hardcoded fetch() to Railway URL, not apiFetch
- onboarding_complete comes back as 1 (number) not true (boolean)
- After login: `window.location.href = data.user.isSuperAdmin ? "/admin" : "/dashboard"`. `/today` still exists as a route in main.jsx but is now just `<Navigate to="/dashboard" replace />` (kept for bookmarks) — `TodayPage.jsx` was deleted 2026-07-16.
- RequireOnboarded guard in main.jsx checks both auth AND onboarding_complete; redirects to /welcome if onboarding_complete is 0
- `requireAuth` (auth.js) distinguishes `jwt.verify` failure modes and returns a distinct error code + message rather than one generic message: `{error:"token_expired"}` (TokenExpiredError), `{error:"invalid_token"}` (bad signature/malformed — e.g. what a server-side `JWT_SECRET` rotation looks like to every previously-issued token), `{error:"no_token"}` (missing/malformed Authorization header)
- Client (`api.js` `apiFetch`/`streamAI`) detects any of these three codes (plus the legacy `"Invalid token"`/`"No token provided"` message strings, for compatibility during a deploy) on a 401, clears `npe_token`/`npe_user`/`npe_org`, and redirects to `/login` with a "Your session expired — please log in again" message via `sessionStorage` — instead of leaving the app on a dead-end "Failed to connect" screen with a Retry button that could never succeed on a bad token
- A real production incident of this kind was traced to an out-of-band `JWT_SECRET` rotation on Railway invalidating all issued tokens — not a bug in the sign/verify code itself, which was already internally consistent. The fix above is about graceful recovery from that class of event (expected or accidental), not a correctness fix to token signing/verification.

## Onboarding flow (IMPORTANT)
- Signup → /welcome (RequireAuth, not RequireOnboarded)
- **Onboarding is on the Steward brand system (FIX 2026-07-21).** All 5 steps use the same cream / forest-green / gold palette + serif "Steward" wordmark as the landing and the BUILD-12 in-app app — the old off-brand blue→green "AI" gradient (on the import CTA + progress bar) and the hexagon/diamond glyph are gone. `WelcomePage.jsx` imports the BUILD-12 `T` tokens from `components/shared` (no raw hex): primary CTA = solid `gold500` with ink text (matches the landing's "Start free", never a gradient); progress bar = flat green fill on a cream track; wordmark = DM Serif Display "Steward" (no glyph/SVG); errors ride terracotta (not red/pink); secondary actions are green (underlined links / green outline). The ONE allowed gradient is the documented gold-moment celebration sheen (gold→light-gold, `.gold-moment`). Emoji-free (BUILD-20 standing rule). Guarded by `tests/onboarding-brand.test.js` (grep-guard: no AI gradient / no blue / no diamond / wordmark present / tokenized, in `tests/run-all.sh`). DSF3 screenshots of every step: `docs/onboarding-brand-2026-07-21/`.
- WelcomePage is now a **5-step flow that finishes with real, working data** — not a blank slate. Rebuilt because the new home screen (goal banner, queue, funnel) shows nothing valuable until there's real donor data, a goal, and at least one impact metric configured. There is no guided-tour step — no GuidedTour/OnboardingWizard component exists in the codebase (see "What's NOT built" note below); a comment in WelcomePage.jsx marks where one would slot in if built later.
  1. **Org basics** — org name + mission/tagline → `PATCH /orgs/:id` (route extended to accept an optional `name` field for this; previously mission/focusArea/annualBudget/foundedYear/website only)
  2. **Import your donors** — centerpiece step. Embeds the real `DonorImport` component (now exported from Donors.jsx, was module-private) as a modal — same CSV import used everywhere else in the app, not a simplified onboarding-only version. Only skippable step: "I don't have a list ready yet — I'll do this later." Skipping sets `importSkipped` state, checked in step 5.
  3. **Set your first goal** — pre-fills from real imported data via `useMemo` over a `GET /donors` snapshot: if lapsed donors exist, suggests `{goalType:"lapsed_recovery", label:"Win back $X in lapsed giving"}`; otherwise suggests `{goalType:"total_raised", label:"Raise $X this quarter"}`. Calls `POST /goals`.
  4. **First impact metric** — pre-filled template built from the org name (string concatenation, not a template literal — `{amount}`/`{n}` must appear as literal placeholder text in the saved template for the backend's own `.replace()` logic to fill in later, not be evaluated as JS). "+ Add another metric" reveals an optional second one. Calls `POST /impact-metrics` once or twice.
  5. **Finish** — calls `POST /onboarding/complete` (seedOrgData + `onboarding_complete=1`) **at the end of the flow, not the start**, deliberately: goal/metric steps are non-skippable, so flipping the flag early would let a user who drops off mid-flow land on a half-set-up `/dashboard` on next login. Then an animated checklist, then a "ready" screen with "Go to my home screen →" always, plus a conditional "Load sample data & explore →" button shown only when `importSkipped && donorsSnapshot.length === 0`.
- `seedOrgData` still seeds only structural data (26-account chart of accounts + one General Operating fund) — real donor/goal/metric data now comes from steps 2–4 above, not from seeding.
- Known-fixed bug: the mount-effect that redirects an already-onboarded org straight to `/dashboard` must have an empty dependency array (`[]`, mount-only) — watching `[auth]` re-fires reactively when step 5's `refreshOrg()` updates the auth context mid-flow, force-navigating away and skipping the "ready" screen (and its conditional sample-data button) before it renders. This exact bug existed latently in the old 3-step flow too, just invisibly, since both old final-step buttons already led to `/dashboard`.
- InvitePage: **on the PUBLIC auth convention (BUILD-36 B1) — cream page, serif "Steward" wordmark + serif headline with gold underline, white card, GOLD "Accept invitation" button with INK text, forest links, tokens only** (it used to be a near-black navy card with the retired solid-green button — a different product than sign-in). Flow unchanged: invited staff land on /dashboard (org already onboarded). **Why the brand guard missed it, now fixed:** `brand-glyph.test.js` §6 only scanned for two specific off-brand hexes (emerald/AI-blue); the invite card was a whole DARK NAVY Tailwind theme no rule checked — the same "surface outside the swept bucket" class as the reset-email leak. §10–11 extend the guard to the **auth bucket** (Invite/Login/Signup/Forgot/Reset must carry NONE of the dark-navy/slate palette + invite follows the gold/forest/cream convention) and pin the server-rendered **unsubscribe/expired-link page** (already cream/serif) so neither can drift back to a dark theme. Guard proven (plant `#030712` → build fails → remove).

## Database tables (moved from the old "Database — key tables and columns")

### SaaS billing (platform)
- orgs table: `plan TEXT DEFAULT 'trial'`, `trial_ends_at TIMESTAMPTZ`, `stripe_customer_id TEXT`, `stripe_subscription_id TEXT`, `subscription_status TEXT DEFAULT 'trialing'`, `current_period_end TIMESTAMPTZ`, `grace_until TIMESTAMPTZ`
- Plans: `trial` | `seed` | `growth` | `impact`
- Subscription statuses: `trialing` | `active` | `past_due` | `canceled` | `trial_expired` (note: old rows may have `cancelled` with 2 l's — code handles both)
- `POST /auth/register-org` — public self-serve signup (creates Stripe customer inline; wrapped in try/catch that only logs on failure, so `stripe_customer_id` can still end up null — see `ensureStripeCustomer` below). The older `POST /auth/register` route (still mounted) never attempts Stripe customer creation at all.
- `GET /billing/status` — returns plan, subscriptionStatus, trialEndsAt, trialDaysLeft, graceUntil, currentPeriodEnd, accessState
- `ensureStripeCustomer(orgId, email)` helper — looks up `orgs.stripe_customer_id`; if null, creates a Stripe customer from the org name + given email, persists it, and returns it. `POST /billing/create-checkout` and `POST /billing/create-portal` both call this first instead of reading `stripe_customer_id` directly, so an org with no Stripe customer (legacy-route signup, or a failed inline creation) gets one transparently instead of the routes throwing "No Stripe customer linked to this org"
- `POST /billing/create-checkout` — creates Stripe Checkout session for subscription
- `POST /billing/create-portal` — creates Stripe Customer Portal session — for managing an *existing* subscription (payment method, invoices) only. NOT used by Reactivate/upgrade flows anymore (see PlanPicker below) since the Portal shows confusing empty states for an org with no subscription yet.
- `POST /billing/webhook` — handles checkout.session.completed (active + period_end + clear grace), invoice.payment_succeeded (active + period_end + clear grace), invoice.payment_failed (past_due + grace 7d), customer.subscription.deleted (canceled + grace 3d)
- `getOrgAccessState(org)` → `full | warning | read_only`. active/trialing → full; past_due/canceled within grace_until → warning; trial_expired or past/canceled past grace_until → read_only
- `checkWriteAccess` middleware: returns 402 `{error:"subscription_required"}` when read_only. Applied to all create/update routes across Donors, Grants, Volunteers, Tasks, Events, Campaigns, Board, and Custom Fields:
  `POST /donors`, `POST /donors/import-combined`, `PUT /donors/:id`, `POST /donors/:id/gifts`, `POST /gifts/import-history`,
  `POST /grants`, `PUT /grants/:id`,
  `POST /volunteers`, `PUT /volunteers/:id`,
  `POST /tasks`, `PUT /tasks/:id`,
  `POST /events`, `PUT /events/:id`, `POST /events/:id/attendees`, `PATCH /events/:id/attendees/:attendeeId`, `POST /events/:id/follow-up`,
  `POST /campaigns`, `PUT /campaigns/:id`, `PUT /campaigns/:id/briefing`, `POST /campaigns/:id/send`,
  `POST /board`,
  `POST /custom-fields`, `PUT /custom-fields/reorder`, `PUT /custom-fields/:id`,
  `POST /goals`, `POST /impact-metrics`, `PUT /impact-metrics/:id`, `POST /voice-memos/save`.
  DELETE routes are intentionally never gated (consistent across all of the above). Never blocks GET or export.
- `checkTrialExpiry()` job: sets trial_expired when trial_ends_at < NOW(). Runs on startup (+15s) + every 6h.
- Multi-state banner in App.jsx: read_only=red persistent; warning+past_due=amber update payment; warning+canceled=amber with grace date; trialing≤14d=green (amber at ≤3d). Warning/read_only not dismissible. "Reactivate" (read_only + canceled/warning banners) and "Choose a plan"/"Upgrade now" (trial banner) open `PlanPicker.jsx` → `POST /billing/create-checkout`, not the Portal. "Update payment" (past_due banner) still opens the Portal, since that org has an existing subscription/payment method to fix.
- Create/add buttons disabled with the `"Reactivate your subscription to make changes."` tooltip when `isReadOnly`, matching client-side the routes `checkWriteAccess` gates server-side: Add Donor/Log Gift/New Grant (Dashboard Quick Actions), Send Email (Dashboard Quick Action → Communications), "+ Add" (Donors), "+ Add Grant" (Grants List view AND Kanban view's own Add Grant button — these are two separate buttons), "+ New Campaign" (Communications), "+ New Event"/"Create Your First Event" (Events), "+ Add" (Tasks), "+ Add Volunteer" (Volunteers), "+ Add Board Member" (Board), "+ Add Field" (Settings custom fields)
- Settings.jsx billing badge: `BILLING_STATUS_META` lookup (label + bg/color/border per `subscriptionStatus`) covering `active | trialing | past_due | trial_expired | canceled | cancelled` — replaced an earlier ternary chain that had no `trial_expired` branch (fell through to "Trialing" for an org whose trial had actually ended)
