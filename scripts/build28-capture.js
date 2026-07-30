// BUILD-28 — DSF3 screenshots of the image-forward landing.
//   PLAYWRIGHT_DIR=/path/with/playwright BASE=http://localhost:4173 \
//     node scripts/build28-capture.js
const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "build28-" + new Date().toISOString().slice(0, 10));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const save = async (name, fn) => { await fn(); console.log("  ✓ " + name + ".png"); };

  // Desktop (1440, DSF3): hero above the fold, verticals band, product proof
  const dp = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
  await dp.goto(BASE, { waitUntil: "networkidle" });
  await dp.waitForTimeout(700);
  await save("desktop-hero", () => dp.screenshot({ path: path.join(OUT, "desktop-hero.png") }));
  await save("verticals-band", async () => {
    const el = await dp.$("section:has(.lp-vert-grid)");
    await el.scrollIntoViewIfNeeded(); await dp.waitForTimeout(300);
    await el.screenshot({ path: path.join(OUT, "verticals-band.png") });
  });
  await save("product-proof", async () => {
    const el = await dp.$(".lp-proof");
    await el.scrollIntoViewIfNeeded(); await dp.waitForTimeout(400);
    await el.screenshot({ path: path.join(OUT, "product-proof.png") });
  });
  await save("studio-band", async () => {
    const el = await dp.$(".lp-band-img");
    await el.scrollIntoViewIfNeeded(); await dp.waitForTimeout(300);
    await el.screenshot({ path: path.join(OUT, "studio-band.png") });
  });
  await dp.close();

  // Mobile (390, DSF3): hero — type legible, composition intact
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await mp.goto(BASE, { waitUntil: "networkidle" });
  await mp.waitForTimeout(700);
  await save("mobile-hero", () => mp.screenshot({ path: path.join(OUT, "mobile-hero.png") }));
  await mp.close();

  await browser.close();
  console.log("→ " + OUT);
})().catch(e => { console.error(e); process.exit(1); });
