// stripeKeys.js — resolves which Stripe SECRET key each integration uses.
//
// Steward talks to Stripe two independent ways that must never share a key:
//   • DONATION processing — connected-account charges + the /stripe/webhook
//     handler. Runs on the org's real money, so STRIPE_SECRET_KEY is a LIVE key.
//   • PLATFORM billing — Steward's own subscription (create-checkout /
//     create-portal / the /billing/webhook subscription lifecycle + the platform
//     Stripe customer). This may run on its OWN key so it can be exercised in
//     Stripe TEST mode (test price ids + test webhook) while donations stay live.
//
// Billing falls back to the donation key when its own is unset, so production
// keeps working with no new env var required.
function donationStripeKey(env = process.env) {
  return env.STRIPE_SECRET_KEY || null;
}
function billingStripeKey(env = process.env) {
  return env.STRIPE_BILLING_SECRET_KEY || env.STRIPE_SECRET_KEY || null;
}
// Stripe mode ("test" | "live") the billing key runs in. A Stripe customer
// created in one mode does NOT exist in the other — reusing a live cus_… under a
// test key (or vice-versa) throws `resource_missing`. So the platform customer
// must be stored per mode; this tells callers which mode is active. Secret and
// restricted keys both encode the mode: sk_test_… / rk_test_… = test, else live.
function billingStripeMode(key) {
  const k = key || billingStripeKey();
  if (!k) return null;
  return /^(sk|rk)_test_/.test(k) ? "test" : "live";
}

// Classify a thrown Stripe error on a PLATFORM-BILLING path (create-checkout /
// create-portal) as a configuration problem so the route can return a typed,
// actionable error instead of letting it bubble up as a raw 500. The class this
// exists for: a billing key in one Stripe mode (e.g. sk_test_…) with a
// STRIPE_PRICE_* id created in the OTHER mode — Stripe rejects it with
// `resource_missing` + "a similar object exists in live mode, but a test mode
// key was used". Returns:
//   { type: "mode_mismatch" } — the price exists, but in the other mode (the
//        cross-mode symptom above) → actionable "align key + prices to one mode".
//   { type: "price_missing" } — a configured price id doesn't resolve at all in
//        this mode (typo/deleted) → still a config problem, not a server bug.
//   null — not a recognizable billing-config error (let it 500 as before).
// Reads `.raw` too because the Stripe SDK nests the real code/param/message there.
function billingConfigError(err) {
  if (!err) return null;
  const raw = err.raw || {};
  const code = err.code || raw.code;
  const statusCode = err.statusCode || raw.statusCode;
  // Concatenate err+raw text — the SDK sometimes carries the real message/param
  // only on `.raw`, so checking one or the other can miss the cross-mode phrase.
  const msg = [err.message, raw.message].filter(Boolean).join(" ");
  const param = [err.param, raw.param].filter(Boolean).join(" ");
  const isResourceMissing = code === "resource_missing" || statusCode === 404;
  if (!isResourceMissing) return null;
  const priceRelated = /price/i.test(param) || /price/i.test(msg);
  if (!priceRelated) return null;                       // customer-missing etc. handled elsewhere
  const crossMode = /similar object exists in (live|test) mode/i.test(msg);
  return { type: crossMode ? "mode_mismatch" : "price_missing" };
}

// The Stripe mode a billing key is NOT in ("test" → "live", "live" → "test").
function otherBillingMode(mode) {
  return mode === "test" ? "live" : mode === "live" ? "test" : null;
}

module.exports = { donationStripeKey, billingStripeKey, billingStripeMode, billingConfigError, otherBillingMode };
