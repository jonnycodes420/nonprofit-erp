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
module.exports = { donationStripeKey, billingStripeKey, billingStripeMode };
