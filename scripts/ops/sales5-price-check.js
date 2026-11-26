#!/usr/bin/env node
// scripts/ops/sales5-price-check.js · SALES-5 item 5. WON DEALS WHOSE PRICES DISAGREE.
//
// Before SALES-5 a customer had four prices and nothing tied them: the deal's value, the signed
// order's or accepted quote's price, the Steward org's agreed price (billing_mrr_cents) and what
// Stripe bills now. Every sales screen now shows ONE (server/admin/sales/customerPrice.js: Stripe if
// billing, else the order or quote, else the agreed price, else the deal's value). The deal's own
// value_cents still disagrees on rows written before. This lists them:
//
//   node scripts/ops/sales5-price-check.js
//       DRY RUN: every won deal whose prices disagree: the deal id, each price and which one the
//       rule picks. Ids and cents only: no organization's or person's name.
//   node scripts/ops/sales5-price-check.js --deal <id> --apply [--i-know-this-is-prod]
//       sets that one deal's value_cents to the price the rule picks, stamped
//       system:sales5-price-check, with a note on the deal saying what changed and why. Through
//       prodGuard.writerDbUrl (a remote database needs --i-know-this-is-prod). Jonathan runs it.
//
// Never runs at deploy. Nothing sends. Stripe, orders and quotes are read, never written.
"use strict";
const argv = process.argv.slice(2);
const val = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const APPLY = argv.includes("--apply");
const DEAL = val("--deal");
const WHO = { id: "system:sales5-price-check", name: "SALES-5 price check" };

function refuse(why) { console.error(`\nREFUSED: ${why}\n`); process.exit(2); }
if (!process.env.DATABASE_URL) refuse("set DATABASE_URL first.");
if (APPLY && !DEAL) refuse("--apply sets one deal: name it with --deal <id>.");
if (APPLY) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();

const cents = c => (c == null ? "–" : `$${(Number(c) / 100).toFixed(2)}`);

// Pure: do the prices this deal carries disagree?
function disagrees(p) {
  const seen = Object.values(p.prices).filter(c => c != null && c > 0);
  return new Set(seen).size > 1 || (p.source !== "deal" && p.prices.deal !== p.cents);
}

async function find(query, only = null) {
  const P = require("../../server/admin/sales/customerPrice");
  const won = await query(`SELECT d.id FROM sales_deals d JOIN sales_stages s ON s.id = d.stage_id
                            WHERE d.deleted_at IS NULL AND s.kind = 'won' ${only ? "AND d.id = ?" : ""} ORDER BY d.won_at NULLS LAST, d.id`, only ? [only] : []);
  const prices = await P.forDealIds(query, won.map(r => r.id));
  return won.map(r => ({ id: r.id, p: prices.get(r.id) })).filter(x => x.p && disagrees(x.p));
}

async function main() {
  const { query, run } = require("../../db");
  const rows = await find(query, DEAL);
  console.log(`Won deals whose prices disagree: ${rows.length}${DEAL ? ` (asked for ${DEAL})` : ""}.`);
  for (const { id, p } of rows) {
    console.log(`  ${id}  stripe ${cents(p.prices.stripe).padStart(10)}  order ${cents(p.prices.order).padStart(10)}  quote ${cents(p.prices.quote).padStart(10)}`
      + `  agreed ${cents(p.prices.agreed).padStart(10)}  deal ${cents(p.prices.deal).padStart(10)}  → ${cents(p.cents)} (${p.source})`);
  }
  if (!APPLY) { console.log("\nDry run: nothing was written." + (rows.length ? " Add --deal <id> --apply to set one deal's value to the price the rule picks." : "")); return; }
  const hit = rows.find(r => r.id === DEAL);
  if (!hit) { console.log(`\n${DEAL} is not a won deal whose prices disagree. Nothing to do.`); return; }
  if (hit.p.prices.deal === hit.p.cents) { console.log(`\n${DEAL}'s value already is ${cents(hit.p.cents)}. Nothing to do.`); return; }
  await run(`UPDATE sales_deals SET value_cents = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`,
    [hit.p.cents, WHO.id, WHO.name, DEAL]);
  await require("../../server/admin/sales/activities").create({ query, run }, { kind: "note", records: [{ type: "deal", id: DEAL }],
    body: `Price check (SALES-5): the deal's value went from ${cents(hit.p.prices.deal)} to ${cents(hit.p.cents)}/mo, ${hit.p.sourceWords}.` }, WHO);
  console.log(`\nSet ${DEAL}'s value from ${cents(hit.p.prices.deal)} to ${cents(hit.p.cents)}, stamped ${WHO.id}, with a note on the deal. Nothing was sent.`);
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
module.exports = { disagrees, find };
