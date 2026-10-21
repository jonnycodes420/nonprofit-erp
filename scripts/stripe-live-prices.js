#!/usr/bin/env node
// scripts/stripe-live-prices.js · PRICING-1. THE BAND PRICES IN STRIPE.
//
// For every band in pricing.json this makes sure Stripe has one product
// ("Steward · Up to 2,500 records", metadata steward_band=r2500) and three
// prices on it: monthly, yearly (two months free) and the one-time setup fee.
// Then it prints the env lines to paste into Railway, named exactly as
// pricing.json names them (envMonthly / envYearly / envSetup).
//
// SAFE TO RUN TWICE. Every price carries a lookup_key (steward_r2500_monthly,
// steward_r2500_yearly, steward_r2500_setup). A re-run finds the price by its
// key and reuses it when the amount, cadence and currency still match, so the
// second run creates nothing and prints the same ids. If pricing.json changed
// an amount, a NEW price is created with `transfer_lookup_key: true`, which
// moves the key to it; the old price is left as it is (nothing is archived,
// and organisations already on it stay on it).
//
// THE MODE GUARD. The key is STRIPE_BILLING_SECRET_KEY (the platform-billing
// key, never the donation key). A live key is refused unless --live is
// passed, and --live with a test key is refused, both before any network call.
//
// Usage:
//   test mode:   STRIPE_BILLING_SECRET_KEY=sk_test_... node scripts/stripe-live-prices.js
//   live mode:   STRIPE_BILLING_SECRET_KEY=sk_live_... node scripts/stripe-live-prices.js --live
//   preview:     add --dry-run to either; it reads Stripe and creates nothing.
//
// STRIPE_BILLING_API_BASE (tests only) points the client at a local mock, the
// same seam server.js uses for the billing client. PRICING_JSON overrides the
// path of the price list (tests only).
"use strict";
const path = require("path");
const Stripe = require("stripe");

const args = process.argv.slice(2);
const LIVE_FLAG = args.includes("--live");
const DRY = args.includes("--dry-run");

const key = String(process.env.STRIPE_BILLING_SECRET_KEY || "").trim();
if (!key) { console.error("Set STRIPE_BILLING_SECRET_KEY (sk_test_... for test mode)."); process.exit(1); }
const isLive = /^(sk|rk)_live_/.test(key);
const isTest = /^(sk|rk)_test_/.test(key);
if (!isLive && !isTest) { console.error("STRIPE_BILLING_SECRET_KEY is not a Stripe secret key (sk_test_/sk_live_)."); process.exit(1); }
if (isLive && !LIVE_FLAG) { console.error("Refusing: this is a LIVE key. Pass --live to create live prices."); process.exit(1); }
if (isTest && LIVE_FLAG) { console.error("Refusing: --live was passed with a TEST key."); process.exit(1); }

const PRICING = require(process.env.PRICING_JSON ? path.resolve(process.env.PRICING_JSON) : path.join(__dirname, "..", "pricing.json"));

const baseOpts = (() => {
  if (!process.env.STRIPE_BILLING_API_BASE) return {};
  const u = new URL(process.env.STRIPE_BILLING_API_BASE);
  return { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "80"), protocol: u.protocol.replace(":", "") };
})();
const stripe = new Stripe(key, baseOpts);

const created = [];

async function findProduct(bandId) {
  for await (const p of stripe.products.list({ active: true, limit: 100 })) {
    if (p.metadata && p.metadata.steward_band === bandId) return p;
  }
  return null;
}

async function ensureProduct(t) {
  const name = `Steward · ${t.band}`;
  const found = await findProduct(t.id);
  if (found) { console.log(`  product ${found.id} reused (${name})`); return found.id; }
  if (DRY) { console.log(`  product would be created (${name})`); return `(new product ${t.id})`; }
  const p = await stripe.products.create({ name, metadata: { steward_band: t.id } });
  created.push(p.id);
  console.log(`  product ${p.id} created (${name})`);
  return p.id;
}

// want: { lookupKey, cents, interval|null, envName }
async function ensurePrice(productId, t, want) {
  const r = await stripe.prices.list({ lookup_keys: [want.lookupKey], limit: 1 });
  const existing = r.data[0] || null;
  const matches = p => p && p.active !== false && p.currency === "usd" && p.unit_amount === want.cents
    && (want.interval ? (p.recurring && p.recurring.interval === want.interval) : !p.recurring);
  if (matches(existing)) { console.log(`  ${want.lookupKey.padEnd(26)} ${existing.id} reused ($${want.cents / 100})`); return existing.id; }
  const why = existing ? `amount or cadence changed (was ${existing.unit_amount / 100}), moving the key` : "new";
  if (DRY) { console.log(`  ${want.lookupKey.padEnd(26)} would be created ($${want.cents / 100}, ${why})`); return "(new)"; }
  const params = {
    product: productId, currency: "usd", unit_amount: want.cents, lookup_key: want.lookupKey,
    metadata: { steward_band: t.id, steward_price: want.kind },
    ...(want.interval ? { recurring: { interval: want.interval } } : {}),
    ...(existing ? { transfer_lookup_key: true } : {}),
  };
  const p = await stripe.prices.create(params);
  created.push(p.id);
  console.log(`  ${want.lookupKey.padEnd(26)} ${p.id} created ($${want.cents / 100}, ${why})`);
  return p.id;
}

(async () => {
  console.log(`Steward band prices, ${isLive ? "LIVE" : "TEST"} mode${DRY ? " (dry run, nothing is created)" : ""}\n`);
  const env = [];
  for (const t of PRICING.tiers) {
    console.log(`${t.band}`);
    const productId = await ensureProduct(t);
    const wants = [
      { kind: "monthly", lookupKey: `steward_${t.id}_monthly`, cents: Math.round(t.monthlyUsd * 100), interval: "month", envName: t.envMonthly },
      { kind: "yearly", lookupKey: `steward_${t.id}_yearly`, cents: Math.round(t.yearlyUsd * 100), interval: "year", envName: t.envYearly },
      { kind: "setup", lookupKey: `steward_${t.id}_setup`, cents: Math.round(t.setupUsd * 100), interval: null, envName: t.envSetup },
    ];
    for (const w of wants) env.push(`${w.envName}=${await ensurePrice(productId, t, w)}`);
  }
  console.log(`\n${created.length} created. Paste these into ${isLive ? "Railway (production)" : "the test environment"}:\n`);
  for (const line of env) console.log(line);
})().catch(e => { console.error("Failed:", e.message); process.exit(1); });
