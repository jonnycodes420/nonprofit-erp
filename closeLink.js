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

// The three plans a close link may sell, and what they cost. These prices are
// the live commercial model as of BUILD-90 (they superseded the lower set
// BUILD-24 shipped). The Stripe Price ids behind them are Jonathan's to
// create — anything that spends or charges money is — so each plan names the
// env var that carries its id rather than an id.
const CLOSE_PLANS = [
  { id: "founding", name: "Founding", monthlyUsd: 199, env: "STRIPE_PRICE_FOUNDING" },
  { id: "core",     name: "Core",     monthlyUsd: 249, env: "STRIPE_PRICE_CORE" },
  { id: "team",     name: "Team",     monthlyUsd: 499, env: "STRIPE_PRICE_TEAM" },
];

const closePlan = id => CLOSE_PLANS.find(p => p.id === id) || null;

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
  if (!plan) {
    return { ok: false, error: "invalid_plan", message: `Plan must be one of: ${CLOSE_PLANS.map(p => p.id).join(", ")}.` };
  }
  return { ok: true, orgName, contactEmail, plan };
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
}) {
  const firstChargeAt = computeTrialEnd(now);
  const metadata = { closeLinkId, plan: plan.id, orgName, contactEmail };
  return {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: contactEmail,
    payment_method_collection: "always",
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata,
    },
    metadata,
    custom_text: {
      submit: { message: checkoutNotice({ monthlyUsd: plan.monthlyUsd, firstChargeAt, tz }) },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };
}

module.exports = {
  CLOSE_PLANS, closePlan, validateCloseLink, checkoutSessionParams,
  checkoutNotice, firstChargeSentence, formatChargeDate, usd,
};
