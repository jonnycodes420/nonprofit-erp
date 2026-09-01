#!/usr/bin/env node
// BUILD-73 Part 4 — the landing captures. Read-only, loopback-only.
//
// A green build proves nothing about a page a human has to read. These are the
// bytes for the human walk: the full page at both reference widths, plus the
// year section on its own (where January/June/December must be checkable by eye
// against the nesting claim) and the field under reduced motion (where a
// regression means an invisible hero).
//
// Usage (server + local-preview already up):
//   node scripts/build73-landing-capture.js
//   APP_ORIGIN=http://localhost:4173 node scripts/build73-landing-capture.js

const path = require("path");
const fs = require("fs");

const APP = process.env.APP_ORIGIN || "http://localhost:4173";
const PW = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const OUT = path.join(__dirname, "..", "docs", "landing");

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(APP)) {
  console.error(`REFUSED: APP_ORIGIN=${APP} is not loopback. This capture is local-only.`);
  process.exit(1);
}
let chromium;
try { ({ chromium } = require(path.join(PW, "node_modules", "playwright"))); }
catch { console.log("SKIP — Playwright not found (set PLAYWRIGHT_DIR)"); process.exit(0); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shot = async (page, name) => {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file, fullPage: !name.includes("section") });
    console.log("  wrote", path.relative(path.join(__dirname, ".."), file));
  };

  for (const [w, h, tag] of [[1440, 1000, "1440"], [390, 844, "390"]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.goto(APP + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2200);          // let the entrance wave finish
    await shot(page, `landing-${tag}.png`);
    // The year section on its own — the nesting claim, checkable by eye.
    const yr = await page.$("#how-it-works");
    if (yr) { await yr.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
              await yr.screenshot({ path: path.join(OUT, `year-section-${tag}.png`) });
              console.log("  wrote", `docs/landing/year-section-${tag}.png`); }
    await page.close();
  }

  // Reduced motion — the field must be VISIBLE. A regression here is a blank
  // hero for every visitor with the OS setting on.
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const rp = await ctx.newPage();
  await rp.goto(APP + "/", { waitUntil: "networkidle" });
  await rp.waitForTimeout(900);
  await rp.screenshot({ path: path.join(OUT, "landing-1440-reduced-motion.png") });
  console.log("  wrote docs/landing/landing-1440-reduced-motion.png");
  await ctx.close();

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
