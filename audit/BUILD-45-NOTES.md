# BUILD-45 (Donor Portal) — verification notes

Per §0 rule 1: current behavior of every subsystem this build touches, verified by
reading the code on 2026-08-10 (HEAD `384a51a`), before building. NB "BUILD-45"
is being reused a THIRD time (2026-08-07 F-1/F-2, 2026-08-08 dashboard defects,
now this portal build). The prior `audit/BUILD-45-FINDINGS.md` (dashboard
defects) is preserved as `audit/BUILD-45-dashboard-FINDINGS.md`; this build's
findings take the canonical `audit/BUILD-45-FINDINGS.md` path per the brief.

## Strategic note

CLAUDE.md records "a donor-facing portal was explored and rejected" (2026-07-12
pivot) — that rejection was specifically of gamified tiers/badges/leaderboards.
This brief deliberately reverses the no-portal decision while keeping the
anti-gamification substance (no tiers, no badges, no passwords, thin-data
honesty §3.2, no retention dark patterns R-4). Proceeding per the brief;
recorded here so the reversal is explicit, not accidental.

## §1.1 F-3 — gift idempotency (verified OPEN)

- `POST /donors/:id/gifts` (server.js ~3657): no idempotency key. Every call
  inserts a fresh `g_<uuid8>` gift. A double-tapped Save = two gifts (BUILD-44
  F-3 repro'd in `tests/concurrency2.test.js`).
- The Stripe webhook path is ALREADY idempotent on `stripe_payment_id`
  (`uq_gifts_stripe_pi` partial unique, BUILD-27) — that IS its idempotency key;
  no change needed there.
- Import paths: idempotent at the donor level (email dedupe drops an existing
  donor's gifts entirely on re-run) but NOT at the gift level within a changed
  file; see F-4.
- Ledger stamp already idempotent per gift (`uq_fin_txns_gift`).

Fix shape: `gifts.idempotency_key TEXT` + partial unique
`uq_gifts_idem (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL`;
route takes `idempotencyKey`, inserts `ON CONFLICT DO NOTHING RETURNING`; on
conflict returns the existing gift (`duplicate:true`) and runs ZERO side effects
(no donor delta, no ledger, no workflow, no pledge apply). Client forms mint a
key per form-open (`crypto.randomUUID()`). Import rows may carry `externalId`
(same column family — see F-4). Portal gift paths (R-6) require the key.

## §1.2 F-4 — import twin-collapse (verified OPEN)

`/donors/import-combined` (server.js ~3144): `giftFingerprints` set keyed
`donorId|amount|date` silently drops the second same-day/same-amount gift for a
donor **within one file**. Forty $100 Sunday gifts from one donor's transaction
export → 1 row. `/gifts/import-history` has the same class of collapse.
BUILD-43 encoded this as current behavior (state-diff manifests) — those
manifests change with this fix (a money-contract change, per the manifest
discipline: this IS the reviewed change).

Fix shape: never collapse on (donor, amount, date) alone. If the file maps an
external-ID column → that is the dedup key (`gifts.external_id` + partial
unique `(org_id, external_id)`, doubling as cross-run import idempotency).
Without an external ID → insert ALL rows, and return `duplicateCandidates`
(count + samples) in the response for human review; client shows the report.

## §1.2 F-5 — pledge over-fulfillment (verified OPEN)

`POST /donors/:id/gifts` with `pledgeId` (~3727) sets `status='fulfilled'`
unconditionally — a $100 payment against a $1,000 pledge closes the whole
pledge. `DELETE /gifts/:id` (~3894) reopens fully. `pledges` has no paid
tracking; open-pledge sums (`/fundraising` ~7573/7678, solicitations ~10541)
read `SUM(amount) WHERE status='open'`.

Fix shape: `gifts.pledge_id` column (derived-not-stored discipline: paid =
`SUM(gifts.amount) WHERE pledge_id=X`). Payment stamps `pledge_id`; pledge
fulfills only when paid ≥ amount; partial leaves it open with an honest
balance. Open-pledge sums become `Σ(amount − paid)` (remaining, not face).
Gift delete recomputes and reopens only if paid falls below amount. Backfill:
`gifts.pledge_id` from `pledges.fulfilled_gift_id`.

## §2 — auth substrate (verified)

- Staff auth is JWT in `Authorization` header (auth.js `requireAuth`), no
  cookies anywhere in the app; no cookie-parser dep. Portal sessions will be a
  hand-parsed `Cookie` header + `Set-Cookie` (no new dependency, rule §0.4).
- **Tenant resolution decision (P-5): path-based on the existing domain** —
  `stewardapp.dev/portal/:orgSlug` (client) + backend routes under `/portal/*`
  reached in production via a NEW vercel.json proxy rewrite (same mechanism as
  the existing `/unsubscribe` + `/recurring/update-card` proxies). Reason:
  wildcard subdomains on Vercel need a wildcard domain + per-org routing that
  the current static SPA config can't express, and a proxy makes the portal
  API SAME-ORIGIN so the SameSite=Lax HttpOnly cookie (P-4) actually flows.
  Custom CNAME domains → `BLOCKED-custom-domains.md`.
- `orgs.org_slug` exists (unique-by-construction backfill, db.js 387–395) and
  is already the public giving-page tenant key.
- Rate-limit infra: express-rate-limit instances per concern (server.js 148ff),
  all honoring `DISABLE_RATE_LIMIT`. Portal gets its own limiters; the
  magic-link limiter must NOT honor the blanket disable in the same way the
  suites need bursts — pattern: keyed limiters + a scripted-burst test with the
  limiter ON (P-3/S-5), run with a dedicated env flag.
- Token hygiene: `signRecoveryToken`/`verifyRecoveryToken` (HMAC) exist, but
  magic-link tokens per P-1 need single-use + server-side revocation → a DB
  table with SHA-256 token hashes (never plaintext at rest), not stateless HMAC.

## §3 — ledger the portal must read (verified)

- Donor totals/history: `gifts` rows are the ONE ledger (every CRM report is a
  live SUM). Portal totals must be computed from the same `gifts` predicates
  Reports use (org-scoped, `deleted_at IS NULL` join on donors). NO parallel
  computation.
- Receipts: `receipts.pdf_data` (base64) stored per receipt; staff route
  `GET /receipts/:id/pdf` streams it. Portal reuses the STORED bytes —
  no second generation path. Portal receipt route must be session-scoped
  (S-9), donor-ownership-checked, never a guessable URL.
- Household/soft credit: derived views (BUILD-14); portal shows own hard
  credit; household combined renders in a separate labeled section (P-6).
- Recurring display: `recurring_subscriptions` (schema db.js 985) has
  amount/interval/status/failure fields; card last-4 is NOT stored → fetch
  from Stripe at read time (display only) or omit gracefully when Stripe
  unreachable.

## §4 — recurring mutations substrate (verified)

- No pause state exists (status enum: active/past_due/recovering/recovered/
  canceled) — BUILD-44 F-6 confirmed. Adding `paused` + `paused_at` +
  `resume_at` columns; Stripe side via `pause_collection`.
- Donation Stripe client: `stripe = new Stripe(donationStripeKey())`
  (server.js 79), connected-account calls pass `{stripeAccount}`. For tests
  (dummy key, no network) a `STRIPE_API_BASE` env override (Stripe constructor
  `host`) pointed at a local mock — same seam pattern as `RESEND_BASE_URL`.
  Mutations are Stripe-first: if the Stripe call fails, the mutation FAILS
  (a donor told "canceled" while Stripe keeps charging is the worst outcome).
- Card update: setup-mode Checkout already exists (`/recurring/update-card`,
  token-signed) — the portal reuses that flow (R-5); card data never touches
  Steward. Recovery/dunning email exists (`buildCardUpdateUrl` → §6.3 recovery
  link CAN be wired, not blocked).
- Notifications: `notifyUserOnce` + `notification_failures` retry infra
  (BUILD-45-Aug7) is the ONE delivery path (R-8); workflow `fireWorkflows` +
  `/dashboard/today` queue is the Monday day-view surface (§6.3 drift wire).
- R-6 (new recurring gift from portal): public giving pages EXIST per-org
  (`/give/:orgSlug`) → reuse with session-prefilled identity; not blocked.

## §5 — theming substrate (verified)

- `branding.js` exports `contrast(a,b)` + `normalizeAccent` (WCAG math) —
  reuse for the portal contrast guard; do not fork a second contrast impl.
- Upload validation precedent: `PUT /orgs/branding` (mime allowlist + size
  cap, base64 data-URI storage) — same discipline for portal logo/header.
- Escaping: server has `esc()` HTML-escape usage in email templates; the
  portal client is React (auto-escapes) — the XSS surface is org-authored
  strings rendered into portal HTML; no `dangerouslySetInnerHTML` allowed.

## §6 — impact/drift substrate (verified)

- Restricted-fund routing exists: `gifts.fund_id`, `gifts.campaign_id` (and
  legacy name), `fin_funds` — deterministic matching keys per §6.2.
- Officer alert path: `fireWorkflows` recipes create tasks + emails; the
  cancel/pause alert will notify the assigned officer (ED fallback — same
  graceful degradation as `notify_owner`) through `notifyUserOnce` and land a
  high-priority task so `/dashboard/today` surfaces it.
- Engagement events → `interactions` rows (low-priority, type `portal`), never
  alerting — the timeline is the existing surface.

## Test-stack facts that matter here

- Scratch stack up (PG :5544, server :5601). `DB_SSL=disable` required for
  suites. Fresh server boot before push. Time-of-day flakes: run suites in a
  weekday morning/afternoon local window (today is Mon 2026-08-10 — safe).
- `tests/run-all.sh` is the gate; new suites must be self-contained and wired
  in. State-diff manifests will need reviewed edits for F-4/F-5 (documented
  above — deliberate money-contract changes).
