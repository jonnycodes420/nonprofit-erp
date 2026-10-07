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

// ── FIX-32. ONE PLAN, EVERYTHING INCLUDED: no lock, no upgrade CTA ────────
// A cancelled trial was rewritten to plan='core' and its donor profile came
// back frosted over with "A Team-plan feature / Unlock with Team: See plans".
// There is no Core and no Team any more, so no client file may draw that lock
// or route to it. Every source under client/src is read, not a chosen few.
const clientFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) clientFiles.push(path.relative(path.join(__dirname, ".."), full));
  }
})(path.join(__dirname, "..", "client", "src"));
const BANNED = [
  ["LockedFeature", /\bLockedFeature\b/],
  ["goToPricing", /\bgoToPricing\b/],
  ["Unlock with Team", /Unlock with Team/],
  ["A Team-plan feature", /Team-plan feature/],
  ["plan_required", /plan_required/],
  ["planLocks", /\bplanLocks\b/],
  ["TEAM_GATED / CORE_HIDDEN_TABS", /\b(TEAM_GATED|CORE_HIDDEN_TABS)\b/],
  ["CHECKOUT_PLANS (the retired Core $249 / Team $499 list)", /\bCHECKOUT_PLANS\b/],
];
for (const [label, re] of BANNED) {
  const hits = clientFiles.filter(f => re.test(read(f)));
  ok(hits.length === 0, `no client source carries ${label} (found in: ${hits.join(", ")})`);
}
// The plan picker offers pricing.json's bands and nothing else.
const picker = read("client/src/components/PlanPicker.jsx");
ok(/import PRICING from "\.\.\/\.\.\/\.\.\/pricing\.json"/.test(picker) && /PRICING\.tiers\.map/.test(picker),
   "PlanPicker renders pricing.json's tiers");
ok(!/\b(Core|Team)\b/.test(picker) && !/\b249\b/.test(picker), "PlanPicker names no Core, no Team and no $249");
// Server: no route is gated on a tier any more (only the Portal tier, which is
// not the CRM, is refused the CRM).
const serverAll = ["server.js", ...fs.readdirSync(path.join(__dirname, "..", "routes")).filter(f => f.endsWith(".js")).map(f => "routes/" + f)]
  .map(f => read(f)).join("\n");
ok(!/requirePlan\(/.test(serverAll), "no server route is wrapped in requirePlan()");
ok(!/"plan_required"/.test(serverAll), "the server never answers plan_required");

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
// FIX-4 6 — the button names the PLAN now ("Choose Sapling"), because the
// approved section gives every band a name and "this band" was the phrasing
// of the page that had none. Still the same assertion: an authed org that is
// not already on a band gets a checkout button, not a dead card.
ok(/Choose\s*" \+ t\.name|Choose \$\{t\.name\}|"Choose " \+ t\.name/.test(pricing),
   "authed non-current bands get a checkout label naming the plan");

// GTM-1a — the two public actions, side by side, and the one sentence that
// defines the thing the price is charged on.
ok(/data-testid="pricing-start"/.test(pricing) && /Start now/.test(pricing), "the page's primary action is Start now");
ok(/data-testid="pricing-book"/.test(pricing) && /Book a call/.test(pricing), "…beside Book a call");
ok(/activeDonorSentence/.test(pricing), "…and the page renders the one sentence that defines an active donor");

// ── Founding stays off-menu (never rendered on the public pricing page) ────
ok(!/id:\s*"founding"/.test(pricing), "the founding-partner plan is NOT surfaced on the pricing page");

// ── App.jsx: a trialing org never sees Reactivate (FIX-32) ────────────────
// The trial banner points at Settings, Billing; a trial cancelled inside its
// thirty days says when it ends and offers "Keep Steward", never Reactivate.
const trialBanner = (app.match(/\{showTrialBanner&&<div[\s\S]*?<\/div>\}/) || [""])[0];
ok(trialBanner && !/Reactivate|setShowPlanPicker/.test(trialBanner), "the trial banner carries no Reactivate and no plan picker");
const cancelledTrial = (app.match(/\{billing\?\.trialCanceled&&<div[\s\S]*?<\/div>\}/) || [""])[0];
ok(/trialCanceledSentence/.test(cancelledTrial) && /Keep Steward/.test(cancelledTrial) && !/Reactivate|setShowPlanPicker/.test(cancelledTrial),
   "a trial cancelled inside the thirty days shows its end date and Keep Steward, not Reactivate");

// ── App.jsx: return handling for a completed checkout ──────────────────────
ok(/params\.get\("subscribed"\)\s*===\s*"true"/.test(app), "App reads ?subscribed=true on return from Stripe");
ok(/subscribed"[\s\S]{0,400}\/billing\/status/.test(app), "on ?subscribed it refetches /billing/status so the new tier appears once the webhook lands");
ok(has(app, "Finishing up"), "the return shows a graceful 'finishing up' acknowledgment");

// ── Backend: checkout success/cancel URLs support the return flow ──────────
ok(/success_url:[\s\S]{0,120}\/dashboard\?subscribed=true/.test(server), "create-checkout success_url returns to /dashboard?subscribed=true");
ok(/cancel_url:[\s\S]{0,120}\/pricing/.test(server), "create-checkout cancel_url returns to the /pricing page");

console.log(`\nupgrade-checkout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
