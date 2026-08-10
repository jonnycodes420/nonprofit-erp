// BUILD-49 verification + screenshots.
//   PLAYWRIGHT_DIR=$HOME/steward-qa BASE=http://localhost:4173 node scripts/build49-capture.js
const path = require("path");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:4173";
const OUT = path.join(__dirname, "..", "docs", "build49-2026-08-09");
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log("  FAIL " + n + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 200) : ""))); };

(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 844], [1440, 1000]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const errors = [];
    // Ignore the Vercel analytics/speed-insights beacons (@vercel/* in main.jsx):
    // they resolve on Vercel but 404 on local `vite preview` → SPA fallback HTML
    // → "Unexpected token '<'". Production-only endpoints, not a page error.
    const isVercelArtifact = t => /_vercel|vercel\/insights|speed-insights|Failed to load resource.*40\d|Unexpected token '<'/i.test(t);
    page.on("console", m => { if (m.type() === "error" && !isVercelArtifact(m.text())) errors.push(m.text()); });
    page.on("pageerror", e => { if (!isVercelArtifact(String(e))) errors.push(String(e)); });

    // ── Pricing ──
    await page.goto(BASE + "/pricing", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `pricing-${w}.png`), fullPage: true });
    const priceText = await page.evaluate(() => document.body.innerText);
    const priceInvLinks = await page.evaluate(() => [...document.querySelectorAll('a[href*="/invitation"], button')].filter(el => /invitation/i.test(el.getAttribute("href") || el.textContent || "")).length);
    if (w === 1440) {
      ok("pricing: H1 'Two plans, split on a real line.'", /Two plans, split on a real line\./.test(priceText));
      ok("pricing: line-3 free-through-Dec-31 + Jan-1 start", /Free through December 31, 2026/.test(priceText) && /start January 1, 2027/.test(priceText));
      ok("pricing: Core $149 + Team $299", /\$149/.test(priceText) && /\$299/.test(priceText));
      ok("pricing: no '$249' anywhere", !/\$249/.test(priceText));
      ok("pricing: no 'invitation-only'", !/invitation-only/i.test(priceText));
      ok("pricing: no 'founding partner'", !/founding partner/i.test(priceText));
      ok("pricing: no 'COMING SOON' badge", !/coming soon/i.test(priceText));
      ok("pricing: 'Start free' CTA present", /Start free/i.test(priceText));
      ok("pricing: NO link/button referencing /invitation", priceInvLinks === 0, priceInvLinks);
      ok("pricing: bands active-donor line present", /Bands count active donors/.test(priceText));
      ok("pricing: Foundation Portal add-on present", /Foundation Portal/.test(priceText) && /Ask about it/.test(priceText));
      ok("pricing: footer strip items present", /No platform fee/.test(priceText) && /No donor tip/.test(priceText) && /cancel anytime/i.test(priceText));
      ok("pricing: quote block gone (no 'cheaper than the real CRMs')", !/cheaper than the real CRMs/i.test(priceText));
    }

    // ── Landing ──
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    // scroll to trigger reveals, then to bottom
    await page.evaluate(async () => { for (let y = 0; y <= document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `landing-${w}.png`), fullPage: true });
    const landText = await page.evaluate(() => document.body.innerText);
    const meta = await page.evaluate(() => ({
      reveal: document.querySelectorAll(".lp-reveal").length,
      sections: document.querySelectorAll(".lp section, .lp .lp-section, .lp > section").length,
      hiddenReveal: [...document.querySelectorAll(".lp-reveal")].filter(e => getComputedStyle(e).opacity === "0").length,
      deadAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(a => { const id = a.getAttribute("href").slice(1); return id && !document.getElementById(id) && !document.getElementsByName(id).length; }).map(a => a.getAttribute("href")),
      invLinks: [...document.querySelectorAll('a[href*="/invitation"]')].map(a => a.getAttribute("href")),
      invBtns: [...document.querySelectorAll("button")].filter(b => /request an invitation/i.test(b.textContent || "")).length,
    }));
    if (w === 1440) {
      ok("landing: 'Where Steward is today' section GONE", !/Where Steward is today/i.test(landText));
      ok("landing: 'A letter from the founder' section GONE", !/letter from the founder/i.test(landText) && !/Why I built Steward/i.test(landText));
      ok("landing: 'Load-tested to 25,000' claim GONE", !/Load-tested to 25,000/i.test(landText));
      ok("landing: 'Start free' CTA present", /Start free/i.test(landText));
      ok("landing: no /invitation links", meta.invLinks.length === 0, meta.invLinks);
      ok("landing: no 'Request an invitation' buttons", meta.invBtns === 0, meta.invBtns);
      ok("landing: no 'founding' copy", !/founding/i.test(landText));
      ok("landing: no dead in-page anchors", meta.deadAnchors.length === 0, meta.deadAnchors);
      ok("landing: no opacity:0 stranded reveals after scroll", meta.hiddenReveal === 0, meta.hiddenReveal);
      console.log(`  INFO landing .lp-reveal nodes = ${meta.reveal}; console errors = ${errors.length}`);
      ok("landing: no console errors", errors.length === 0, errors.slice(0, 3));
    }
    await page.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed  ·  screenshots → ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
