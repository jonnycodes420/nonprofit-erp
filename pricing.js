// pricing.js — ONE PLAN, PRICED BY RECORDS (GTM-1a, re-banded by PRICING-1).
//
// Steward stopped selling features. There is ONE plan, everything is in it —
// the CRM, Volunteers and the Agent — with unlimited users, no platform fee
// and no contract. What changes with size is the price, and since PRICING-1
// size is RECORDS (people with at least one gift), a number the org can check.
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

// ── PRICING-1 · FOUR BANDS BY RECORDS ──────────────────────────────────────
// A record is a person or organization with at least one gift. `maxRecords`
// is inclusive: exactly 500 records is the first band, 501 the second. Yearly
// is ten times the monthly figure (two months free) and is written out in the
// JSON rather than computed. Every band carries a one-time setup fee.
const TIERS = DATA.tiers;

// Above the top band there is no price, there is a conversation. A real
// state, not a missing tier, so it has a name the code can carry around.
const TALK_TO_US = DATA.talkToUs;

// The GTM-1a bands (t1000/t5000/t10000, by active donors). Organisations may
// be on those Stripe prices, so they are recognised for ever (names, the
// webhook's price map) and never offered, and never measured against a band.
const LEGACY_TIERS = DATA.legacyTiers || [];

// When an org has passed its band, and what happens then. Two months running
// over the band sends the owner a note; the change waits `noticeDays` and
// needs the owner's yes. Moving down happens at renewal, on request.
const BAND_MOVE = DATA.bandMove;
const SETUP_NOTE = DATA.setupNote;

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

// ── WHAT A RECORD IS, IN ONE SENTENCE ──────────────────────────────────────
// On signup, on Billing and in the band note, the same sentence because it is
// this constant, and countRecords (server.js) is this sentence in SQL.
const RECORD_SENTENCE = DATA.recordSentence;

const INCLUDED = DATA.included;
const TERMS_STRIP = DATA.termsStrip;
const BILLING_INTERVALS = DATA.billingIntervals;
const YEARLY_NOTE = DATA.yearlyNote;
// FIX-4 6 — the words the pricing section is written in. In the JSON with
// the numbers, for the same reason the numbers are: one file both sides read.
const COPY = {
  headline: DATA.headline, lede: DATA.lede, yearlyPill: DATA.yearlyPill,
  monthToMonth: DATA.monthToMonth, featuredBadge: DATA.featuredBadge,
  startCta: DATA.startCta, includedHeading: DATA.includedHeading,
};
const INCLUDED_GROUPS = DATA.includedGroups;
const EXTRAS = DATA.extras;

// ── LOOKUPS ────────────────────────────────────────────────────────────────

const publicTierIds = () => TIERS.map(t => t.id);

const tierById = id => TIERS.find(t => t.id === id) || null;
const legacyTierById = id => LEGACY_TIERS.find(t => t.id === id) || null;

// The band an estimate falls in. Above the top band this returns null and the
// caller must show TALK_TO_US — never silently sell the biggest tier to an
// org that is larger than it.
function tierForRecordCount(n) {
  const count = Number(n);
  if (!Number.isFinite(count) || count < 0) return null;
  return TIERS.find(t => count <= t.maxRecords) || null;
}

// The env var that carries a tier's Stripe price for one cadence, or its
// one-time setup fee (`interval` "setup"). Legacy tiers have no setup price.
function priceEnvFor(tierId, interval) {
  const t = tierById(tierId) || legacyTierById(tierId);
  if (!t) return null;
  return interval === "yearly" ? t.envYearly : interval === "monthly" ? t.envMonthly
    : interval === "setup" ? (t.envSetup || null) : null;
}

function priceIdFor(tierId, interval, env) {
  const name = priceEnvFor(tierId, interval);
  return name ? ((env || {})[name] || null) : null;
}

// What a tier costs for one cadence, in whole dollars.
function amountUsdFor(tierId, interval) {
  const t = tierById(tierId) || legacyTierById(tierId);
  if (!t) return null;
  return interval === "yearly" ? t.yearlyUsd : interval === "monthly" ? t.monthlyUsd
    : interval === "setup" ? (t.setupUsd ?? null) : null;
}

// The lowest monthly price, the one number the marketing site says.
const fromMonthlyUsd = () => Math.min(...TIERS.map(t => t.monthlyUsd));

// ── FIX-4 6 · THE NAME A CUSTOMER AND AN ADMIN SEE ────────────────────────
// Seed, Sapling, Orchard, Forest. ONE function, because the plan value on an
// org is a composite (`t5000_yearly`) and every screen that showed it was
// either printing the raw id or keeping its own map — the admin console's
// PLAN column showed `t5000_monthly`, Settings → Billing showed the band
// sentence with no name at all, and the over-band notice named the band and
// not the tier. The Stripe products keep their own names and their own ids:
// this is what Steward calls the plan, and nothing here reaches Stripe.
//
// The legacy plan values (core/team/founding/seed/growth/impact) are NOT
// renamed. Real organisations are on those prices, and calling somebody's
// plan "Sapling" when their invoice says "Team" is worse than saying "Team".
const LEGACY_PLAN_NAMES = {
  core: "Core", team: "Team", founding: "Founding partner",
  seed: "Seed", growth: "Growth", impact: "Impact",
  trial: "Trial", portal: "Donor Portal",
};

// `t5000_yearly` → the tier. Also accepts a bare tier id.
function tierForPlanValue(plan) {
  const s = String(plan || "");
  if (!s) return null;
  const id = s.includes("_") ? s.split("_")[0] : s;
  return tierById(id) || legacyTierById(id);
}

// The one answer to "what is this plan called?". Returns null for a plan
// value nothing recognises, so a caller shows the raw value rather than a
// confident wrong name.
function planDisplayName(plan) {
  const s = String(plan || "").trim();
  if (!s) return null;
  if (s === INTERNAL_TEST.id) return INTERNAL_TEST.name;
  const t = tierForPlanValue(s);
  if (t) return t.name;
  return LEGACY_PLAN_NAMES[s.toLowerCase()] || null;
}

// The name plus the size under it — "Sapling · up to 5,000 active donors".
// The count always goes UNDER the name, never instead of it.
function planDisplayBand(plan) {
  const t = tierForPlanValue(plan);
  return t ? t.band : null;
}

// Every price env var this file knows about, so a health check or a script
// can report which ones are set without duplicating the list.
function allPriceEnvNames() {
  const names = [];
  for (const t of TIERS) names.push(t.envMonthly, t.envYearly, t.envSetup);
  for (const t of LEGACY_TIERS) names.push(t.envMonthly, t.envYearly);
  names.push(INTERNAL_TEST.env);
  return names;
}

module.exports = {
  TIERS, TALK_TO_US, INTERNAL_TEST, FOUNDING_COUPON,
  LEGACY_TIERS, BAND_MOVE, SETUP_NOTE, RECORD_SENTENCE, INCLUDED, TERMS_STRIP,
  BILLING_INTERVALS, YEARLY_NOTE, COPY, INCLUDED_GROUPS, EXTRAS,
  LEGACY_PLAN_NAMES,
  publicTierIds, tierById, legacyTierById, tierForRecordCount, priceEnvFor, priceIdFor,
  amountUsdFor, fromMonthlyUsd, allPriceEnvNames, tierForPlanValue, planDisplayName, planDisplayBand,
};
