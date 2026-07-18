#!/usr/bin/env node
// Landing image/crispness verifier — DOM-aware rewrite (BUILD-12).
//
// History: this script used to assert every product <img> supplied ≥N× raw
// pixels for retina. It passed 12/12 TWICE while the shots still looked blurry,
// because captured UI text (a downscaled bitmap of antialiased glyphs) can't be
// crisp at every DPR no matter how many pixels you throw at it — and because it
// measured the COMMITTED files, not what prod served. BUILD-12 fixed the cause:
// the product visuals are now LIVE DOM/SVG (vector text, crisp by construction).
//
// So the crispness invariant is now structural, and this script asserts it that
// way: there is NO raster product <img> on the page (any such <img> is a
// regression back to the blur), and the DOM product shots are present. The
// richer, byte-level, DPR-2/3, crop-saving check lives in the companion
// scripts/landing-crispness-prod.js — run that against the DEPLOYED page.
//
// Usage:  PLAYWRIGHT_DIR=/path/with/playwright node scripts/landing-image-verify.js
// Env:    BASE (default https://www.stewardapp.dev — the deployed landing page).

const path = require("path");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://www.stewardapp.dev";

// Every product visual, keyed to a stable DOM hook (all DOM as of BUILD-12).
const TARGETS = [
  [".lp-goalcard", "hero goal card"],
  [".lp-retcard", "hero retention card"],
  [".lp-qcard", "needs-attention queue"],
  [".lp-receipt", "tax receipt"],
  [".lp-email", "recovery email"],
  [".lp-import", "CSV import"],
  [".lp-climb", "goal climb"],
  [".lp-calc-card", "recurring-loss calculator (reference)"],
];

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
};

(async () => {
  const browser = await chromium.launch();
  for (const dpr of [2, 3]) {
    console.log(`\n== DPR ${dpr} ==`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(700);

    const res = await page.evaluate((TARGETS) => {
      const present = TARGETS.map(([sel, label]) => {
        const el = document.querySelector(sel);
        return { label, present: !!el, isImg: el ? el.tagName === "IMG" : false };
      });
      const rasterProduct = [...document.querySelectorAll('img')].filter(i => /\/lp-/.test(i.currentSrc || i.src)).map(i => (i.currentSrc || i.src).split("/").pop());
      return { present, rasterProduct };
    }, TARGETS);

    for (const p of res.present) {
      t(`${p.label} present as DOM`, p.present && !p.isImg, p.present ? "is a raster <img>" : "not found");
    }
    t(`no raster /lp- product image (found ${res.rasterProduct.length})`, res.rasterProduct.length === 0, res.rasterProduct.join(", "));
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
