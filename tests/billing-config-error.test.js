// Billing config-error classification + wiring guard (FIX 2026-07-29).
// Pure Node, no deps, no DB, no Stripe. Run: node tests/billing-config-error.test.js
//
// The class this exists for: a PLATFORM-BILLING key in one Stripe mode
// (sk_test_…) with STRIPE_PRICE_* ids from the OTHER mode. Stripe rejects the
// checkout with `resource_missing` ("a similar object exists in live mode, but a
// test mode key was used") and it used to bubble up as a raw 500 on upgrade.
// Now: the pure classifier tags it, the route returns a typed `plan_mode_mismatch`
// (never a 500), and a boot/health check self-diagnoses it.
//
// This suite proves (1) the pure classifier in stripeKeys.js is correct, and
// (2) server.js is actually WIRED to use it (source grep — the route try/catch,
// the /health billing field, the boot check, the admin diagnostic).

const fs = require("fs");
const path = require("path");
const { billingConfigError, otherBillingMode, billingStripeMode } = require("../stripeKeys");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

// Helper: build a Stripe-shaped error.
const stripeErr = (over = {}) => Object.assign(new Error(over.message || "err"), { type: "StripeInvalidRequestError", statusCode: 400, ...over });

// 1 — Cross-mode (test key + live price) → mode_mismatch.
eq(billingConfigError(stripeErr({
  code: "resource_missing", param: "line_items[0][price]",
  message: "No such price: 'price_1'; a similar object exists in live mode, but a test mode key was used.",
})), { type: "mode_mismatch" }, "cross-mode resource_missing → mode_mismatch");

// 2 — Vice-versa phrasing also mode_mismatch.
eq(billingConfigError(stripeErr({
  code: "resource_missing", param: "price",
  message: "a similar object exists in test mode, but a live mode key was used",
})), { type: "mode_mismatch" }, "reverse cross-mode → mode_mismatch");

// 3 — Message only on `.raw` (SDK nesting) still detected.
eq(billingConfigError(Object.assign(new Error("x"), { raw: {
  code: "resource_missing", param: "price",
  message: "a similar object exists in live mode, but a test mode key was used",
} })), { type: "mode_mismatch" }, "raw-nested cross-mode → mode_mismatch");

// 4 — Genuinely-missing price (typo / deleted, no cross-mode phrase) → price_missing.
eq(billingConfigError(stripeErr({
  code: "resource_missing", param: "line_items[0][price]",
  message: "No such price: 'price_typo'",
})), { type: "price_missing" }, "plain missing price → price_missing");

// 5 — A missing CUSTOMER is NOT a price config error (ensureStripeCustomer self-heals it) → null.
eq(billingConfigError(stripeErr({ code: "resource_missing", param: "customer", message: "No such customer: cus_x" })),
  null, "missing customer → not a billing-config error");

// 6 — Unrelated Stripe/API errors → null (must still 500 / be handled elsewhere).
eq(billingConfigError(stripeErr({ type: "StripeAPIError", statusCode: 500, message: "boom" })), null, "API error → null");
eq(billingConfigError(null), null, "null error → null");
eq(billingConfigError(stripeErr({ code: "card_declined", message: "declined" })), null, "card_declined → null");

// 7 — otherBillingMode + billingStripeMode mapping.
eq(otherBillingMode("test"), "live", "otherBillingMode(test)=live");
eq(otherBillingMode("live"), "test", "otherBillingMode(live)=test");
eq(otherBillingMode(null), null, "otherBillingMode(null)=null");
eq(billingStripeMode("sk_test_abc"), "test", "sk_test → test");
eq(billingStripeMode("rk_test_abc"), "test", "rk_test → test");
eq(billingStripeMode("sk_live_abc"), "live", "sk_live → live");
eq(billingStripeMode("rk_live_abc"), "live", "rk_live → live");

// 8 — server.js is WIRED to the typed handling (source grep guard).
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
ok(/handleBillingConfigError\(err, res, \{ plan, surface: "create-checkout" \}\)/.test(server),
  "create-checkout wraps the Stripe call in handleBillingConfigError");
ok(/handleBillingConfigError\(err, res, \{ surface: "create-portal" \}\)/.test(server),
  "create-portal wraps the Stripe call in handleBillingConfigError");
ok(/error:\s*"plan_mode_mismatch"/.test(server), "route returns typed plan_mode_mismatch (not a 500)");
ok(/error:\s*"plan_not_configured"/.test(server), "route returns typed plan_not_configured");
ok(/error:\s*"portal_not_configured"/.test(server), "portal returns typed portal_not_configured");
ok(/scheduleBillingModeCheck\(\)/.test(server) && /function scheduleBillingModeCheck/.test(server),
  "boot-time billing mode-consistency check is defined and scheduled");
ok(/async function checkBillingPriceModes/.test(server), "checkBillingPriceModes self-diagnosis defined");
ok(/\/admin\/billing-diagnostic/.test(server), "admin billing-diagnostic route present");
ok(/billing:\s*\{ mode: billingModeStatus\.mode/.test(server), "/health exposes the cached billing mode status");
ok(/MODE MISMATCH/.test(server), "loud server log names the mode mismatch");

console.log(`\nbilling-config-error: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
