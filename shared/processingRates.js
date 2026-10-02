// shared/processingRates.js — GIVE-2 §5. WHAT THE PROCESSOR TAKES.
//
// ── ONE PLACE THE RATE LIVES ───────────────────────────────────────────────
// Before this module the donor-covers-fees gross-up was a pair of constants in
// `routes/give.js` and a hand-copied mirror of the same arithmetic in
// `Donate.jsx` and `GiveSteps.jsx`. Three copies of one number, and the number
// was wrong for two of the ways money now arrives: a nonprofit on Stripe's
// discounted rate pays 2.2% and was asked to cover 2.9%, and an ACH gift pays
// 0.8% capped at $5 and was asked to cover a card rate that is four times it.
//
// A checkbox that says "add $3.20 so we receive the full $100" is a factual
// claim about somebody's bank account. It is allowed to be approximate — the
// comment on the old constant was honest that an org on a negotiated rate nets
// slightly MORE, never less — but it is not allowed to be approximate in the
// direction of asking a donor for money the processor does not take. So the
// rate is the ORG's, configurable, defaulting to Stripe's published numbers.
//
// ── THE FEE IS STILL READ BACK FROM STRIPE ─────────────────────────────────
// This module says what to ASK for. What the processor ACTUALLY took comes off
// the charge's balance transaction and is written to `gifts.processor_fee_amount`
// by the webhook. The two are never assumed equal, and `shared/giftFooting.js`
// foots the gift from the recorded numbers, not from these.
//
// Pure: integer cents, no DB, no clock, no network. A float is how $25 becomes
// $24.99 (`money.js` is the seam).

// ── THE PUBLISHED RATES ────────────────────────────────────────────────────
// Stripe's US standard pricing, 2026. Sourced from stripe.com/pricing; the
// numbers an org can change are the ones below, and the settings screen names
// where the default came from.
export const DEFAULT_RATES = Object.freeze({
  card: Object.freeze({ pct: 0.029, flatCents: 30, capCents: null }),
  // ACH debit: 0.8%, capped at $5.00, no flat fee.
  ach: Object.freeze({ pct: 0.008, flatCents: 0, capCents: 500 }),
});

export const RATE_KINDS = Object.keys(DEFAULT_RATES);

// Stripe's nonprofit rate, for the sentence on the settings screen. Not a
// default: an org only pays it once Stripe has approved its application, and
// guessing that it has would be guessing in the direction that costs the org.
export const NONPROFIT_CARD_RATE = Object.freeze({ pct: 0.022, flatCents: 30, capCents: null });

const PCT_MAX = 0.2;              // a fifth of a gift is not a processing rate
const FLAT_MAX_CENTS = 1000;      // ten dollars
const CAP_MAX_CENTS = 100000;     // a thousand dollars

const isInt = v => Number.isInteger(v);

// ── WHICH RATE A PAYMENT RUNS ON ───────────────────────────────────────────
// Stripe's own payment-method type strings, so the caller never has to map
// them. Anything unrecognised is a CARD, which is the dearer of the two: an
// unknown method must not under-state what the org will pay.
export function rateKindForMethod(stripeMethodType) {
  const t = String(stripeMethodType || "").toLowerCase();
  if (t === "us_bank_account" || t === "ach_debit" || t === "ach_credit_transfer" || t === "acss_debit") return "ach";
  return "card";
}

// ── THE ORG'S OWN RATES ────────────────────────────────────────────────────
// `org` is a row from `orgs`. A NULL column means "I have not told Steward my
// rate", which is the state every org starts in, and the published default is
// the right answer for it. A stored value out of range is ignored rather than
// trusted: a 90% rate on a form would ask a donor to double their gift.
export function orgRates(org) {
  const o = org || {};
  const pick = (kind, pctCol, flatCol, capCol) => {
    const d = DEFAULT_RATES[kind];
    const pctRaw = o[pctCol];
    const flatRaw = o[flatCol];
    const capRaw = capCol ? o[capCol] : undefined;
    const pct = pctRaw == null || pctRaw === "" ? d.pct : Number(pctRaw);
    const flatCents = flatRaw == null || flatRaw === "" ? d.flatCents : Number(flatRaw);
    const capCents = capRaw == null || capRaw === "" ? d.capCents : Number(capRaw);
    const okPct = Number.isFinite(pct) && pct >= 0 && pct <= PCT_MAX;
    const okFlat = Number.isFinite(flatCents) && isInt(flatCents) && flatCents >= 0 && flatCents <= FLAT_MAX_CENTS;
    const okCap = capCents == null || (Number.isFinite(capCents) && isInt(capCents) && capCents > 0 && capCents <= CAP_MAX_CENTS);
    return {
      pct: okPct ? pct : d.pct,
      flatCents: okFlat ? flatCents : d.flatCents,
      capCents: okCap ? capCents : d.capCents,
      isDefault: !okPct || !okFlat || (pctRaw == null && flatRaw == null),
    };
  };
  return {
    card: pick("card", "fee_rate_card_pct", "fee_rate_card_flat_cents", null),
    ach: pick("ach", "fee_rate_ach_pct", "fee_rate_ach_flat_cents", "fee_rate_ach_cap_cents"),
  };
}

// Validation for the settings screen's write. Returns the columns to store, or
// the errors in the org's own words.
export function validateRates(input) {
  const errors = [];
  const out = {};
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const kind of RATE_KINDS) {
    const v = raw[kind];
    if (v === undefined) continue;
    if (v === null) { // "go back to the published rate"
      out[kind] = null;
      continue;
    }
    if (typeof v !== "object" || Array.isArray(v)) {
      errors.push({ field: kind, message: "A rate is a percentage and a flat fee." });
      continue;
    }
    // THE PERCENTAGE IS TYPED AS A PERCENTAGE, stored as a fraction. An org
    // reads "2.9" off its Stripe dashboard, not "0.029", and a screen that
    // silently takes 2.9 to mean 290% would ask a donor to cover four times
    // their gift.
    const pct = Number(v.pctDisplay != null ? v.pctDisplay : v.pct != null ? Number(v.pct) * 100 : NaN);
    const flatCents = Number(v.flatCents);
    if (!Number.isFinite(pct) || pct < 0 || pct > PCT_MAX * 100) {
      errors.push({ field: `${kind}.pct`, message: `A processing rate is between 0 and ${PCT_MAX * 100}%.` });
    }
    if (!Number.isFinite(flatCents) || !isInt(flatCents) || flatCents < 0 || flatCents > FLAT_MAX_CENTS) {
      errors.push({ field: `${kind}.flatCents`, message: "A flat fee is a whole number of cents, up to $10." });
    }
    let capCents = null;
    if (kind === "ach") {
      capCents = v.capCents == null || v.capCents === "" ? null : Number(v.capCents);
      if (capCents != null && (!Number.isFinite(capCents) || !isInt(capCents) || capCents <= 0 || capCents > CAP_MAX_CENTS)) {
        errors.push({ field: "ach.capCents", message: "A cap is a whole number of cents above zero, or blank for no cap." });
      }
    }
    if (!errors.some(e => e.field.startsWith(kind))) {
      // Rounded to six places: 2.9% is 0.029 and not 0.028999999999999998.
      out[kind] = { pct: Math.round((pct / 100) * 1e6) / 1e6, flatCents, capCents };
    }
  }
  return { ok: errors.length === 0, errors, rates: errors.length ? null : out };
}

// ── WHAT THE PROCESSOR TAKES FROM A CHARGE ─────────────────────────────────
// Rounded UP to the cent, because a processor's own rounding is not Steward's
// to assume in the org's favour.
export function feeOnChargeCents(chargeCents, rate) {
  const c = Math.max(0, Math.round(Number(chargeCents) || 0));
  if (!c) return 0;
  const r = rate || DEFAULT_RATES.card;
  let fee = Math.ceil(c * Number(r.pct || 0)) + Math.round(Number(r.flatCents || 0));
  if (r.capCents != null) fee = Math.min(fee, Math.round(Number(r.capCents)));
  return Math.min(fee, c);
}

// ── THE CHARGE THAT NETS THE INTENDED GIFT ─────────────────────────────────
// gross = (net + flat) / (1 - pct), rounded up — the org nets AT LEAST the
// amount the donor meant to give, never a cent less.
//
// A CAPPED RATE (ACH) needs the two branches, and the naive formula is wrong
// above the cap in the expensive direction: a $5,000 ACH gift grossed up at
// 0.8% would add $40 to cover a fee Stripe caps at $5. The guard is to work
// out the uncapped answer first and, if the fee on it would be capped, add the
// cap instead.
export function grossUpCents(netCents, rate) {
  const net = Math.max(0, Math.round(Number(netCents) || 0));
  if (!net) return 0;
  const r = rate || DEFAULT_RATES.card;
  const pct = Number(r.pct || 0);
  const flat = Math.round(Number(r.flatCents || 0));
  if (pct >= 1) return net;                                // not a rate; refuse to invent one
  const uncapped = Math.ceil((net + flat) / (1 - pct));
  if (r.capCents == null) return uncapped;
  const cap = Math.round(Number(r.capCents));
  if (feeOnChargeCents(uncapped, { ...r, capCents: null }) <= cap) return uncapped;
  return net + cap;
}

// What the checkbox adds. The one number the donor reads beside it.
export function coveredAmountCents(netCents, rate) {
  return grossUpCents(netCents, rate) - Math.max(0, Math.round(Number(netCents) || 0));
}

// ── THE SENTENCE ───────────────────────────────────────────────────────────
// Every number has a sentence, and this is the one beside the rate on the
// settings screen and under the checkbox on the form.
export function rateSentence(rate, { kind = "card" } = {}) {
  const r = rate || DEFAULT_RATES[kind] || DEFAULT_RATES.card;
  const pct = Number(r.pct || 0) * 100;
  const pctText = `${Number(pct.toFixed(2))}%`;
  const flat = Math.round(Number(r.flatCents || 0));
  const parts = [pctText];
  if (flat) parts.push(`${flat}¢`);
  let s = parts.join(" plus ");
  if (r.capCents != null) s += `, capped at $${(Math.round(Number(r.capCents)) / 100).toFixed(2)}`;
  return s;
}
