// BUILD-40 — 390px mobile evidence capture (before AND after; pass OUT=).
//
// Chrome's minimum window width is 500px, so a plain resize can never reach
// phone width — this uses a real 390px Playwright viewport (the audit's
// technique). Captures, against a local static serve of client/dist:
//   - metrics.json: document height, FCP, hero img currentSrc + encoded/
//     transfer bytes, total bytes over the wire, LCP time, reveal-stranding
//     count after five hard scroll jumps
//   - one full-page 390px screenshot (DSF1 — the page is ~14k CSS px tall)
//   - a per-section screenshot of every .lp-section + hero + footer (DSF2)
//   - stranded-after-jumps.png when any section is stuck invisible (the P0-1
//     evidence shot)
// Run:
//   PLAYWRIGHT_DIR=$HOME/steward-qa OUT=docs/build40-2026-08-06/before \
//     node scripts/build40-mobile-capture.js
// Serves client/dist itself on :4181 — build the client first.

const path = require("path");
const fs = require("fs");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const OUT = process.env.OUT || "docs/build40-capture";
const PORT = 4181;
fs.mkdirSync(OUT, { recursive: true });

const http = require("http");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
const srvP = new Promise(resolve => {
  const srv = http.createServer((req, res) => {
    let file = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  srv.listen(PORT, () => resolve(srv));
});

(async () => {
  const srv = await srvP;
  const browser = await chromium.launch();
  const metrics = {};

  // ── metrics pass (cold-ish: fresh context) ──
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    Object.assign(metrics, await page.evaluate(() => {
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const lcp = performance.getEntriesByType("largest-contentful-paint").pop();
      const res = performance.getEntriesByType("resource");
      const hero = document.querySelector(".lp-hero-img");
      const heroRes = hero && res.find(r => r.name.includes(hero.currentSrc.split("/").pop()));
      return {
        docHeight: document.documentElement.scrollHeight,
        fcpMs: fcp ? Math.round(fcp.startTime) : null,
        lcpMs: lcp ? Math.round(lcp.startTime) : null,
        heroSrc: hero ? hero.currentSrc.split("/").pop() : null,
        heroBytes: heroRes ? heroRes.encodedBodySize : null,
        heroResponseEndMs: heroRes ? Math.round(heroRes.responseEnd) : null,
        totalBytes: res.reduce((s, r) => s + (r.encodedBodySize || 0), 0),
        resourceCount: res.length,
      };
    }));

    // Reveal stranding after five hard jumps (the P0-1 failure mode).
    const docH = metrics.docHeight;
    for (const f of [0.22, 0.45, 0.68, 0.9, 1]) {
      await page.evaluate(y => window.scrollTo(0, y), Math.round((docH - 844) * f));
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(600);
    const stranded = await page.evaluate(() =>
      [...document.querySelectorAll(".lp-reveal")]
        .filter(el => el.innerText.trim() && parseFloat(getComputedStyle(el).opacity) < 0.9)
        .map(el => el.innerText.trim().slice(0, 50))
    );
    metrics.strandedAfterJumps = stranded;
    if (stranded.length) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, "stranded-after-jumps.png"), fullPage: true });
    }
    await page.close();
  }

  // ── screenshot pass ──
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    // slow scroll through so every reveal (if armed) fires — these shots
    // document LAYOUT; stranded-after-jumps.png documents the bug.
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < docH; y += 500) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "full-page-390.png"), fullPage: true });

    const sections = await page.evaluate(() => {
      const els = [document.querySelector(".lp-hero-photo"), ...document.querySelectorAll(".lp-section, #invitation, footer")].filter(Boolean);
      return els.map((el, i) => {
        const label = (el.innerText.trim().split("\n")[0] || el.tagName).toLowerCase()
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "section";
        el.setAttribute("data-b40", `s${String(i).padStart(2, "0")}-${label}`);
        return `s${String(i).padStart(2, "0")}-${label}`;
      });
    });
    for (const id of sections) {
      const el = page.locator(`[data-b40="${id}"]`);
      try {
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await el.screenshot({ path: path.join(OUT, id + ".png"), timeout: 5000 });
      } catch { console.log("  (skip shot: " + id + ")"); }
    }
    await page.close();
  }

  await browser.close();
  srv.close();
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  console.log("\nscreenshots + metrics.json in " + OUT + "/");
})().catch(e => { console.error(e); process.exit(1); });
