#!/usr/bin/env node
// BUILD-63 Part 2 — check-webhook-subscriptions (READ-ONLY, prod-flagged).
//
// Diffs the Stripe event MANIFEST (stripeEvents.js, kept honest against the
// handler by tests/webhook-manifest.test.js) against the LIVE endpoint's
// subscribed event list. It REPORTS; it never modifies anything at Stripe.
//
//   node scripts/check-webhook-subscriptions.js
//       → prints the manifest and refuses to touch prod. No Stripe contact.
//   node scripts/check-webhook-subscriptions.js --i-know-this-is-prod
//       → lists the live webhook endpoints and prints, per endpoint, the events
//         handled-but-not-subscribed (`missing` — code wired to nothing) and
//         subscribed-but-not-handled (`extra`).
//
// The live key comes from STRIPE_SECRET_KEY, else the Stripe CLI's live key
// (~/.config/stripe/config.toml). The key is never printed.
// Classified PROD_READONLY in tests/script-guards.test.js.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { DONATION_WEBHOOK_EVENTS, BILLING_WEBHOOK_EVENTS, webhookEventDiff } = require("../stripeEvents");

const PROD = process.argv.includes("--i-know-this-is-prod");
const MANIFESTS = [
  { route: "/stripe/webhook", label: "DONATION (Connect)", manifest: DONATION_WEBHOOK_EVENTS },
  { route: "/billing/webhook", label: "PLATFORM BILLING", manifest: BILLING_WEBHOOK_EVENTS },
];

function liveKey() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), ".config", "stripe", "config.toml"), "utf8");
    const m = toml.match(/live_mode_api_key\s*=\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  } catch { /* no CLI config */ }
  return null;
}

(async () => {
  if (!PROD) {
    console.log("check-webhook-subscriptions — DRY (no prod contact).\n");
    console.log("The event manifest Steward's handler processes (pinned to the handler by");
    console.log("tests/webhook-manifest.test.js):\n");
    for (const { route, label, manifest } of MANIFESTS) {
      console.log(`  ${label}  (${route})`);
      for (const e of manifest) console.log(`      ${e}`);
      console.log("");
    }
    console.log("Re-run with --i-know-this-is-prod to diff this against the LIVE endpoint's");
    console.log("subscribed event list (read-only — reports, never modifies).");
    process.exit(0);
  }

  // Prefer the SDK (prod sets STRIPE_SECRET_KEY = the full sk_live secret). The
  // Stripe CLI's restricted key is not accepted by the SDK, so fall back to the
  // authenticated CLI binary (read-only `list`) when the SDK can't authenticate.
  let eps = null;
  const key = liveKey();
  if (key) {
    try {
      const Stripe = require("stripe");
      eps = await new Stripe(key).webhookEndpoints.list({ limit: 100 });
    } catch (e) { console.error(`SDK list failed (${e.message}); trying the Stripe CLI…`); }
  }
  if (!eps) {
    try {
      const { execFileSync } = require("child_process");
      const out = execFileSync("stripe", ["webhook_endpoints", "list", "--live", "--limit", "100"], { encoding: "utf8" });
      eps = JSON.parse(out);
    } catch (e) { console.error("Could not list webhook endpoints via SDK or CLI:", e.message); process.exit(1); }
  }

  console.log(`Live webhook endpoints found: ${(eps.data || []).length}\n`);
  let totalMissing = 0;
  for (const { route, label, manifest } of MANIFESTS) {
    const ep = (eps.data || []).find(e => typeof e.url === "string" && e.url.endsWith(route) && e.status !== "disabled");
    console.log(`── ${label}  (${route}) ─────────────────────────────`);
    if (!ep) {
      console.log(`  NO ENABLED ENDPOINT points at ${route} — all ${manifest.length} handled events are unreachable:`);
      for (const e of manifest) console.log(`      MISSING  ${e}`);
      totalMissing += manifest.length;
      console.log("");
      continue;
    }
    console.log(`  endpoint ${ep.id}  (${ep.url})  api_version=${ep.api_version || "account default"}`);
    const diff = webhookEventDiff(manifest, ep.enabled_events || []);
    if (diff.wildcard) { console.log("  subscribes ALL events (*) — nothing missing."); console.log(""); continue; }
    if (!diff.missing.length && !diff.extra.length) console.log("  ✓ subscription EXACTLY matches the manifest.");
    for (const e of diff.missing) console.log(`      MISSING (handled, not subscribed — code wired to nothing):  ${e}`);
    for (const e of diff.extra) console.log(`      EXTRA   (subscribed, not handled — delivered then ignored):  ${e}`);
    totalMissing += diff.missing.length;
    console.log("");
  }
  console.log(`TOTAL handled-but-unsubscribed event types: ${totalMissing}`);
  console.log(totalMissing > 0
    ? "→ Add the MISSING events to the endpoint's subscribed list in the Stripe dashboard."
    : "→ Clean: every handled event is subscribed.");
  process.exit(0);
})();
