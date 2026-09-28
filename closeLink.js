// BUILD-90 90a — THE CLOSE LINK.
//
// Jonathan closes in the room. The executive director puts a card in on his
// laptop or her phone, NOTHING IS CHARGED, and the contract and the product
// agree on exactly when the first charge happens.
//
// Public signup stays closed (BUILD-87 F.2 made /signup a redirect and deleted
// the page). This is the only door that creates an organisation, and only a
// super-admin can open it. It hands back a Stripe Checkout URL; the org, the
// first admin user and the subscription are created when — and only when —
// Checkout completes, so an unopened link leaves nothing behind.
//
// Pure module so the plan catalogue, the validation and above all THE SENTENCE
// SHE READS are unit-testable without booting Express or touching Stripe.
// Everything in here is copy and shape; the Stripe call itself lives in
// server.js.

const { computeTrialEnd, TRIAL_DAYS } = require("./trialEnd");
const { DEFAULT_TZ } = require("./orgTime");
const PRICING = require("./pricing");

// The three plans a close link may sell, and what they cost. These prices are
// the live commercial model as of BUILD-90 (they superseded the lower set
// BUILD-24 shipped). The Stripe Price ids behind them are Jonathan's to
// create — anything that spends or charges money is — so each plan names the
// env var that carries its id rather than an id.
// LEGACY — the three plans BUILD-90 sold. Real organisations are on these
// Stripe prices right now, so the ids and the env vars do not move. GTM-1a
// stopped OFFERING them (there is one plan now, priced by band) but a close
// link may still name one, and the webhook must still recognise a renewal.
const LEGACY_CLOSE_PLANS = [
  { id: "founding", name: "Founding", monthlyUsd: 199, env: "STRIPE_PRICE_FOUNDING" },
  { id: "core",     name: "Core",     monthlyUsd: 249, env: "STRIPE_PRICE_CORE" },
  { id: "team",     name: "Team",     monthlyUsd: 499, env: "STRIPE_PRICE_TEAM" },
];

// GTM-1a — THE PLANS ON SALE. One plan, three bands, two cadences, built from
// shared/pricing.js so the page, the checkout sentence and the Stripe
// price-check all read one list. A plan id is `<tier>_<cadence>`, e.g.
// `t5000_yearly`, and that string is what lands in orgs.plan and in the
// subscription metadata.
const TIER_CLOSE_PLANS = [];
for (const t of PRICING.TIERS) {
  TIER_CLOSE_PLANS.push({
    id: `${t.id}_monthly`, name: `Steward · ${t.band}`, tierId: t.id, interval: "month",
    monthlyUsd: t.monthlyUsd, amountUsd: t.monthlyUsd, env: t.envMonthly,
  });
  TIER_CLOSE_PLANS.push({
    id: `${t.id}_yearly`, name: `Steward · ${t.band}, yearly`, tierId: t.id, interval: "year",
    // `monthlyUsd` stays the MONTHLY figure because that is what it has always
    // meant; `amountUsd` is what Stripe actually charges on the first charge,
    // and it is what the sentence she reads must say.
    monthlyUsd: t.monthlyUsd, amountUsd: t.yearlyUsd, env: t.envYearly,
  });
}

// The $1 internal price. In this catalogue because the checkout machinery is
// the same; NEVER in the list any public surface renders, and the only route
// that may name it is super-admin-only (routes/billing.js).
const INTERNAL_CLOSE_PLAN = {
  id: PRICING.INTERNAL_TEST.id, name: PRICING.INTERNAL_TEST.name, interval: "month",
  monthlyUsd: PRICING.INTERNAL_TEST.monthlyUsd, amountUsd: PRICING.INTERNAL_TEST.monthlyUsd,
  env: PRICING.INTERNAL_TEST.env, internal: true,
};

const CLOSE_PLANS = [...LEGACY_CLOSE_PLANS, ...TIER_CLOSE_PLANS, INTERNAL_CLOSE_PLAN];

// Every plan a close link may sell. The internal $1 price is NOT one of them:
// a close link is a thing Jonathan hands to a customer, and the $1 price is
// not for sale at any door. It is reachable only through the super-admin
// control that moves an org already in the product onto it.
const SELLABLE_CLOSE_PLANS = CLOSE_PLANS.filter(p => !p.internal);

const closePlan = id => CLOSE_PLANS.find(p => p.id === id) || null;

// What a plan charges on its first charge, in whole dollars. Yearly plans
// charge the yearly figure, and the sentence she reads before pressing the
// button has to say so.
const planAmountUsd = plan => Number(plan && (plan.amountUsd != null ? plan.amountUsd : plan.monthlyUsd));

// The cadence Stripe must be configured for, so the price-check can compare
// like with like instead of assuming every plan is monthly.
const planInterval = plan => (plan && plan.interval) || "month";

// Money, as a person writes it. Whole dollars — every plan is.
const usd = n => "$" + Number(n).toLocaleString("en-US");

// A date, as a person reads it: "October 20, 2026". Rendered in the display
// timezone rather than UTC, because a customer in New York must not be shown a
// charge date one day off from the one on her calendar.
function formatChargeDate(at, tz = DEFAULT_TZ) {
  const opts = { month: "long", day: "numeric", year: "numeric" };
  // A malformed zone throws RangeError, and this runs inside email composition:
  // the date falling back to the default zone is a day's ambiguity, a throw is
  // a customer never warned before a charge. Degrade, do not fail.
  try { return new Date(at).toLocaleDateString("en-US", { ...opts, timeZone: tz || DEFAULT_TZ }); }
  catch { return new Date(at).toLocaleDateString("en-US", { ...opts, timeZone: DEFAULT_TZ }); }
}

// THE SENTENCE. It appears on the Stripe Checkout page, in the seven-day
// reminder, and in Settings → Billing, built HERE in all three places so those
// three surfaces cannot drift into disagreeing about one number.
function firstChargeSentence({ monthlyUsd, firstChargeAt, tz = DEFAULT_TZ }) {
  return `Your first charge is ${usd(monthlyUsd)} on ${formatChargeDate(firstChargeAt, tz)}.`;
}

// What Checkout says above the "Subscribe" button. Two sentences: when, and
// the promise that makes putting a card in today safe.
function checkoutNotice({ monthlyUsd, firstChargeAt, tz = DEFAULT_TZ }) {
  return firstChargeSentence({ monthlyUsd, firstChargeAt, tz })
    + " Cancel any time before then and you pay nothing.";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate a close-link request. Returns { ok: true, plan } or { ok:false,
// error, message } — the error code is what the route returns, so the messages
// live with the copy rather than scattered through the handler.
function validateCloseLink(body = {}) {
  const orgName = String(body.orgName || "").trim();
  const contactEmail = String(body.contactEmail || "").trim().toLowerCase();
  const planId = String(body.plan || "").trim();
  if (!orgName) return { ok: false, error: "org_name_required", message: "The organization's name is required." };
  if (!EMAIL_RE.test(contactEmail)) return { ok: false, error: "contact_email_invalid", message: "A valid contact email is required." };
  const plan = closePlan(planId);
  // A close link may not name the internal $1 price, whoever is holding the
  // console. `closePlan` finds it (the checkout machinery needs to), and this
  // is where it is refused.
  if (!plan || plan.internal) {
    return { ok: false, error: "invalid_plan", message: `Plan must be one of: ${SELLABLE_CLOSE_PLANS.map(p => p.id).join(", ")}.` };
  }
  return { ok: true, orgName, contactEmail, plan };
}

// Validate a close request aimed at an org that ALREADY EXISTS. The contact
// email is NOT taken from the caller here: it is read off the org's own admin
// by the route, because the whole point of this path is that nobody retypes an
// address that already belongs to somebody. So this validates the two things a
// caller actually chooses - which org, and which plan.
function validateOrgClose(body = {}) {
  const orgId = String(body.orgId || "").trim();
  const planId = String(body.plan || "").trim();
  if (!orgId) return { ok: false, error: "org_id_required", message: "Pick an organization to close." };
  const plan = closePlan(planId);
  // A close link may not name the internal $1 price, whoever is holding the
  // console. `closePlan` finds it (the checkout machinery needs to), and this
  // is where it is refused.
  if (!plan || plan.internal) {
    return { ok: false, error: "invalid_plan", message: `Plan must be one of: ${SELLABLE_CLOSE_PLANS.map(p => p.id).join(", ")}.` };
  }
  return { ok: true, orgId, plan };
}

// The Stripe Checkout Session parameters for a close link.
//
// THE THREE THINGS THAT MATTER HERE:
//   • `trial_period_days: 30` — Stripe starts the clock when Checkout COMPLETES,
//     which is the moment she signs. We then read the trial end back off the
//     subscription rather than computing our own, so Stripe and Steward cannot
//     disagree about the date the contract names.
//   • `payment_method_collection: "always"` — the card is collected and saved
//     even though the subscription starts in a trial. That is the whole point
//     of the close: the card goes in in the room.
//   • `custom_text.submit.message` — she reads the charge date and the promise
//     BEFORE she presses the button, not in an email afterwards.
//
// `firstChargeAt` is passed in (rather than computed here) so a caller can pin
// it; it defaults to thirty days from now, the same arithmetic Stripe will do.
function checkoutSessionParams({
  plan, orgName, contactEmail, closeLinkId,
  priceId, successUrl, cancelUrl, now = Date.now(), tz = DEFAULT_TZ,
  customerId = null, targetOrgId = null,
}) {
  const firstChargeAt = computeTrialEnd(now);
  // `orgId` rides the metadata whenever the link targets an org that already
  // exists, so a customer minted by Checkout can be traced back to it in the
  // Stripe dashboard. A NEW-org link has no org id to give yet - the org does
  // not exist until this session completes.
  const metadata = { closeLinkId, plan: plan.id, orgName, contactEmail,
                     ...(targetOrgId ? { orgId: targetOrgId } : {}) };
  return {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    // ONE ORGANISATION, ONE STRIPE CUSTOMER.
    //
    // `customer_email` makes Checkout MINT A NEW CUSTOMER every time. For a new
    // org that is right - there is nothing to reuse. For an org that already
    // exists it is wrong, and it showed up within hours of shipping: closing
    // an existing org left it with two platform customers, the subscription on
    // the new one, the old one inert and unlabelled, and the billing history
    // split across both. The Customer Portal follows orgs.stripe_customer_id,
    // so whichever record it does not point at becomes invisible there.
    //
    // Stripe refuses `customer` and `customer_email` together, so this is an
    // either/or, not both.
    ...(customerId ? { customer: customerId } : { customer_email: contactEmail }),
    payment_method_collection: "always",
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata,
    },
    metadata,
    custom_text: {
      submit: { message: checkoutNotice({ monthlyUsd: planAmountUsd(plan), firstChargeAt, tz }) },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };
}

module.exports = {
  CLOSE_PLANS, LEGACY_CLOSE_PLANS, TIER_CLOSE_PLANS, SELLABLE_CLOSE_PLANS, INTERNAL_CLOSE_PLAN,
  planAmountUsd, planInterval,
  closePlan, validateCloseLink, validateOrgClose, checkoutSessionParams,
  checkoutNotice, firstChargeSentence, formatChargeDate, usd,
};
