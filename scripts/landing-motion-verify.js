// landing-motion-verify.js — BUILD-29 premium scroll-reveal + CLS guard.
// Proves: (1) `.lp-reveal` sections start hidden and reveal ONCE as they enter
// view; (2) prefers-reduced-motion renders everything immediately (no-motion
// path, non-negotiable for a11y); (3) the reveals cause NO layout shift
// (CLS ≤ 0.02 — opacity/transform only). Also asserts there are no auto popups/
// modals/interstitials on load (capture is via the CTAs only).
//
// Usage: PLAYWRIGHT_DIR=/path/with/playwright BASE=http://localhost:4173 \
//        node scripts/landing-motion-verify.js
//   (default BASE https://www.stewardapp.dev)
const path = require("path");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");
const BASE = process.env.BASE || "https://www.stewardapp.dev";

let pass = 0, fail = 0;
const ok = (msg, cond, extra) => { if (cond) { pass++; console.log("  PASS  " + msg); } else { fail++; console.error("  ✗ " + msg + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); } };

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.75);
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 300));
  });
}

(async () => {
  console.log("landing-motion-verify against " + BASE + "\n");
  const browser = await chromium.launch();

  // ── 1. Motion ON: sections start hidden, reveal once on scroll ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    // A below-the-fold reveal section should not be visible yet.
    const belowFoldHidden = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".lp-reveal")];
      const below = els.find(e => e.getBoundingClientRect().top > window.innerHeight + 40);
      if (!below) return null;
      return parseFloat(getComputedStyle(below).opacity);
    });
    ok("a below-the-fold section starts hidden (opacity ~0)", belowFoldHidden === null || belowFoldHidden < 0.15, belowFoldHidden);

    await scrollThrough(page);
    const revealState = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".lp-reveal")];
      const visible = els.filter(e => e.classList.contains("is-visible")).length;
      const opaque = els.filter(e => parseFloat(getComputedStyle(e).opacity) > 0.98).length;
      return { total: els.length, visible, opaque };
    });
    ok("every .lp-reveal section exists", revealState.total >= 8, revealState);
    ok("every reveal fired (is-visible) after scrolling through", revealState.visible === revealState.total, revealState);
    ok("every reveal is fully opaque after firing", revealState.opaque === revealState.total, revealState);
    await page.close();
  }

  // ── 2. Reduced motion: everything visible immediately, no transform ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const rm = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".lp-reveal")];
      const opaque = els.filter(e => parseFloat(getComputedStyle(e).opacity) > 0.98).length;
      const noTransform = els.filter(e => { const t = getComputedStyle(e).transform; return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)"; }).length;
      return { total: els.length, opaque, noTransform };
    });
    ok("reduced-motion: ALL reveal sections opaque immediately (no fade)", rm.opaque === rm.total, rm);
    ok("reduced-motion: ALL reveal sections have no transform (no rise)", rm.noTransform === rm.total, rm);
    await page.close();
  }

  // ── 3. CLS ≤ 0.02 over a full scroll (reveals must not shift layout) ──
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { if (!e.hadRecentInput) window.__cls += e.value; }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await scrollThrough(page);
    await page.waitForTimeout(300);
    const cls = await page.evaluate(() => window.__cls || 0);
    ok("CLS ≤ 0.02 over a full scroll (mobile)", cls <= 0.02, +cls.toFixed(4));
    await page.close();
  }

  // ── 4. No auto popups / modals / interstitials on load ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const overlays = await page.evaluate(() => {
      // Any fixed, full-viewport-ish element covering the page = an interstitial.
      return [...document.querySelectorAll("body *")].filter(el => {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" || cs.display === "none" || parseFloat(cs.opacity) < 0.1) return false;
        const r = el.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.8 && r.height >= window.innerHeight * 0.6;
      }).length;
    });
    ok("no auto popup/modal/interstitial covers the page on load", overlays === 0, overlays);
    await page.close();
  }

  await browser.close();
  console.log(`\nlanding-motion-verify: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
