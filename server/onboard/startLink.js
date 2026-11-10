// server/onboard/startLink.js · ONBOARD-1 Stage 1. THE START LINK, AS PURE RULES.
//
// BUILD-90's close link makes a NEW org, so it cannot finish the paper for an
// org that already exists (CKRH, the food pantry). A start link can: Jonathan
// raises one from the org's row, the contact opens /start/<token>, reads a
// one-page order form with the org's name, price and first charge date filled
// in, types her name and title, presses "I agree", and is handed Stripe
// Checkout on the org's own Stripe customer with trial_end = that date. The
// card is saved and nothing is charged.
//
// This file has no database and no network: the routes (startRoutes.js) read
// and write, this decides. What she signs is rendered here, once, and the
// SHA-256 is taken of exactly these bytes.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PRICING = require("../../pricing");
const { formatChargeDate } = require("../../closeLink");
const { DEFAULT_TZ, civilOf } = require("../../orgTime");

const TEMPLATE_PATH = path.join(__dirname, "..", "..", "legal", "start-agreement.md");
// Bump WITH legal/start-agreement.md, in the same commit (verifyVersion checks it).
const START_AGREEMENT_VERSION = "2026-11-09";
const EXPIRES_DAYS = 14;
const THIRTY = 30;
// Stripe refuses a trial_end less than 48 hours out; a date that close is a
// date the contract cannot keep, so the link refuses it too.
const MIN_LEAD_MS = 2 * 86400000 + 3600000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let cachedTemplate = null;
function template() {
  if (cachedTemplate == null) cachedTemplate = fs.readFileSync(TEMPLATE_PATH, "utf8");
  return cachedTemplate;
}
const verifyVersion = () => template().includes(`Version ${START_AGREEMENT_VERSION}.`);

const sha256 = s => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
const newToken = () => crypto.randomBytes(24).toString("base64url");
const usd = cents => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

// The price the link quotes: the org's custom price, or a band's monthly price.
// Returns { cents, basis, tierId } or an error. A band is one of the sellable
// tiers in pricing.json, never the internal $1 price.
function resolvePrice({ priceSource, band, org }) {
  if (priceSource === "custom") {
    if (!org || org.custom_price_cents == null) {
      return { ok: false, error: "no_custom_price", message: "This organization has no custom price. Set one first, or pick a band." };
    }
    const tier = PRICING.tierForPlanValue(org.plan) || PRICING.TIERS[0];
    return { ok: true, cents: Math.round(Number(org.custom_price_cents)), basis: "custom", tierId: tier.id };
  }
  const tier = PRICING.tierById(String(band || ""));
  if (!tier || !PRICING.TIERS.includes(tier)) {
    return { ok: false, error: "invalid_band", message: `Band must be one of: ${PRICING.TIERS.map(t => t.id).join(", ")}.` };
  }
  return { ok: true, cents: tier.monthlyUsd * 100, basis: "band", tierId: tier.id, band: tier.band };
}

// Validate what Jonathan typed. `now` is injectable (tests set their clock).
function validateStartLink(body = {}, org, now = Date.now()) {
  const contactName = String(body.contactName || "").trim().slice(0, 200);
  const contactEmail = String(body.contactEmail || "").trim().toLowerCase().slice(0, 320);
  const note = String(body.note || "").trim().slice(0, 2000) || null;
  if (!contactName) return { ok: false, error: "contact_name_required", message: "The contact's name is required." };
  if (!EMAIL_RE.test(contactEmail)) return { ok: false, error: "contact_email_invalid", message: "A valid contact email is required." };
  const price = resolvePrice({ priceSource: body.priceSource === "custom" ? "custom" : "band", band: body.band, org });
  if (!price.ok) return price;
  const chargeMode = body.chargeMode === "thirty" ? "thirty" : "fixed";
  let firstChargeOn = null;
  if (chargeMode === "fixed") {
    firstChargeOn = String(body.firstChargeOn || "").trim();
    if (!DATE_RE.test(firstChargeOn) || isNaN(Date.parse(firstChargeOn + "T12:00:00Z"))) {
      return { ok: false, error: "first_charge_invalid", message: "Pick the first charge date (for the betas, 2027-01-01)." };
    }
    // The link lives 14 days, so the date must still be 48 hours out when it expires.
    if (Date.parse(firstChargeOn + "T12:00:00Z") < now + EXPIRES_DAYS * 86400000 + MIN_LEAD_MS) {
      return { ok: false, error: "first_charge_too_soon", message: `The first charge date must be at least ${EXPIRES_DAYS + 2} days away, so it is still in the future when the link expires.` };
    }
  }
  return { ok: true, contactName, contactEmail, note, price, chargeMode, firstChargeOn };
}

// THE ONE DATE. A fixed date is noon in the org's zone on that day ("Jan 1,
// 2027" must read as Jan 1 in Kentucky); "30 days" counts from the signature.
function firstChargeAt(link, signedAtMs, tz = DEFAULT_TZ) {
  if (link.charge_mode === "thirty") return new Date(signedAtMs + THIRTY * 86400000);
  const day = civilOf(link.first_charge_on);   // a DATE column, read as its own day (never through local time)
  return noonIn(day, tz);
}
function noonIn(day, tz) {
  const guess = new Date(day + "T12:00:00Z");
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || DEFAULT_TZ, hour: "numeric", hour12: false }).formatToParts(guess);
    const h = Number((parts.find(p => p.type === "hour") || {}).value);
    return new Date(guess.getTime() + (12 - (h % 24)) * 3600000);
  } catch { return guess; }
}

// What the page shows BEFORE she signs, for a link not yet signed: the fixed
// date, or the rule "30 days from signing" with the date it would be today.
function chargeWords(link, { now = Date.now(), tz = DEFAULT_TZ } = {}) {
  const at = firstChargeAt(link, now, tz);
  return {
    at,
    date: formatChargeDate(at, tz),
    rule: link.charge_mode === "thirty"
      ? `That is thirty days after you sign. Signing today makes it ${formatChargeDate(at, tz)}.`
      : "It is fixed on this page and it is the same date in Settings → Billing and in every email about it.",
    headline: link.charge_mode === "thirty" ? `thirty days after you sign (${formatChargeDate(at, tz)} if you sign today)` : formatChargeDate(at, tz),
  };
}

// Render the order form. Every blank is filled; a blank left in is a defect.
function renderAgreement({ orgName, priceCents, priceBasis, band, link, agreementVersion, now = Date.now(), tz = DEFAULT_TZ }) {
  const words = chargeWords(link, { now, tz });
  const price = priceCents > 0 ? `${usd(priceCents)} a month` : "No charge";
  const basis = priceBasis === "custom"
    ? "This is the price agreed with Steward for your organization."
    : `This is the price for ${band ? band.toLowerCase() : "your band"} in Steward's published pricing.`;
  const cancel = priceCents > 0
    ? `Cancel any time before ${words.date} in Settings → Billing and you pay nothing. There is no fee, no minimum and no phone call.`
    : "There is nothing to cancel: no amount is due. Remove the card any time in Settings → Billing.";
  const fill = {
    ORG_NAME: orgName, AGREEMENT_VERSION: agreementVersion, PRICE: price, PRICE_BASIS: basis,
    FIRST_CHARGE: words.headline, CHARGE_RULE: priceCents > 0 ? words.rule : "With no price, nothing is ever charged on that date.",
    CANCEL_TERMS: cancel,
  };
  const text = template().replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (fill[k] != null ? String(fill[k]) : m));
  if (/\{\{[A-Z_]+\}\}/.test(text)) throw new Error("start agreement left a blank unfilled");
  return { text, sha256: sha256(text), version: START_AGREEMENT_VERSION, firstChargeAt: words.at, firstChargeDate: words.date };
}

// The confirmation, word for word from the brief.
function confirmationSentence({ priceCents, firstChargeAt: at, tz = DEFAULT_TZ }) {
  const d = formatChargeDate(at, tz);
  if (!(priceCents > 0)) return `Signed. Nothing is charged today, and no charge is scheduled. Your card is saved for when one is.`;
  return `Signed. Nothing is charged today. First charge: ${d}, ${usd(priceCents)}. Cancel any time before then in Settings → Billing and you pay nothing.`;
}

// Where a link stands. Expired and used are both final.
function linkState(link, now = Date.now()) {
  if (!link) return "missing";
  if (link.status === "completed") return "completed";
  if (link.status === "revoked") return "revoked";
  if (new Date(link.expires_at).getTime() <= now) return "expired";
  if (link.signed_at && link.status === "signed") return "signed";
  return "open";
}

module.exports = {
  START_AGREEMENT_VERSION, EXPIRES_DAYS, TEMPLATE_PATH,
  sha256, newToken, usd, resolvePrice, validateStartLink, firstChargeAt, chargeWords,
  renderAgreement, confirmationSentence, linkState, verifyVersion,
};
