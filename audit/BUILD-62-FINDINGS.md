# BUILD-62 — the live charge that left no trace

**Status:** Part 0 diagnosis complete (below). Root cause named. Fix + proof + reconciliation guard tracked in the sections that follow.

The one-line answer, up front and against expectation: **delivery is not the fault.**
Stripe delivered every event, correctly signed, to a correctly-configured
Connect endpoint, and our server returned `200` to each. The gift was dropped
*inside the handler*, by an event-ordering race that the BUILD-57 CLI-forwarding
drill could never have surfaced. The instinct in the brief ("the likely fault is
in delivery") was the right instinct to check first — and checking it is exactly
what ruled it out.

The drill: a real `$1.00/month` subscription created on CREO's connected account
`the CREO connected account` at **2026-08-17 17:51 UTC** — subscription
`the drill subscription`, customer `the drill customer`, donor
`the demo donor's address (Jonathan's own inbox)`. Steward recorded the *subscription* (`the drill's subscription row`) but
**not the charge**: the roster shows that row at `totalGiven: 0,
linkedGiftCount: 0`. Money moved at Stripe; nothing landed in `gifts`.

---

## PART 0 — the six delivery facts (gathered BEFORE any code change)

### 1. The Stripe delivery log for the live endpoint — DELIVERED, HTTP 200

Railway HTTP logs for the drill window (`nonprofit-erp-production`, prod):

```
2026-08-17T17:51:29.558Z  POST /stripe/webhook  200  523ms
2026-08-17T17:51:29.994Z  POST /stripe/webhook  200  430ms
2026-08-17T17:51:30.541Z  POST /stripe/webhook  200  702ms
```

Three deliveries, all `200`. Stripe **did** attempt delivery, our side
**received** them, and returned success. Corroborated from Stripe's side: every
event on the connected account shows `pending_webhooks: 0` at 13 minutes of age —
and because a 5xx would keep Stripe retrying (elevated `pending_webhooks`) for ~3
days, zero-pending-at-13-minutes can only mean *acknowledged 2xx*. This single
screen splits the problem: **not "no attempt", not "our side 4xx/5xx" — it is a
200 that recorded nothing.** The fault is downstream of delivery and downstream
of signature verification.

The three delivered events (the subscribed ones that fired), by Stripe `created`:

| created | event | type | our result |
|---|---|---|---|
| :51:86 | `the drill's payment_intent.succeeded event` | `payment_intent.succeeded` | **200, gift dropped** |
| :51:88 | `the drill's checkout/invoice event` | `checkout.session.completed` | 200, sub row created |
| :51:88 | `the drill's checkout/invoice event` | `invoice.payment_succeeded` | 200, recovery-only (records no gift by design) |

### 2. Is the live endpoint Connect-enabled? — YES

Endpoint `the live Connect webhook endpoint` → `…/stripe/webhook`, and it carries
`application: the platform Connect application` — it is the platform Connect
application's endpoint and receives events on connected accounts. Proof it is
actually delivering connected-account events (not just configured to): every
drill event lives on the **connected** account `the CREO connected account`, each
delivered event's payload carries `account: "the CREO connected account"`, and
`checkout.session.completed` processed successfully — it resolved the org via
`SELECT id FROM orgs WHERE stripe_account_id = 'the CREO connected account'` and wrote
`recurring_subscriptions` row `the drill's subscription row`. A platform-only endpoint would
have received none of these. **Connect is not the fault.**

### 3. How BUILD-57's test-mode drill delivered webhooks — via the Stripe CLI (`stripe listen`), which bypasses endpoint config AND masks this bug

BUILD-57 §2a drilled the handler with `stripe listen --forward-connect-to
127.0.0.1:<port>/stripe/webhook` (recorded in the dev-stack notes and
`scripts/build58-stripe-drill.js`). That means the test-mode pass:

- **bypassed endpoint configuration entirely** — Connect-enablement, subscribed
  event list, pinned API version, and the live signing secret were never
  exercised (this is the standing lesson, and it holds); **and, the newer and
  sharper finding here —**
- **could never have caught this defect at all.** `stripe listen` forwards
  events over a single local connection, effectively **sequentially**, and lets
  you **re-deliver** a missed event by hand. The production endpoint receives
  events as **concurrent, independent HTTPS POSTs** and never re-delivers a 2xx.
  The bug (below) is an ordering/concurrency race between sibling events — it is
  invisible under sequential, re-deliverable forwarding and only appears against
  a real endpoint taking a real charge. **A CLI-forwarding drill proves the
  handler on one event in isolation and proves nothing about how the handler
  behaves when its sibling events arrive out of order.**

### 4. The endpoint's pinned API version — `2026-04-22.dahlia`

Newer, not older, than the BUILD-57 normalizers were written against — and the
normalizers (`invoiceSubscriptionId` etc.) do read this shape, so nothing is
dead-guarded. But this version is *why* the race has teeth: under
`2026-04-22.dahlia` the `payment_intent.succeeded` payload has **no `invoice`
field at all** (confirmed on the live payload: `pi.invoice` absent,
`pi.customer` present, `pi.metadata` empty, `pi.receipt_email` null). So a
subscription charge's PI can only be tied back to a donor through `pi.customer` →
a local `recurring_subscriptions` row — and that row is created by a *different*
event. See root cause.

### 5. The subscribed event list — the invoice-paid family IS present

`payment_intent.succeeded`, `checkout.session.completed`,
`invoice.payment_failed`, `invoice.payment_succeeded`,
`customer.subscription.updated`, `customer.subscription.deleted`.

`invoice.payment_succeeded` — the recurring-charge event — is subscribed and
fired. Everything needed to record a recurring gift was delivered. **Gaps worth
noting (not the current defect):** `charge.refunded` is *not* subscribed, so a
live refund will not reverse a gift through the webhook (the `charge.refunded`
handler exists but never fires); and `charge.dispute.*` (BUILD-58) is likewise
absent. Both should be added to the endpoint — flagged in §worry.

### 6. The live signing secret — CORRECT (verification is passing)

Every delivery returned `200`, not `400`. `stripe.webhooks.constructEvent` throws
on a bad `whsec_`, and the handler returns `400 {error:"Webhook signature
failed…"}` on that throw (server.js:304-306). There are **no such 400s and no
signature-failure log lines** for this window — which is the finding: the live
`STRIPE_WEBHOOK_SECRET` matches this endpoint, so Steward is *not* rejecting real
events. (I cannot quote rejection logs because there are none to quote.)

---

## ROOT CAUSE (named, before the fix)

**The sole gift-recording anchor for a recurring charge —
`payment_intent.succeeded` — depends on a `recurring_subscriptions` row that a
*sibling* event (`checkout.session.completed`) creates, and Stripe emits the PI
event ~2 seconds BEFORE the checkout event and delivers them concurrently. On a
brand-new subscription the PI handler runs first, finds no subscription row,
cannot resolve the donor, and skips the entire gift path — returning 200, so
Stripe never retries.**

Walking it on the live payloads:

1. `payment_intent.succeeded` (created :51:86) carries `pi.invoice = null`,
   `pi.receipt_email = null`, `pi.metadata = {}`. The handler's `email`
   (`pi.receipt_email || pi.metadata.donor_email`) is therefore empty, so it
   takes the subscription-resolution branch (server.js:343-370). With
   `pi.invoice` gone, the only linkage is
   `SELECT donor_id FROM recurring_subscriptions WHERE stripe_customer_id =
   'cus_V5g3…' AND status <> 'canceled'`.
2. That row is written by `checkout.session.completed` (created :51:88), which
   had **not yet been processed** when the PI handler ran (concurrent delivery;
   the PI POST started at :29.558, the checkout POST at :29.994).
3. Lookup returns zero rows → `subResolvedDonorId` stays null → the guard
   `if ((email || subResolvedDonorId) && accountId)` (server.js:372) is false →
   **no gift, no ledger stamp, no receipt, no email** — and `res.json({received})`
   still returns 200.
4. `checkout.session.completed` then processes, creates `the drill's subscription row`, and
   `invoice.payment_succeeded` processes but — by design (server.js:1032-1034) —
   records no gift, deferring to the PI handler that already gave up.

Net: subscription known, charge invisible. Exactly BUILD-57 §2a
("no recurring charge had ever recorded a gift"), reappearing in live mode
through a concurrency door the test-mode drill held shut.

This is **not** an endpoint-configuration fault. Connect is on, the event list is
right, the API version is handled, the signing secret verifies. The handler is
correct on any *single* event in isolation — it is wrong about the *order* its
own sibling events arrive in. That is precisely the surface a CLI-forwarding
drill cannot reach (fact 3).

### The fix (implemented in Part 1)

Make `payment_intent.succeeded` **self-sufficient**: when a subscription charge
cannot be resolved to a local `recurring_subscriptions` row, resolve the donor
straight from Stripe's own customer object (`stripe.customers.retrieve(
pi.customer)` → email + name) and record the gift. A webhook handler must be
correct regardless of whether its sibling events have been processed yet; it must
never depend on cross-event ordering for a money-recording decision.

---

## Recommendation on the public give pages (Jonathan's call — flagged, not decided)

Monthly is the pre-selected default on every public giving page in production,
and until the fix is deployed **every one of those pages can take a real card and
record nothing** — the exact failure this drill reproduced. The demo orgs' give
pages are publicly reachable and take live cards; no real nonprofit is approved,
so no approved org is exposed, but anyone who finds a URL and gives monthly is
charged with no receipt and no record.

**My recommendation: fix-fast and leave them up** — the fix is small and
surgical, deployable within the hour, and taking the pages down then bringing
them back is more moving parts than shipping the one-handler change and proving
it with a live charge. But the safe alternative — take the public give pages down
until Part 1 is proven on a second live charge — is a legitimate call if you'd
rather carry zero exposure during the window. Your decision; I have not changed
public-page availability either way.

---

## PART 2 — outbound transactional email, verified independently — IT WORKS

Established separately from the gift path (the brief said "do not assume" the
missing receipt is only downstream of the missing gift): I triggered a real
year-end giving statement in production for demo donor Renee Castillo
(`dseed_03`, `a demo-donor alias (Jonathan's own inbox)` — a real inbox) and read the actual
inbox.

- **It arrived.** Receipt `#2026-00009`, `$27,500`, `sent_at
  2026-08-17T18:35:02Z`; the message landed at `18:35:03Z` from
  `noreply@stewardapp.dev`, subject *"Your year-end giving statement from CREO
  Arts"*, branded header "CREO Arts Collective, Inc." — **labelled INBOX (not
  spam), no bounce, no suppression.**
- **`sent` is honest.** `sent_at` is stamped only after Resend accepts the send
  (BUILD-58), and the row carries no error — so the DB "sent" state matches a
  real delivery, and the inbox confirms it.
- **The BUILD-58 fixes hold in prod:** the subject reads "year-end giving
  statement", not "donation receipt"; the body is branded and title-cased.
  Transactional mail ignoring the *marketing* suppression list is pinned at the
  code level by `tests/mail-suppression.test.js` (31, green) — the one caller of
  `getSuppressionReason` is `donorMailDecision`, and transactional kinds never
  consult the opt-out. I did not manipulate a prod suppression row to re-prove
  that live (it would mean writing then unwriting a suppression against a real
  address); the code path is the guarantee.

**Conclusion:** outbound transactional email leaves the building in production.
The drill's missing receipt was **downstream of the missing gift** (no gift → no
receipt → no email), not a second independent bug. "No donor has ever received a
real receipt from Steward" is false — prod receipt/reset mail lands, and this
statement just did.

---

## DEPLOY STATUS (as of this writing)

The fix + reconciliation guard + tests + docs are **committed** (`e393280`) and
the full battery is **green (99 suites, 0 failed)** locally. The push to `main`
— which is what triggers the CI-gated production deploy of both surfaces — was
**held for Jonathan** (the auto-mode guard stopped an autonomous prod deploy of a
live-money webhook change, which is the right place for a human checkpoint).

**To ship it:** push `main` (the pre-push hook re-runs the battery; CI then runs
`deploy-railway` + `deploy-vercel` and SHA-verifies both). Then:
1. **Recover the first $1** — re-deliver the original `payment_intent.succeeded`
   (`the drill's payment_intent.succeeded event`) to endpoint `the live Connect webhook endpoint`
   from the Stripe dashboard (Events → the event → "Resend"), or
   `stripe events resend the drill's payment_intent.succeeded event --webhook-endpoint
   the live Connect webhook endpoint --live`. The `recurring_subscriptions` row
   (`the drill's subscription row`) now exists, so the handler will resolve the donor and record
   the gift — no re-charge. Confirm the roster shows `totalGiven 1` and the donor
   profile/portal totals move by $1, and the receipt emails.
2. **Prove the race fix** with the fresh live charge in `BLOCKED-build62-verify.md`.

Backfill capability: **Steward has no built-in "backfill a missed charge"
mechanism** — the only path to record a charge the webhook missed is to
re-deliver its Stripe event (which the handler then records) or, failing that,
log it by hand. This is itself a finding: the reconciliation guard (Part 3) now
*detects* a missed charge, but there is no one-click *reconcile-and-record*
action. Re-delivery is the reconcile-from-Stripe path; it works because the
handler is idempotent on the PI id. A future build could turn a
`charge_without_gift` divergence into a button that re-delivers or synthesizes
the gift from the Stripe charge.

## PART 5 — the two small things in the same screenshot

1. **The Harbor "placeholder art" is stale PROD DEMO DATA, not client-generated
   art.** A code search found *no* generator anywhere in the client — nothing
   draws a "blue panel with a circle and square." The abstract shapes are a
   **seeded placeholder SVG sitting in an impact update's `photos`**, rendered as
   an ordinary `<img>`. This is the exact BUILD-54 §4 issue ("demo photos were
   flat-color `<rect>` SVGs"), whose **prod fix
   (`scripts/fix-build54-demo-photos.js` + a prod `seed-build54` re-run) was
   classifier-blocked and never applied to prod** (documented in the memory as
   Jonathan's pending step). So the durable fix is two parts:
   - **Data (ops, Jonathan):** run `scripts/fix-build54-demo-photos.js` against
     prod (and re-seed) to replace every placeholder-SVG "photo" with a real
     committed photo or nothing. This removes the visible abstract shapes.
   - **Render (done, this build):** `ImpactCard` (GivingDashboard.jsx) now gives
     a **photoless** impact update the *designed* no-image treatment — a solid
     band in the org's own color carrying its logo or monogram (the same
     fallback `TakeoverHeader` already ships), **never generated art**. So once
     the placeholder data is gone, those updates degrade to the correct band
     instead of a bare card. Lint-clean, brand-allowlist-clean; the exact colors
     reuse the shipped takeover pattern. (Visual capture is deploy-gated — the
     `/giving` surface needs a linked donor account + the demo data; verified by
     construction against the existing pattern.)
   - **Leak check:** the same placeholder-SVG class can sit in campaign heroes
     and theme header/logo slots — `fix-build54-demo-photos.js` already covers
     those rows; running it in prod is the sweep.

2. **The cross-org dashboard rendered the same update twice — FIXED.** An org can
   publish two updates with the same title, one TARGETED to a fund the donor gave
   to (which carries the photo) and one ORG-WIDE (photoless), and
   `matchImpactUpdates` returned both, so the story rendered twice on the donor's
   home surface — once with the photograph, once as the photoless placeholder.
   `GET /account/dashboard` now **dedups the merged feed by (org, normalized
   title), keeping the richest entry** (a photo'd one beats a photoless one, then
   a matched one, then the most recent). Pinned by `tests/donor-dashboard.test.js`
   (same-title twin → one card, and it's the photo'd one). This also means the
   photoless placeholder twin is dropped in favour of the real photo even before
   the data fix runs.

---

## §worry

- **The reconciliation guard (Part 3) is the real insurance, not the handler
  fix.** Money moved at Stripe and left no trace in Steward, and *nothing
  noticed* — for the second time in two modes, both times found by a human
  reading a page. The class is bigger than this one race. Until Part 3 is live
  and paging, the next silent divergence is again only as visible as whoever
  happens to open the portal.
- **`charge.refunded` and `charge.dispute.*` are not subscribed on the live
  endpoint.** The handlers exist and are tested, but they can never fire in
  production. A live refund will not reverse a gift; a live dispute will not flag
  one. Add both event types to `the live Connect webhook endpoint` (and confirm the
  reconciliation guard would catch a stuck refund in the meantime).
- **Attribution on a raced first charge is best-effort.** The fix records the
  money unconditionally (the important thing), but if the `recurring_subscriptions`
  row genuinely isn't present yet, the first gift's fund/campaign designation and
  its `recurring_subscription_id` link can be null until the row exists. In this
  drill the designation was empty anyway (`fund_id: ""` in the checkout metadata),
  so nothing was lost — but a fund-designated first gift that loses the race would
  land undesignated. The reconciliation guard should treat "gift with no
  subscription link" as a soft signal to re-attribute, not just record-vs-charge.
