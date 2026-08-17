// BUILD-63 Part 2 — the Stripe event MANIFEST.
//
// The class BUILD-62 exposed twice: working code wired to nothing. BUILD-58
// built `charge.refunded` reversal and `charge.dispute.*` handling, tested them,
// shipped them — into a production endpoint that subscribes NEITHER, so no event
// will ever reach them. This module declares, per webhook endpoint, exactly the
// event types Steward's handler processes. It is kept honest by
// `tests/webhook-manifest.test.js`, which scans the handler source and FAILS if
// a `case` exists with no manifest entry OR a manifest entry has no `case` — so
// the manifest cannot drift from the handler. `scripts/check-webhook-subscriptions.js`
// and the /health `webhookSubscriptions` counter diff this manifest against the
// LIVE endpoint's subscribed list, so a handled-but-unsubscribed event becomes
// visible instead of silent.
//
// Pure/JSX-free, the stripeKeys.js / billingPlans.js convention.

// The DONATION endpoint (/stripe/webhook, Connect — donations settle on each
// org's connected account). Every event.type the handler dispatches on.
const DONATION_WEBHOOK_EVENTS = [
  "payment_intent.succeeded",
  "checkout.session.completed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

// The PLATFORM BILLING endpoint (/billing/webhook — Steward's own subscription
// revenue on the platform account).
const BILLING_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

// Diff a manifest against a live endpoint's subscribed event list.
//   missing  = handled by the code but NOT subscribed (events that will never
//              arrive — the BUILD-58-into-the-void class).
//   extra    = subscribed but NOT handled (events delivered and silently
//              ignored — noise, and a hint the handler lost a case).
// `*` in a subscribed list means "all events" (Stripe's wildcard) — then
// nothing is missing.
function webhookEventDiff(manifest, subscribed) {
  const sub = new Set(subscribed || []);
  if (sub.has("*")) return { missing: [], extra: [], wildcard: true };
  const man = new Set(manifest || []);
  const missing = [...man].filter(e => !sub.has(e)).sort();
  const extra = [...sub].filter(e => !man.has(e)).sort();
  return { missing, extra, wildcard: false };
}

module.exports = { DONATION_WEBHOOK_EVENTS, BILLING_WEBHOOK_EVENTS, webhookEventDiff };
