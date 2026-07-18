#!/usr/bin/env node
// Landing crispness verifier — tests the DEPLOYED page, not committed files
// (BUILD-12). The whole point of this build: the product shots were declared
// "crisp" and verified green TWICE against the committed WebP files, and still
// looked blurry on retina, because those checks measured the wrong bytes. This
// script measures what a real retina browser actually renders on prod.
//
// The fix shipped in BUILD-12 makes every text-heavy product visual LIVE DOM
// (see Landing.jsx) rather than a raster screenshot — vector text is crisp by
// construction at every DPR, so the primary assertion is simply "this visual
// is DOM, not a raster <img>." For completeness the script ALSO keeps the
// raster fallback branch: if any product visual is still an <img>, its fetched
// currentSrc bytes must decode to naturalWidth ≥ rendered×DPR, be a lossless/
// high-quality type, and not have been downscaled by a CDN optimizer.
//
// Usage:
//   PLAYWRIGHT_DIR=/path/with/playwright node scripts/landing-crispness-prod.js
// Env: BASE (default https://www.stewardapp.dev — the DEPLOYED landing page),
//      OUT  (crop dir, default docs/landing-crispness-<today>).

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://www.stewardapp.dev";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", `landing-crispness-${new Date().toISOString().split("T")[0]}`);

// The product visuals on the landing page, keyed to a stable DOM hook each.
// All are DOM/SVG as of BUILD-12; the calculator card is the crispness
// reference standard the others were built to match.
const TARGETS = [
  { name: "hero-goal",      sel: ".lp-goalcard" },
  { name: "hero-retention", sel: ".lp-retcard" },
  { name: "queue",          sel: ".lp-qcard" },
  { name: "receipt",        sel: ".lp-receipt" },
  { name: "recovery-email", sel: ".lp-email" },
  { name: "import",         sel: ".lp-import" },
  { name: "climb",          sel: ".lp-climb" },
  { name: "calculator",     sel: ".lp-calc-card" },
];

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
};

const LOSSLESS_CT = /image\/(png|webp|svg|gif)/i; // webp here only matters for the raster fallback

async function run(browser, dpr) {
  console.log(`\n== DPR ${dpr} (deployed: ${BASE}) ==`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  // Trigger any lazy content, then settle.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);

  // Primary: every product visual is present, and NONE of them is a raster
  // <img> of the product — text is real DOM, crisp at every DPR.
  const report = await page.evaluate((TARGETS) => {
    const rasterProductImgs = [...document.querySelectorAll('img')].filter(i => /\/lp-/.test(i.currentSrc || i.src));
    const rows = TARGETS.map(tg => {
      const el = document.querySelector(tg.sel);
      const isImg = el ? el.tagName === "IMG" : false;
      const hasProductImgInside = el ? !![...el.querySelectorAll('img')].find(i => /\/lp-/.test(i.currentSrc || i.src)) : false;
      return { name: tg.name, present: !!el, isImg, hasProductImgInside };
    });
    return {
      rows,
      rasterProductImgs: rasterProductImgs.map(i => ({ src: (i.currentSrc || i.src), rendered: Math.round(i.getBoundingClientRect().width) })),
    };
  }, TARGETS);

  for (const r of report.rows) {
    t(`${r.name.padEnd(16)} present`, r.present, "selector not found");
    if (r.present) t(`${r.name.padEnd(16)} is live DOM (not a raster shot)`, !r.isImg && !r.hasProductImgInside, "renders as/contains a raster <img>");
  }
  t(`no raster /lp- product <img> anywhere (found ${report.rasterProductImgs.length})`, report.rasterProductImgs.length === 0,
    report.rasterProductImgs.map(i => i.src.split("/").pop()).join(", "));

  // Raster fallback branch: if any product image DID survive as raster, hold it
  // to the retina bar against its ACTUAL fetched bytes (not the committed file).
  for (const img of report.rasterProductImgs) {
    const meta = await page.evaluate(async (src) => {
      const im = new Image();
      const loaded = await new Promise(res => { im.onload = () => res(true); im.onerror = () => res(false); im.src = src; });
      let ct = "";
      try { const resp = await fetch(src, { method: "GET" }); ct = resp.headers.get("content-type") || ""; } catch {}
      return { ok: loaded, natural: im.naturalWidth, ct };
    }, img.src);
    const need = img.rendered * dpr;
    t(`raster ${img.src.split("/").pop()} bytes ≥ rendered×${dpr} (${meta.natural} ≥ ${need})`, meta.natural >= need - 1, `${meta.natural} < ${need}`);
    t(`raster ${img.src.split("/").pop()} lossless/high-quality type (${meta.ct})`, LOSSLESS_CT.test(meta.ct), meta.ct);
  }

  await ctx.close();
}

async function crops(browser) {
  console.log(`\n== DPR-3 crops → ${OUT} ==`);
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(600);
  for (const name of ["hero-goal", "receipt", "queue"]) {
    const sel = TARGETS.find(x => x.name === name).sel;
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await el.screenshot({ path: path.join(OUT, `${name}-3x.png`) });
      console.log(`  ✓ ${name}-3x.png`);
    } else t(`crop ${name} present`, false);
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const dpr of [2, 3]) await run(browser, dpr);
  await crops(browser);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
