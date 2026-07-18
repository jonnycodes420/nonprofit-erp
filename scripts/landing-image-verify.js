#!/usr/bin/env node
// Landing image resolution verifier (BUILD-10 Part 2). Asserts every product
// <img> on the landing page is supplied enough REAL pixels to be crisp on
// retina, and saves 300%-zoom (DPR-3, device-pixel) crops of the hero/queue/
// receipt so the sharpness is inspectable by eye.
//
// Invariant: the loaded srcset candidate's RAW bitmap width must be
//   ≥ renderedCSSwidth × N,  N = 3 for the hero (lp-home), 2 for the rest.
// Checked at DPR 2 (every image ≥2× — "crisp on 2x") and DPR 3 (hero ≥3×,
// others ≥2×). This is also the "never render wider than naturalWidth/2"
// guard: raw ≥ 2×rendered ⇔ rendered ≤ raw/2.
//
// Why not read img.naturalWidth directly: with a `w`-descriptor srcset the
// browser reports naturalWidth DENSITY-CORRECTED (≈ the CSS-intrinsic size,
// not the bitmap), so it would read ~1× rendered and the invariant could
// never pass. We instead load each `currentSrc` into a BARE Image (no
// srcset) whose naturalWidth IS the true bitmap width — the real question of
// "how many pixels did retina actually get for this slot".
//
// Usage:
//   PLAYWRIGHT_DIR=/path/with/playwright node scripts/landing-image-verify.js
// Env: BASE (default https://www.stewardapp.dev — the deployed landing page),
//      OUT  (crop dir, default docs/landing-retina-<today>).

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://www.stewardapp.dev";
const OUT = process.env.OUT || path.join(__dirname, "..", "docs", `landing-retina-${new Date().toISOString().split("T")[0]}`);

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
};

async function measure(browser, dpr) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  // Trigger every lazy image, then return to top so rendered widths are stable.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
  const data = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll("img")].filter(i => /\/lp-/.test(i.currentSrc || i.src));
    // Bare-Image load → true bitmap width of the exact file the srcset chose.
    const rawWidth = url => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = url; });
    const out = [];
    for (const i of imgs) {
      const src = i.currentSrc || i.src;
      out.push({ file: (src.split("/").pop() || ""), rendered: Math.round(i.getBoundingClientRect().width), raw: await rawWidth(src) });
    }
    return out;
  });
  await ctx.close();
  return data;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const dpr of [2, 3]) {
    console.log(`\n== DPR ${dpr} ==`);
    const rows = await measure(browser, dpr);
    if (!rows.length) { t(`DPR ${dpr}: landing product images present`, false, "no /lp- images found"); continue; }
    for (const r of rows) {
      const isHero = /lp-home/.test(r.file);
      const need = (dpr === 3 && isHero) ? 3 : 2; // hero demands 3× on a 3× screen; every image ≥2×
      const ok = r.raw >= r.rendered * need - 1;
      t(`${r.file.padEnd(22)} rendered=${String(r.rendered).padStart(4)} raw=${String(r.raw).padStart(4)} (needs ≥${need}×)`, ok, `${r.raw} < ${r.rendered * need}`);
    }
  }

  // ── 300%-zoom crops: capture the hero/queue/receipt <img> elements at DPR 3
  //    (their device pixels ARE a 3× view of the CSS size). A reviewer opening
  //    these 1:1 sees exactly what a retina visitor sees. ──
  console.log(`\n== retina crops → ${OUT} ==`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } });
  await page.waitForTimeout(800);
  for (const [name, sel] of [["hero", 'img[src*="lp-home"]'], ["queue", 'img[src*="lp-queue"]'], ["receipt", 'img[src*="lp-receipt"]']]) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await el.screenshot({ path: path.join(OUT, `${name}-retina-3x.png`) });
      console.log(`  ✓ ${name}-retina-3x.png`);
    } else t(`crop: ${name} image found`, false);
  }
  await ctx.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
