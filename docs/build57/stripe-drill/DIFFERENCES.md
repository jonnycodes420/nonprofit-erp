# BUILD-57 §2a — What the mocks asserted vs. what Stripe actually sent

Three builds of recurring plumbing (BUILD-45 §4, BUILD-55, BUILD-56) were
proven entirely against a local Stripe mock. This drill ran the full lifecycle
against **real Stripe test mode with real webhook signatures via `stripe
listen`** (CLI API version 2026-04-22.dahlia, connected account
`acct_1U5C5W5gHebhPhE3`, org `org_e8584cf6` on the scratch stack):

> create (Checkout, 4242, fund-designated) → gift+ledger+designation →
> increase (donor-completed proposal) → renewal-shaped charge → decrease →
> pause → resume → real card failure (`tok_chargeCustomerFail`) → dunning
> email → card-update setup-Checkout → recovery + gift → cancel → full refund
> reversal → webhook replay → out-of-order redelivery → server-down recovery.

Every difference found, worst first. **1–7 were fixed in this build** (each
now pinned by `tests/recurring-surface.test.js` §6 where a mock can express
it); 8–10 are operational notes.

## 1. A real subscription charge's PaymentIntent has NO email and NO metadata
The handler's first line was `email = pi.receipt_email || pi.metadata?.donor_email`
— and every mock fixture set one of those. Real subscription PIs are
INVOICE-generated: both fields are empty (they ride the checkout session /
one-time `payment_intent_data` only). So on real Stripe **no recurring charge
— first or renewal — ever recorded a gift, ledger stamp, or donor total.**
The entire renewal-attribution chain (BUILD-55/56) sat behind a guard real
subscription events never passed. Prod never noticed because no real
recurring donor has ever renewed in prod (the only webhook-era gift is a $1
one-time smoke test).
**Fix:** when the email is absent, resolve the donor through the invoice →
subscription → `recurring_subscriptions` row, else through `pi.customer` →
unique non-canceled subscription (never mis-assign; ambiguity resolves
nothing).

## 2. API 2025+: `invoice.subscription` no longer exists on event payloads
It moved to `invoice.parent.subscription_details.subscription` (the
subscription's metadata beside it). Every invoice-keyed handler —
`invoice.payment_failed` (the ENTIRE failed-card recovery family, the
product's headline claim) and `invoice.payment_succeeded` (recovered
bookkeeping, thank-you, auto-resume) — guarded on the old field and became a
silent no-op. Server-side *retrieves* still return old shapes (stripe-node
pins its own API version); only *webhook payloads* ride the endpoint/CLI
version. **Prod risk depends on the dashboard webhook endpoint's pinned API
version — check it before the live drill.**
**Fix:** `invoiceSubscriptionId()` / `invoiceSubMetadata()` /
`invoiceLineInterval()` normalizers read both generations.

## 3. API 2025+: the PaymentIntent event has NO `invoice` field at all
`pi.customer` is the only remaining linkage from a subscription charge back
to its subscription. **Fix:** the stored `stripe_customer_id` (stamped at
checkout since BUILD-45) resolves it — unique non-canceled sub or nothing.

## 4. `customer.subscription.updated` does NOT fire at creation, and
`current_period_end` moved onto the subscription ITEMS
The roster's "next charge" stayed NULL until some later mutation. **Fix:**
sync `current_period_end` from the invoice line's `period.end` in
`invoice.payment_succeeded` (fires every cycle including the first), plus an
items-level fallback in `subscription.updated`.

## 5. Repricing a Checkout-born subscription was impossible
Two compounding facts the mock hid: (a) `subscriptions.update` rejects
`price_data.product_data` — that sugar is Checkout-only; it needs `product`
(an id). (b) The product Checkout auto-creates is **inactive AND immutable**
("created by Stripe automatically and cannot be updated") — no new price can
ever attach to it. So the BUILD-45 portal reprice (R-1) and the BUILD-57
proposal reprice had **never once worked against real Stripe**.
**Fix:** `ensureRecurringGiftProduct()` — one durable metadata-tagged product
per connected account (search, create-on-miss), used by both reprice sites.

## 6. stripe-node two-arg options bug: `retrieve(id, { stripeAccount })`
sends `stripeAccount` as a QUERY PARAM (this lib version doesn't auto-detect
options in params position) → `Received unknown parameter: stripeAccount`.
The setup-mode card-update completion (attach new PM + pay the open invoice
NOW — what makes recovery feel instant) had never executed; five other call
sites had the same latent bug. **Fix:** explicit 3-arg form at all six sites.

## 7. Event ORDER: `customer.subscription.updated` arrives BEFORE
`invoice.payment_succeeded` on recovery
The code comment said the invoice event "normally arrives first" — reality is
inverted. The safety-net branch won the past_due→recovered flip every time,
and the "primary" branch (recovered thank-you email + movement-ledger row)
was starved. **Fix:** whichever branch flips the status does the full job.

## 8. Checkout completion emits its three events in one burst
(`checkout.session.completed`, `payment_intent.succeeded`,
`invoice.payment_succeeded`) with no ordering promise. The handlers held up
under both observed orders; keep them order-independent.

## 9. `stripe events resend` does NOT route through `stripe listen`
Missed events during CLI-forwarded testing need manual signed redelivery
(fetch the event JSON, HMAC with the listen secret). Real dashboard endpoints
get Stripe's own automatic retries — the CLI does not retry a failed POST.
Drilled: server killed mid-refund → event lost by listen → manual redelivery
after restart → reversal applied exactly once (replay converged,
`duplicate:true`).

## 10. Replay / out-of-order guarantees held
Re-delivering a processed `payment_intent.succeeded` → strict no-op. Stale
`invoice.payment_failed` re-delivered AFTER recovery → no state regression
(event-id dedup). The BUILD-37 D-series assumptions held here — with the
caveat that they only matter once differences 1–2 let the handlers run at
all.

## What was proven end-to-end after the fixes
- Designated recurring gift via real Checkout → `recurring_subscriptions` row
  with `fund_id`; first charge recorded as a gift with the designation on the
  gift AND its ledger stamp.
- Renewal-shaped charge (out-of-cycle subscription invoice) → gift linked to
  the subscription, designation intact on gift + ledger.
- Proposal increase AND decrease completed by the donor → real Stripe price
  changed ($15→$25→$18 verified via the Stripe API), movement ledger
  `amount_up/amount_down(donor)`, no double-log when the subsequent
  `subscription.updated` echo arrives.
- Staff pause / resume / cancel → real `pause_collection` and
  `cancel_at_period_end` verified at Stripe; unsuppressible donor emails
  captured at the sink.
- Real card failure → health record minted from the new-shape event → dunning
  email with working card-update link → real setup-Checkout completion →
  attach + pay-now → recovered, gift recorded and subscription-linked.
- Full refund → gift + ledger reversed, donor totals recomputed.
