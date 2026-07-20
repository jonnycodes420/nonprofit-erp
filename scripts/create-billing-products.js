#!/usr/bin/env node
// BUILD-24 — provision Steward's PLATFORM billing products/prices in Stripe.
//
// Creates the Core ($149/mo) and Team ($299/mo) recurring products/prices, the
// private founding-partner $99/mo price (Core tier, off-menu), and a founding
// coupon (34% off Core → $99) so you have both levers in the dashboard. Then
// prints the env lines to paste into Railway (or your .env).
//
// This is the PLATFORM account only (Steward charging orgs). It does NOT touch
// donation processing (each org's own connected account). It is the credentialed
// step the build brief calls out — run it yourself with a TEST key first.
//
// SAFE: idempotent. Products are tagged metadata.steward_plan; a re-run reuses an
// existing product/price with the same plan+amount+interval instead of making a
// duplicate. Refuses to run against a live key unless --live is passed.
//
// Usage (TEST first — always). Prefers STRIPE_BILLING_SECRET_KEY (the platform-
// billing key), falling back to STRIPE_SECRET_KEY — so it provisions prices with
// the SAME key the running server's billing client uses:
//   STRIPE_BILLING_SECRET_KEY=sk_test_… node scripts/create-billing-products.js
//   # then paste the printed STRIPE_PRICE_* lines into your env and redeploy
//
// Go-live (only after the full test-mode flow is green):
//   STRIPE_BILLING_SECRET_KEY=sk_live_… node scripts/create-billing-products.js --live

const { billingStripeKey } = require("../stripeKeys");
const key = billingStripeKey();
if (!key) { console.error("Set STRIPE_BILLING_SECRET_KEY (or STRIPE_SECRET_KEY) — use a sk_test_… key first."); process.exit(1); }
const isLive = key.startsWith("sk_live");
if (isLive && !process.argv.includes("--live")) {
  console.error("Refusing to run against a LIVE key without --live. Provision + verify in TEST mode first.");
  process.exit(1);
}

const stripe = require("stripe")(key);

// plan → { product name/desc, unit amount cents, tier }
const PLANS = [
  { plan: "core", name: "Steward — Core", desc: "Full donor CRM + 0%-fee giving for a small development team.", amount: 14900, tier: "core" },
  { plan: "team", name: "Steward — Team", desc: "Everything in Core plus moves management, officer portfolios, and per-officer reporting.", amount: 29900, tier: "team" },
  { plan: "founding", name: "Steward — Founding Partner", desc: "Private founding-partner price (Core tier). Off-menu.", amount: 9900, tier: "core" },
];

async function findProduct(plan) {
  // Search by our metadata marker (Stripe product search is available on both
  // test and live). Fall back to listing if search isn't enabled.
  try {
    const r = await stripe.products.search({ query: `metadata['steward_plan']:'${plan}' AND active:'true'`, limit: 1 });
    if (r.data.length) return r.data[0];
  } catch {
    const all = await stripe.products.list({ active: true, limit: 100 });
    const hit = all.data.find(p => p.metadata?.steward_plan === plan);
    if (hit) return hit;
  }
  return null;
}

async function findPrice(productId, amount) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return prices.data.find(p => p.unit_amount === amount && p.recurring?.interval === "month") || null;
}

async function ensurePlan({ plan, name, desc, amount, tier }) {
  let product = await findProduct(plan);
  if (!product) {
    product = await stripe.products.create({ name, description: desc, metadata: { steward_plan: plan, steward_tier: tier } });
    console.log(`  created product ${product.id} (${plan})`);
  } else {
    console.log(`  reused product ${product.id} (${plan})`);
  }
  let price = await findPrice(product.id, amount);
  if (!price) {
    price = await stripe.prices.create({
      product: product.id, unit_amount: amount, currency: "usd",
      recurring: { interval: "month" }, metadata: { steward_plan: plan },
    });
    console.log(`  created price   ${price.id} ($${amount / 100}/mo)`);
  } else {
    console.log(`  reused price    ${price.id} ($${amount / 100}/mo)`);
  }
  return price.id;
}

async function ensureFoundingCoupon() {
  // 34% off Core ($149 → ~$98.34) — an alternative lever to the dedicated $99
  // price. Idempotent by a fixed id.
  const id = "steward_founding_34off";
  try {
    const existing = await stripe.coupons.retrieve(id);
    console.log(`  reused coupon   ${existing.id} (${existing.percent_off}% off)`);
    return existing.id;
  } catch {
    const c = await stripe.coupons.create({ id, percent_off: 34, duration: "forever", name: "Founding Partner", metadata: { steward_plan: "founding" } });
    console.log(`  created coupon  ${c.id} (34% off, forever)`);
    return c.id;
  }
}

(async () => {
  console.log(`Provisioning Steward platform billing in ${isLive ? "LIVE" : "TEST"} mode…\n`);
  const out = {};
  out.STRIPE_PRICE_CORE     = await ensurePlan(PLANS[0]);
  out.STRIPE_PRICE_TEAM     = await ensurePlan(PLANS[1]);
  out.STRIPE_PRICE_FOUNDING = await ensurePlan(PLANS[2]);
  await ensureFoundingCoupon();

  console.log(`\nDone. Paste these into your ${isLive ? "PRODUCTION (Railway)" : "env"}:\n`);
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
  console.log(`\nAlso set STRIPE_BILLING_WEBHOOK_SECRET from the webhook endpoint's signing secret.`);
  console.log(`Founding coupon id: steward_founding_34off (apply to a Core checkout in the Dashboard).`);
})().catch(e => { console.error("Failed:", e.message); process.exit(1); });
