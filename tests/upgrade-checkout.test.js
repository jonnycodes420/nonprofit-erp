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
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
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
ok(/async function startCheckout\(planId\)/.test(pricing), "Pricing has a startCheckout(planId) handler");
ok(/apiFetch\("\/billing\/create-checkout",\s*\{\s*method:\s*"POST",\s*body:\s*JSON\.stringify\(\{\s*plan:\s*planId\s*\}\)/.test(pricing),
   "startCheckout POSTs /billing/create-checkout with the plan id");
ok(/window\.location\.href\s*=\s*r\.url/.test(pricing), "startCheckout redirects the browser to the returned Stripe URL");
ok(/startCheckout\(plan\.id\)/.test(pricing), "the plan button calls startCheckout(plan.id)");

// ── Plan-aware button states: current-plan handled, loading + honest errors ─
ok(/isCurrentPlan\s*=\s*\(id\)\s*=>/.test(pricing), "Pricing computes isCurrentPlan (only an ACTIVE sub counts as current)");
ok(has(pricing, "Current plan"), "the org's active plan shows a 'Current plan' state (not a re-checkout button)");
ok(/checkingOut\s*===\s*plan\.id/.test(pricing), "the button reflects an in-flight (loading) state per plan");
ok(has(pricing, "plan_not_configured") || /No Stripe price/i.test(pricing), "a failed create-checkout shows a clean message, never a dead button");
ok(/Upgrade to Team|Choose \$\{plan\.name\}/.test(pricing), "authed non-current plans get a Choose/Upgrade checkout label");

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
