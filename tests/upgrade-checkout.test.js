// Upgrade path FIX — CTAs → in-app /pricing → Stripe Checkout → webhook flips tier.
//
// Pure Node source analysis (no React runner exists in this repo — same
// pattern as locked-features.test.js / pipeline-gating.test.js). The LIVE
// checkout + webhook lifecycle is exercised end-to-end in billing.test.js;
// this file guards the WIRING so a future edit can't quietly re-route an
// upgrade CTA back to Settings, or leave a pricing-page plan button as a
// dead "go to workspace" link that never reaches Stripe.
//
// Run: node tests/upgrade-checkout.test.js

const fs = require("fs");
const path = require("path");
const { readSource } = require("../scripts/lib/readSource");
const read = p => readSource(p);
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const has = (s, n) => s.includes(n);

const shared   = read("client/src/components/shared.jsx");
const pipeline = read("client/src/components/Pipeline.jsx");
const reports  = read("client/src/components/Reports.jsx");
const donors   = read("client/src/components/Donors.jsx");
const pricing  = read("client/src/pages/Pricing.jsx");
const app      = read("client/src/App.jsx");
const server   = read("server.js");

// ── The one upgrade destination (shared.jsx) ───────────────────────────────
ok(/export const goToPricing\s*=/.test(shared), "shared.jsx exports goToPricing()");
ok(/goToPricing[\s\S]{0,80}window\.location\.href\s*=\s*"\/pricing"/.test(shared), "goToPricing navigates to the /pricing page");

// ── Upgrade CTAs route to the pricing page, NOT to Settings ────────────────
for (const [name, src] of [["Pipeline", pipeline], ["Reports", reports], ["Donors", donors]]) {
  ok(/import\s*\{[^}]*goToPricing/.test(src), `${name} imports goToPricing`);
  ok(/onCta=\{goToPricing\}/.test(src), `${name} LockedFeature onCta = goToPricing (not onNavigate("settings"))`);
  ok(!/onCta=\{\(\)\s*=>\s*onNavigate\s*&&\s*onNavigate\("settings"\)\}/.test(src) &&
     !/onCta=\{onNavigate\?\(\)=>onNavigate\("settings"\):undefined\}/.test(src),
     `${name}'s old "go to Settings" CTA is gone`);
}

// ── Pricing page starts a REAL Stripe Checkout for the chosen plan ─────────
ok(/import\s*\{\s*apiFetch\s*\}\s*from\s*"\.\.\/api"/.test(pricing), "Pricing imports apiFetch");
// GTM-1a — there is ONE plan now, in three BANDS, so the page iterates
// `TIERS` and the handler takes a tier id plus a cadence rather than a plan
// object. Every behaviour below is the same behaviour; only the noun changed.
// What must not change, and is what this block is actually for: the button
// starts a REAL Checkout, the browser is sent to Stripe's URL, an org sees
// which band it is already on instead of a button that re-buys it, the
// button says it is working, and a configuration failure is a sentence
// rather than a dead button.
ok(/async function startCheckout\(tierId\)/.test(pricing), "Pricing has a startCheckout(tierId) handler");
ok(/apiFetch\("\/billing\/create-checkout",\s*\{[\s\S]{0,120}plan:\s*`\$\{tierId\}_\$\{interval\}`/.test(pricing),
   "startCheckout POSTs /billing/create-checkout with the band AND the cadence");
ok(/window\.location\.href\s*=\s*r\.url/.test(pricing), "startCheckout redirects the browser to the returned Stripe URL");
ok(/startCheckout\(t\.id\)/.test(pricing), "the band button calls startCheckout(t.id)");

// ── Plan-aware button states: current-plan handled, loading + honest errors ─
ok(/const\s+currentTier\s*=/.test(pricing) && /subActive/.test(pricing),
   "Pricing computes the current band (only an ACTIVE sub counts as current)");
ok(has(pricing, "Your current plan"), "the org's active band says so (not a re-checkout button)");
ok(/checkingOut\s*===\s*t\.id/.test(pricing), "the button reflects an in-flight (loading) state per band");
ok(has(pricing, "plan_not_configured") || /No Stripe price/i.test(pricing), "a failed create-checkout shows a clean message, never a dead button");
ok(/Choose this band/.test(pricing), "authed non-current bands get a checkout label");

// GTM-1a — the two public actions, side by side, and the one sentence that
// defines the thing the price is charged on.
ok(/data-testid="pricing-start"/.test(pricing) && /Start now/.test(pricing), "the page's primary action is Start now");
ok(/data-testid="pricing-book"/.test(pricing) && /Book a call/.test(pricing), "…beside Book a call");
ok(/activeDonorSentence/.test(pricing), "…and the page renders the one sentence that defines an active donor");

// ── Founding stays off-menu (never rendered on the public pricing page) ────
ok(!/id:\s*"founding"/.test(pricing), "the founding-partner plan is NOT surfaced on the pricing page");

// ── App.jsx: trial banner → pricing page (not the empty Customer Portal) ───
ok(/import\s*\{[^}]*goToPricing/.test(app), "App imports goToPricing");
ok(/onClick=\{goToPricing\}[\s\S]{0,220}(Choose a plan|Upgrade now)/.test(app),
   "the trial banner 'Choose a plan / Upgrade now' routes to the pricing page (was openPortal → empty Portal)");

// ── App.jsx: return handling for a completed checkout ──────────────────────
ok(/params\.get\("subscribed"\)\s*===\s*"true"/.test(app), "App reads ?subscribed=true on return from Stripe");
ok(/subscribed"[\s\S]{0,400}\/billing\/status/.test(app), "on ?subscribed it refetches /billing/status so the new tier appears once the webhook lands");
ok(has(app, "Finishing up"), "the return shows a graceful 'finishing up' acknowledgment");

// ── Backend: checkout success/cancel URLs support the return flow ──────────
ok(/success_url:[\s\S]{0,120}\/dashboard\?subscribed=true/.test(server), "create-checkout success_url returns to /dashboard?subscribed=true");
ok(/cancel_url:[\s\S]{0,120}\/pricing/.test(server), "create-checkout cancel_url returns to the /pricing page");

console.log(`\nupgrade-checkout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
