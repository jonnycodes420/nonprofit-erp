#!/usr/bin/env node
// ONBOARD-4 item 2 · THE PUBLIC SITE CARRIES NO PRICE, AND THE BUILD FAILS IF IT DOES.
//
// Jonathan, 23 Nov 2026: the website closes nothing and shows no prices; prices reach a customer
// on the call, in his quote and his close link. `npm run build` runs this after the prerender. It
// reads what the public actually gets:
//   · every prerendered marketing page (dist/<path>/index.html), head and body;
//   · the marketing site's own code (dist-prerender/prerender.mjs, every page and data module);
//   · the public app pages' chunks: Lost & Found, Terms, Privacy, Log in.
// and fails on:
//   · a monthly or yearly price from pricing.json (current and legacy bands), as "$199" or "$1,990";
//   · a setup fee from pricing.json within 80 characters of the word "setup" (a bare "$250" is
//     also the IRS acknowledgment line in the glossary, so the figure alone can't be the rule);
//   · pricing.json's own keys (monthlyUsd, yearlyUsd, setupUsd): the price list bundled in;
//   · an offer of Steward for free ("Start free", "free trial", "months free", "free for 30 days").
// Guard by the rendered output, never by banning a string in source (BUILD-90's rule).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fmt = n => "$" + Number(n).toLocaleString("en-US");
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function priceRules(pricing) {
  const bands = [...(pricing.tiers || []), ...(pricing.legacyTiers || [])];
  const always = new Set(), setup = new Set();
  for (const t of bands) {
    for (const k of ["monthlyUsd", "yearlyUsd"]) if (Number.isFinite(Number(t[k])) && t[k] != null) { always.add(fmt(t[k])); always.add("$" + t[k]); }
    if (t.setupUsd != null) { setup.add(fmt(t.setupUsd)); setup.add("$" + t.setupUsd); }
  }
  const fig = set => new RegExp("(" + [...set].map(esc).join("|") + ")(?![\\d,]*\\d)", "g");
  return { always: fig(always), setup: fig(setup) };
}

const FREE = /\b(start(?:ing)? free|free trial|months? free|free for (?:30|thirty) days|try (?:it |steward )?free)\b/i;
const KEYS = /\b(monthlyUsd|yearlyUsd|setupUsd)\b/;

// Every hit in one text, each with a few words around it.
export function findPrices(text, rules, where = "") {
  const hits = [];
  const around = i => text.slice(Math.max(0, i - 50), i + 60).replace(/\s+/g, " ");
  for (const m of text.matchAll(rules.always)) hits.push({ where, kind: "price", figure: m[1], around: around(m.index) });
  for (const m of text.matchAll(rules.setup)) {
    const near = text.slice(Math.max(0, m.index - 80), m.index + 80);
    if (/setup|set-up|set up/i.test(near)) hits.push({ where, kind: "setup fee", figure: m[1], around: around(m.index) });
  }
  const f = text.match(FREE); if (f) hits.push({ where, kind: "free offer", figure: f[0], around: around(f.index) });
  const k = text.match(KEYS); if (k) hits.push({ where, kind: "price list bundled", figure: k[0], around: around(k.index) });
  return hits;
}

async function main() {
  const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const DIST = path.join(CLIENT, "dist");
  const pricing = JSON.parse(fs.readFileSync(path.join(CLIENT, "..", "pricing.json"), "utf8"));
  const rules = priceRules(pricing);
  const { ROUTES } = await import(pathToFileURL(path.join(CLIENT, "dist-prerender", "prerender.mjs")).href);
  const files = ROUTES.map(r => path.join(DIST, r.path === "/" ? "index.html" : r.path.slice(1) + "/index.html")).filter(f => fs.existsSync(f));
  files.push(path.join(CLIENT, "dist-prerender", "prerender.mjs"));
  const assets = path.join(DIST, "assets");
  for (const f of fs.existsSync(assets) ? fs.readdirSync(assets) : []) {
    if (/^(LostAndFound|TermsPage|PrivacyPage|LoginPage|siteBundle)-[\w-]+\.js$/.test(f)) files.push(path.join(assets, f));
  }
  const hits = files.flatMap(f => findPrices(fs.readFileSync(f, "utf8"), rules, path.relative(CLIENT, f)));
  if (hits.length) {
    console.error(`no-public-prices: ${hits.length} price${hits.length === 1 ? "" : "s"} on the public site (ONBOARD-4: the site shows no price):`);
    for (const h of hits.slice(0, 40)) console.error(`  ${h.where}: ${h.kind} ${h.figure} … ${h.around}`);
    process.exit(1);
  }
  console.log(`no-public-prices: ${files.length} files of the public site read, no price, no setup fee figure, no free offer.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
