# Recurring gifts and Stripe

Read this when you touch Stripe Connect, the donation webhook, recurring gifts, dunning, card expiry or the Stripe mocks.

## Rules
- **Never make a money-recording webhook depend on the order of sibling events.** On a new subscription
  Stripe sends `payment_intent.succeeded` before `checkout.session.completed`, at the same time. When the
  sub row is missing, resolve the donor from `pi.customer` via Stripe. (BUILD-62)
- **Flip a subscription to recovered with a compare-and-swap:** `UPDATE … WHERE status IN
  ('past_due','recovering') RETURNING`. `event.id` dedup cannot dedupe across two different event types.
  Whichever event wins does the full bookkeeping, including the thank-you. (BUILD-63)
- **Treat `customer.subscription.updated` as able to arrive before `invoice.payment_succeeded` on
  recovery.** The safety-net branch owns full recovered bookkeeping. This overrides the older "never
  re-sends the thank-you" wording in the reference text below. (BUILD-57 §2a)
- **Make `checkout.session.completed` COALESCE-backfill attribution and fund onto an existing sub row.**
  `invoice.payment_failed` can create that row first, and `ON CONFLICT DO NOTHING` then drops the
  designation. (BUILD-63)
- **Resolve a subscription charge's donor through invoice→subscription (old API) or `pi.customer`→the one
  non-canceled sub (2025+ API).** Real subscription PIs carry no `receipt_email`, no metadata and no
  `pi.invoice` on new API versions. (BUILD-57 §2a)
- **Read invoice payloads through `invoiceSubscriptionId` / `invoiceSubMetadata` / `invoiceLineInterval`.**
  Event payloads use the endpoint's API version, and retrieves use the pinned library version. The helpers read both
  (`invoice.parent.subscription_details`, `current_period_end` on items). (BUILD-57 §2a)
- **Reprice with `price_data.product` from `ensureRecurringGiftProduct()`.** `product_data` is
  Checkout-only, and Checkout's auto-created product is inactive and immutable. (BUILD-57 §2a)
- **Pass `{stripeAccount}` as the third argument on every connected-account retrieve.** stripe-node 22 does
  not detect it in the params position. (BUILD-57 §2a)
- **Change Stripe first on every recurring mutation, holding an advisory lock per subscription.** If Stripe
  fails, the mutation fails. Never record a schedule change while Stripe keeps charging.
  (BUILD-45, BUILD-57)
- **Turn every staff action that can move money into an invitation (`recurring_proposals`):** create, amount,
  frequency, card. Pause, resume, cancel and fund are staff-direct. Staff never touch card data. (BUILD-57)
- **Keep staff cancel free of the `checkWriteAccess` gate.** A donor asking to stop is never blocked, and a
  cancel cannot take money. (BUILD-57)
- **Send every staff-side recurring change through `sendRecurringDonorEmail`, which checks no suppression
  flag.** Test that it cannot be suppressed, not only that it fires. (BUILD-57)
- **Write `recurring_change_log` at every mutation site and decide the churn split at write time.** A delete
  while past_due/recovering is involuntary. A delete from active/paused is voluntary. The deleted-webhook
  skips rows already canceled. (BUILD-57)
- **Log an external amount change from `subscription.updated` only when old and new differ.** Steward's own
  paths sync `recurring_subscriptions.amount` first, so they never double-log. (BUILD-57)
- **Stamp `gifts.recurring_subscription_id` only when the charge resolves a subscription.** Older gifts stay
  NULL and are never guessed. (BUILD-57)
- **Take a renewal's attribution (campaign, page, fund, membership level) from the sub row stamped at
  checkout.** If two or more subs disagree, attribute nothing. (attribution FIX, BUILD-56, BUILD-101)
- **Classify dunning, recovery, card-expiry and recurring-change mail as transactional in
  `DONOR_MAIL_POLICY`.** It ignores the marketing opt-out but honours bounced/complained and `deceased`. This
  overrides the reference text's "skips if suppressed". (BUILD-58 W-4)
- **Log `dunning_sent` only after a real delivery.** A failure retries and logs nothing. A refusal logs
  `dunning_skipped`. (BUILD-58 W-4)
- **Detect expiring cards by a poll (`processCardExpiry`), not a webhook.** `customer.source.expiring`
  never fires for PaymentMethod integrations. (card recovery, 2026-09-11)
- **Read the card with one Stripe call per sub, expanding both `default_payment_method` and
  `customer.invoice_settings.default_payment_method`.** A failed read stamps `card_checked_at` and never
  blanks the stored card. (card recovery, 2026-09-11)
- **Send one expiry notice per card per expiry, stamped with the expiry period (`YYYY-MM`) after
  delivery.** Never stamp a send date. (card recovery, 2026-09-11)
- **Handle `payment_method.automatically_updated` by storing the new card and clearing
  `card_expiry_notified_for`.** Without it, the sweep emails donors whose card the network already fixed.
  (card recovery, 2026-09-11)
- **Open a Thread via `openSustainerLapseThread` when automation gives up:** on cadence exhaustion AND on
  involuntary `subscription.deleted`. A voluntary cancel gets nothing. (card recovery, 2026-09-11)
- **Show expiring cards separately from at-risk money.** Never fold `expiringCount`/`mrrExpiring` into
  at-risk. (card recovery, 2026-09-11)
- **Declare every handled event type in `stripeEvents.js`.** `tests/webhook-manifest.test.js` fails in both
  directions, and `/health.webhookSubscriptions` reports the live endpoint's gaps. (BUILD-63)
- **Ask Stripe for `charges_enabled` live (`stripeChargesEnabled()`) for network approval and delisting.**
  Never trust the link-created `stripe_connected` flag. Unreachable fails safe. (BUILD-58 W-1)
- **On `charge.dispute.created`, flag the gift and open a loud staff task with the respond-by date.** The
  money is held, not reversed. Closed/lost reverses like a full refund. (BUILD-58)
- **Keep `reconcileStripeVsGifts` watching both directions.** It surfaces
  `/health.reconciliation`, and a charge with no gift is an alert. An unreadable account counts in `accountsErrored`,
  never as clean. (BUILD-62, BUILD-63)
- **Recover a missed charge by redelivering its Stripe event.** The handler is idempotent on the PI id, and
  no backfill route exists. (BUILD-62)
- **Never commit live Stripe ids (acct/cus/sub/we/evt/ca) or a real donor email to the public repo.**
  Redact them to placeholders. (BUILD-63)
- **Proxy every bare backend path a donor opens in vercel.json before the SPA catch-all.** These are
  `/recurring/update-card`, `/recurring/proposal` and `/recurring/proposal/confirm`. (publicUrl FIX, BUILD-57)

## Gotchas
- **`stripe listen` forwards events one at a time, so it hides ordering races.** Prove ordering with
  `tests/webhook-ordering.test.js` (events reversed, simultaneous and redelivered). (BUILD-62, BUILD-63)
- **A Stripe mock can be wrong in load-bearing ways; the recurring layer's mock was wrong in seven.** Drill
  real test mode with `scripts/build58-stripe-drill.js` and `stripe listen`. (BUILD-57 §2a, BUILD-58)
- **A test that uses an external payload must use a recorded real one.** `tests/fixtures/external/` holds only
  those, with a `_provenance` stamp. A hand-written fixture fails `external-fixture-provenance`. (BUILD-58)
- **The live donation endpoint may still lack events that Steward handles.** Check
  `/health.webhookSubscriptions.missingCount` and NEEDS-JONATHAN.md. Until `automatically_updated` is
  subscribed, the expiry sweep over-notifies. (BUILD-63, card recovery)
- **The CLI's restricted `rk_live` key returns `account_invalid` for charges on connected accounts.**
  Never infer the prod key's reach from it. (BUILD-63)
- **Local webhook suites need `STRIPE_WEBHOOK_SECRET=whsec_localtest` and `STRIPE_API_BASE` pointed at
  the mock.** On a non-default port, match `STRIPE_MOCK_PORT`/`SINK_PORT` or the failures look like product
  bugs. (BUILD-45, BUILD-98 P1)

## Where the code is
- `server.js` `app.post("/stripe/webhook")` — every connected-account event; records gifts via `recordGift`
- `stripeEvents.js` — `DONATION_WEBHOOK_EVENTS`/`BILLING_WEBHOOK_EVENTS` + `webhookEventDiff`
- `stripeKeys.js` — donation vs billing key resolution
- `processDunning`, `processCardExpiry` (+ `refreshCardsOnFile`/`notifyExpiringCards`),
  `openSustainerLapseThread`, `sendRecurringDonorEmail`, `reconcileStripeVsGifts` — server.js
- `ensureRecurringGiftProduct`, `invoiceSubscriptionId`/`invoiceSubMetadata`/`invoiceLineInterval`,
  `stripeChargesEnabled` — server.js
- `client/src/components/RecurringGiving.jsx` — `RecurringView` (Fundraising) + the Home exceptions panel
- `scripts/check-webhook-subscriptions.js` — manifest vs live endpoint (read-only, prod-guarded)
- `tests/recurring-surface`, `recurring-recovery`, `webhook-ordering`, `webhook-manifest`,
  `reconciliation`, `stripe-disputes` — the suites that pin this area

---

The sections below were moved verbatim from the old CLAUDE.md. Build entries they cite live in `docs/HISTORY.md`.

## Database tables (moved from the old "Database — key tables and columns")

### Stripe / donations
- orgs table: org_slug (text, unique), stripe_account_id, stripe_connected_at
- stripe_donations — id, org_id, amount, donor_name, donor_email, stripe_payment_intent_id, created_at, campaign_id (nullable)
- stripe_subscriptions — id, org_id, stripe_subscription_id, donor_email, amount, interval, status

### Recurring gift recovery (failed-payment dunning) — 2026-07-12
Nonprofits lose 20–30% of recurring giving to involuntary churn (expired/declined donor cards) with nobody ever noticing. This detects it, emails the donor a warm branded card-update link, surfaces revenue-at-risk to staff, and tracks recovery. Entirely about donors' recurring gifts on **connected** Stripe accounts — separate from `/billing/webhook` (Steward's own platform subscription).

- **`orgs`** — `recurring_dunning_enabled BOOLEAN DEFAULT true` (org-level kill switch), `recurring_dunning_subject`/`recurring_dunning_body` (nullable per-org template override, `{{token}}` convention matching campaign/sequence bodies; NULL = use the built-in `DEFAULT_DUNNING_SUBJECT`/`DEFAULT_DUNNING_BODY`).
- **`recurring_subscriptions`** — one row per donor subscription (health record layered on top of `donors.stripe_subscription_id`/`stripe_subscription_status`, which only ever hold `active`/`past_due`/`canceled` and can't distinguish `recovering`). Columns: id, org_id, donor_id, stripe_subscription_id (UNIQUE), stripe_customer_id, amount, interval, status (`active`\|`past_due`\|`recovering`\|`recovered`\|`canceled`), failure_count, first_failed_at, last_failed_at, recovered_at, canceled_at, dunning_step, next_dunning_at. Created `active` at subscription checkout (`checkout.session.completed`, mode=subscription) so every recurring gift has a row from day one — the `invoice.payment_failed` handler falls back to inserting one on the fly for a pre-existing subscription that never went through that path.
- **`payment_recovery_events`** — append-only log: id, org_id, donor_id, subscription_id, type (`payment_failed`\|`dunning_sent`\|`card_updated`\|`payment_recovered`\|`subscription_canceled`), stripe_event_id, detail (JSONB), created_at. `stripe_event_id` is the idempotency key — every webhook handler below checks `recoveryEventAlreadyProcessed(event.id)` before doing anything, so a redelivered Stripe event is a safe no-op. Also the source of truth for recovery-rate math (recovered vs. lost, `COUNT(DISTINCT subscription_id)` per type over a trailing window — the same subscription_id can appear in both buckets across separate failure cycles over time, which is correct: it measures event-level outcomes, not one final fate per subscription).

**Webhook handlers** (added to the existing `/stripe/webhook`, connected-account events — `event.account` → org via `stripe_account_id`, donor matched by `donors.stripe_subscription_id`, falling back to the subscription's own `metadata.donor_email`):
- `invoice.payment_failed` → upserts `recurring_subscriptions` to `past_due`, increments `failure_count`, sets `next_dunning_at=NOW()` (queues the day-0 send for the dunning engine's next tick, not sent synchronously in the webhook), mirrors `donors.stripe_subscription_status='past_due'`. Distinguishes a genuinely NEW failure cycle (previous status was `active`/`recovered`/`canceled` — restarts the cadence from day 0) from Stripe's own retry of the same invoice (already `past_due`/`recovering` — bumps `failure_count` but leaves the cadence alone, since resetting it on every Stripe-internal retry would spam the donor).
- `invoice.payment_succeeded` → if the subscription was `past_due`/`recovering`, marks `recovered`, mirrors donor `active`, sends a short thank-you email (gated on `recurring_dunning_enabled`). The actual gift/renewal recording is untouched — that's the pre-existing `payment_intent.succeeded` handler, fired separately by Stripe for the invoice's underlying charge; this handler never writes to `gifts`, so there's no double-record risk.
- `customer.subscription.updated` → safety net only: if Stripe's own status flips to `active` while our status is still `past_due`/`recovering` (Stripe's own smart retry resolved it without `invoice.payment_succeeded` landing first), syncs status/logs but does **not** re-send the thank-you (that's `invoice.payment_succeeded`'s job, expected to normally arrive first). Also keeps `amount` in sync on plan changes.
- `customer.subscription.deleted` → marks `canceled` — the "lost" outcome for recovery-rate math. Mirrors donor `stripe_subscription_status='canceled'`.
- `checkout.session.completed` (mode=`setup`) → the donor's card-update flow completing (see below): attaches the new payment method as the subscription's `default_payment_method`, then calls `stripe.invoices.pay()` on the latest open invoice immediately (so updating a card feels instant rather than waiting for Stripe's next scheduled retry) — the resulting `invoice.payment_succeeded` does the recovered/thank-you bookkeeping.

**Dunning engine** — `processDunning()`, module-level async function, same shape as `processSequences()`: runs on startup (`setTimeout`, 5s) and hourly (`setInterval`), also `POST /recurring/process-dunning` (requireAuth + requireAdmin, matches `/sequences/process`). `DUNNING_SCHEDULE_DAYS = [0, 3, 7, 14]` — fixed checkpoints measured from `first_failed_at` (not "N days after the last send"), so the schedule never drifts. Selects `recurring_subscriptions WHERE status IN ('past_due','recovering') AND next_dunning_at <= NOW()`, sends via `sendDunningEmail()` (skips if `recurring_dunning_enabled=false` or the address is suppressed), advances `dunning_step`, computes the next `next_dunning_at` from the schedule. After the final step, `next_dunning_at` is set NULL and Steward stops sending — status stays `recovering` until Stripe's own retries either resolve it (`invoice.payment_succeeded`) or exhaust and cancel it (`customer.subscription.deleted`).

**Donor card-update flow (public, no login)** — `signRecoveryToken(subscriptionId, orgId)`/`verifyRecoveryToken()` mirror `signUnsubscribeToken`/`verifyUnsubscribeToken` exactly (HMAC + `timingSafeEqual`, same pattern). `GET /recurring/update-card?token=...` verifies the token, creates a Stripe Checkout Session in `mode:"setup"` on the connected account, and redirects the donor to it. **Checkout setup mode was chosen over the Stripe Billing Customer Portal** because the Portal requires its own per-connected-account configuration (branding, enabled features) across every one of Steward's connected orgs — not something Steward can provision centrally — while a setup-mode Checkout Session is fully self-contained per request. Success redirects to `/give/:orgSlug?card_updated=true`, which `Donate.jsx` reads the same way it already reads `?donated=true`, showing a "Card updated — thank you!" confirmation (no donor login, no dashboard, no tiers/badges — see "Strategic pivot").

**Staff-facing surface**:
- `GET /dashboard/today` folds any donor with a `past_due`/`recovering` subscription into the same ranked queue (`upsertItem`, priority 85) as a `"Recurring gift failed — $X/mo at risk"` row; its action calls `POST /recurring/:donorId/resend` (requireAuth only, not requireAdmin — matches `POST /note-reminders/:id/send`, the other everyday "queue nudge" any staff member can trigger; doesn't touch `dunning_step`/`next_dunning_at`, so a manual resend never interferes with the automatic cadence).
- `GET /recurring/health` (requireAuth) → `{ activeCount, atRiskCount, mrrAtRisk, recoveredThisMonth, lostThisMonth, recoveryRate }`. Recovery rate = recovered / (recovered + lost) over a trailing 90-day window (`computeRecoveryRate()`), snapshotted daily into `metric_snapshots` (key `recovery_rate`) via the existing `snapshotMetricsForOrg()` — same reusable pattern as `stewardship_debt`/`first_touch_delay`. Dashboard.jsx shows a compact "$X/mo at risk · N donors · recovery rate Y%" card next to the funnel/next-grant tiles.
- `GET /donors/:id/recurring-subscription` (requireAuth) — per-donor health record backing the `DonorProfile` status chip (Active/Payment failed/Recovering/Recovered/Canceled) in the Gifts & Pledges tab, with a "Send card-update link" button when at-risk (isReadOnly-gated like other write buttons).

**Env vars**: `RECOVERY_SECRET` (optional — falls back to the same secret as `JWT_SECRET`/`UNSUB_SECRET` if unset; separated so the two token families can be rotated independently later without sharing a blast radius).

**Production setup required**: the Stripe Connect webhook endpoint must be subscribed to `invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted` for connected accounts — these are new event types this feature depends on; `payment_intent.succeeded`/`checkout.session.completed` already flow, confirming Connect delivery itself is live, but the four above still need to be added to the endpoint's subscribed events in the Stripe dashboard.

Tone/scope guardrails (deliberate): auto-send is correct here (unlike milestone/stewardship drafts, which stay human-reviewed) because failed-payment dunning is transactional and time-sensitive — standard practice, not a stewardship judgment call. No gamification language anywhere in the templates (no "tier"/"level"/"badge"/"leaderboard"); this is a stewardship touch, not a collections notice. No donor-facing dashboard, login, or donor-visible history — donor-side surface is limited to the dunning/thank-you emails and the one-time card-update Checkout session (see "Strategic pivot").
