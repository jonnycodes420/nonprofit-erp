// client/src/lib/planNames.js — FIX-4 6 · WHAT A PLAN IS CALLED, IN THE BROWSER.
//
// The server answers this from `pricing.js`, which is CommonJS at the repo
// root and therefore unimportable from the bundle (see the long note at the
// top of pricing.js for why that is, and why the numbers live in JSON). The
// browser reads the SAME `pricing.json`, so the names cannot drift; what is
// duplicated here is only the lookup, which is four lines, and the legacy
// map, which never changes again.
//
// Seed, Sapling, Orchard, Forest are what a CUSTOMER and an ADMIN see.
// Nothing here reaches Stripe: the Stripe products keep their own names and
// the STRIPE_PRICE_* variables are untouched.

import PRICING from "../../../pricing.json";

// The legacy plan values are NOT renamed. Real organisations are on those
// prices, and calling somebody's plan "Sapling" when their invoice says
// "Team" is worse than saying "Team".
export const LEGACY_PLAN_NAMES = {
  core: "Core", team: "Team", founding: "Founding partner",
  seed: "Seed", growth: "Growth", impact: "Impact",
  trial: "Trial", portal: "Donor Portal",
};

// `t5000_yearly` → the tier row. Also accepts a bare tier id.
export function tierForPlanValue(plan) {
  const s = String(plan || "");
  if (!s) return null;
  const id = s.includes("_") ? s.split("_")[0] : s;
  return PRICING.tiers.find(t => t.id === id) || null;
}

// Null for a plan value nothing recognises, so a caller shows the raw value
// rather than a confident wrong name.
export function planDisplayName(plan) {
  const s = String(plan || "").trim();
  if (!s) return null;
  const t = tierForPlanValue(s);
  if (t) return t.name;
  return LEGACY_PLAN_NAMES[s.toLowerCase()] || null;
}

// The size that goes UNDER the name, never instead of it.
export function planDisplayBand(plan) {
  const t = tierForPlanValue(plan);
  return t ? t.band : null;
}

// The name plus the size, for the one-line places (an email subject, a
// notice) where two elements will not fit.
export function planDisplayLine(plan) {
  const name = planDisplayName(plan), band = planDisplayBand(plan);
  if (name && band) return `${name} · ${band.charAt(0).toLowerCase()}${band.slice(1)}`;
  return name || String(plan || "");
}
