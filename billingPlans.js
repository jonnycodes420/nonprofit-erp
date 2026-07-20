// billingPlans.js — maps a Stripe subscription to our plan value.
//
// Extracted as a pure module (like stripeKeys.js) so the price→plan logic is
// unit-testable without booting the Express app or hitting live Stripe.
//
// The subtle case this exists for: a Customer-Portal plan switch (Core ↔ Team)
// changes the subscription's PRICE but NOT its metadata.plan — that field was
// stamped once at checkout and goes stale. So the `customer.subscription.updated`
// webhook must read the plan off the live price, falling back to metadata only
// when the price isn't one we recognize (e.g. checkout, where metadata is set).

// Plan values a subscription may set. Core/Team are the live commercial model;
// seed/growth/impact are legacy (recognized for back-compat); founding is the
// private $99 founding-partner price (core tier). orgPlanTier() resolves any of
// these to core/team.
const BILLING_PLAN_VALUES = new Set(["core", "team", "founding", "seed", "growth", "impact"]);

// A Stripe Price id → our plan value (reverse of create-checkout's price map).
// Returns null when the price isn't one we recognize.
function planForPriceId(priceId, env = process.env) {
  if (!priceId) return null;
  const entries = [
    [env.STRIPE_PRICE_CORE, "core"],
    [env.STRIPE_PRICE_TEAM, "team"],
    [env.STRIPE_PRICE_FOUNDING, "founding"],
    [env.STRIPE_PRICE_SEED, "seed"],
    [env.STRIPE_PRICE_GROWTH, "growth"],
    [env.STRIPE_PRICE_IMPACT, "impact"],
  ];
  const hit = entries.find(([pid]) => pid && pid === priceId);
  return hit ? hit[1] : null;
}

// The plan a subscription currently reflects: prefer the live price (survives a
// portal plan switch), fall back to metadata.plan (reliable at checkout time).
function planFromSubscription(sub, env = process.env) {
  const item = sub && sub.items && sub.items.data && sub.items.data[0];
  const priceId = (item && item.price && item.price.id) || (item && item.plan && item.plan.id) || null;
  const byPrice = planForPriceId(priceId, env);
  if (byPrice) return byPrice;
  return BILLING_PLAN_VALUES.has(sub && sub.metadata && sub.metadata.plan) ? sub.metadata.plan : null;
}

module.exports = { BILLING_PLAN_VALUES, planForPriceId, planFromSubscription };
