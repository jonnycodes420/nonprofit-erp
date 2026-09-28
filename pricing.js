// pricing.js — GTM-1a · ONE PLAN, PRICED BY HOW MANY DONORS YOU WORK.
//
// Steward stopped selling features. There is ONE plan, everything is in it —
// the CRM, Volunteers and the Agent — with unlimited users, no platform fee
// and no contract. What changes with size is the price, and size is measured
// in ACTIVE donors, which is a number the org can check for itself.
//
// THE NUMBERS ARE IN `pricing.json`, NOT HERE. That file is the one source,
// and it is JSON rather than JavaScript for a build reason worth writing
// down: the server needs the catalogue synchronously at require time
// (`closeLink.js` builds its plan list from it before Express starts), and
// the client needs it in the bundle. A CommonJS module at the repo root
// cannot be imported by the client — Rollup's CommonJS transform only covers
// node_modules, and `shared/pricing.js` re-exporting it failed the build with
// "default is not exported by ../pricing.js". JSON both of them read
// natively. So: data in the JSON, and the two things that are NOT data in
// here — the lookups, and the things a browser must never be shipped.
//
// WHAT IS NOT IN THE JSON, DELIBERATELY: the $1 internal price. The client
// imports the JSON directly, so anything in it is in the bundle; keeping the
// internal price out of the file is a stronger guarantee than any string
// check that it never reaches a public page. Guarded by
// tests/gtm1a-internal-price.test.js.
//
// WHAT IS NOT HERE AT ALL: a Stripe price ID. Anything that charges money is
// Jonathan's to create, so every tier names the ENV VAR that carries its id
// and the server refuses to sell a tier whose variable is unset. The old
// STRIPE_PRICE_CORE / _TEAM / _FOUNDING variables are deliberately untouched
// — real organisations are on those prices right now.

const DATA = require("./pricing.json");

// ── THE THREE BANDS ────────────────────────────────────────────────────────
// `maxDonors` is inclusive: exactly 1,000 active donors is the first band.
// Yearly is two months free, which is 10 × the monthly figure, and it is
// written out in the JSON rather than computed so nobody has to trust
// arithmetic on a page that takes a card.
const TIERS = DATA.tiers;

// Above the top band there is no price, there is a conversation. A real
// state, not a missing tier, so it has a name the code can carry around.
const TALK_TO_US = DATA.talkToUs;

// ── THE $1 PRICE ───────────────────────────────────────────────────────────
// Internal only, and that is enforced rather than intended: it is not in
// TIERS, so nothing that renders the public page or reads a signup body can
// reach it, and it is not in pricing.json, so it is not in the browser bundle
// at all. The only way onto it is a super-admin control inside the product.
const INTERNAL_TEST = {
  id: "internal_test",
  name: "Internal test",
  monthlyUsd: 1,
  env: "STRIPE_PRICE_INTERNAL_TEST",
  publiclyOfferable: false,
};

// ── THE FOUNDING DISCOUNT ──────────────────────────────────────────────────
// $50 off, for ever, on whichever tier a founding org is on. A Stripe coupon
// rather than a price, precisely so it survives a tier change: an org that
// grows out of the first band keeps the discount instead of losing it the day
// it upgrades.
const FOUNDING_COUPON = {
  couponId: "Gv9E1KkK",
  promotionCode: "STEWARD50",
  offUsdPerMonth: 50,
};

// ── WHAT "ACTIVE DONOR" MEANS, IN ONE SENTENCE ─────────────────────────────
// On the pricing page, on the signup page, and in the over-tier notice, and
// it is the same sentence in all three because it is this constant. The
// window is TWENTY-FOUR months and the two things that count are a gift and a
// logged conversation — the same two events the donor profile's Lifetime and
// Last contact figures are built from, so an org can count its own.
const ACTIVE_DONOR_MONTHS = DATA.activeDonorMonths;
const ACTIVE_DONOR_SENTENCE = DATA.activeDonorSentence;

const INCLUDED = DATA.included;
const TERMS_STRIP = DATA.termsStrip;
const BILLING_INTERVALS = DATA.billingIntervals;
const YEARLY_NOTE = DATA.yearlyNote;

// ── LOOKUPS ────────────────────────────────────────────────────────────────

const publicTierIds = () => TIERS.map(t => t.id);

const tierById = id => TIERS.find(t => t.id === id) || null;

// The band an estimate falls in. Above the top band this returns null and the
// caller must show TALK_TO_US — never silently sell the biggest tier to an
// org that is larger than it.
function tierForDonorCount(n) {
  const count = Number(n);
  if (!Number.isFinite(count) || count < 0) return null;
  return TIERS.find(t => count <= t.maxDonors) || null;
}

// The env var that carries a tier's Stripe price for one cadence.
function priceEnvFor(tierId, interval) {
  const t = tierById(tierId);
  if (!t) return null;
  return interval === "yearly" ? t.envYearly : interval === "monthly" ? t.envMonthly : null;
}

function priceIdFor(tierId, interval, env) {
  const name = priceEnvFor(tierId, interval);
  return name ? ((env || {})[name] || null) : null;
}

// What a tier costs for one cadence, in whole dollars.
function amountUsdFor(tierId, interval) {
  const t = tierById(tierId);
  if (!t) return null;
  return interval === "yearly" ? t.yearlyUsd : interval === "monthly" ? t.monthlyUsd : null;
}

// Every price env var this file knows about, so a health check or a script
// can report which ones are set without duplicating the list.
function allPriceEnvNames() {
  const names = [];
  for (const t of TIERS) names.push(t.envMonthly, t.envYearly);
  names.push(INTERNAL_TEST.env);
  return names;
}

module.exports = {
  TIERS, TALK_TO_US, INTERNAL_TEST, FOUNDING_COUPON,
  ACTIVE_DONOR_MONTHS, ACTIVE_DONOR_SENTENCE, INCLUDED, TERMS_STRIP,
  BILLING_INTERVALS, YEARLY_NOTE,
  publicTierIds, tierById, tierForDonorCount, priceEnvFor, priceIdFor,
  amountUsdFor, allPriceEnvNames,
};
