// BUILD-40 P0-1 — no invisible landing content, at phone AND desktop width.
//
// The bug this pins: `.lp-reveal` was authored fail-CLOSED (base opacity:0,
// visibility depends on an IntersectionObserver callback arriving). A fast
// momentum flick, an anchor jump, or back-navigation scroll restoration moves
// sections through the viewport BETWEEN observer callbacks — they never get
// `is-visible` and stay blank forever. Measured live 2026-08-06: EIGHT
// sections at opacity 0 in a 390px viewport (calculator, morning queue,
// how-it-works, money strip, candor…). The fix inverts to fail-open
// (hidden state scoped to html.reveal-ready, desktop-only ≥768px, with a
// recovery sweep); this test drives the exact failure mode:
//
//   at 390px and 1440px: hard-jump scrollTo() five positions spanning the
//   page, then assert ZERO text-bearing .lp-reveal sections with computed
//   opacity < 0.9.
//
// Also drives the P2 concern most likely to embarrass a live demo: the
// calculator slider must be DRAGGABLE at 390px (real pointer drag on the
// thumb, not a synthetic value setter) and must update the loss figure.
//
// Needs a browser + built client, unlike the API suites, so it bootstraps
// itself: serves client/dist on its own port and loads Playwright from
// PLAYWRIGHT_DIR (default ~/steward-qa — Playwright is deliberately not a
// project dep). If either is missing it SKIPS (exit 0, "0 failed") so
// `run-all.sh` stays runnable on a bare API-only checkout — but on the dev
// machine it always runs for real.

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const PORT = 4179;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};
const skip = why => { console.log("  SKIP  " + why + "\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); };

if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built (run `npx vite build` in client/)");
let chromium;
try {
  module.paths.unshift(path.join(PW_DIR, "node_modules"));
  ({ chromium } = require("playwright"));
} catch {
  skip("Playwright not found (set PLAYWRIGHT_DIR)");
}

// Serve client/dist ourselves — no vite dependency at test time, and no
// collision with a dev preview on 4173.
const http = require("http");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
function serveDist() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      let file = path.join(DIST, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html"); // SPA fallback
      res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

async function noInvisibleTextAfterJumps(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  // Hard jumps — the momentum-flick / anchor-jump / scroll-restoration case.
  // Instant (non-smooth) scrollTo moves sections through the viewport between
  // IntersectionObserver callbacks, which is exactly what stranded them.
  for (const f of [0.22, 0.45, 0.68, 0.9, 1]) {
    await page.evaluate(y => window.scrollTo(0, y), Math.round((docH - height) * f));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600); // give any transition time to finish
  const invisible = await page.evaluate(() =>
    [...document.querySelectorAll(".lp-reveal")]
      .filter(el => el.innerText.trim().length > 0 && parseFloat(getComputedStyle(el).opacity) < 0.9)
      .map(el => el.innerText.trim().slice(0, 60))
  );
  const res = { width, docH, invisible };
  await page.close();
  return res;
}

(async () => {
  const srv = await serveDist();
  const browser = await chromium.launch();

  // ── 1. Zero invisible sections after hard scroll jumps, phone + desktop ──
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const r = await noInvisibleTextAfterJumps(browser, w, h);
    ok(`${w}px: zero text-bearing sections stuck at opacity<0.9 after 5 scroll jumps`,
      r.invisible.length === 0, r.invisible);
  }

  // ── 2. Fail-open: with JS-driven reveal never arming (reduced-motion is the
  //      cheap proxy for "the animation path didn't run"), everything shows ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll(".lp-reveal")].filter(el => parseFloat(getComputedStyle(el).opacity) < 0.9).length
    );
    ok("prefers-reduced-motion: every section visible immediately (no reveal state)", hidden === 0, hidden);
    await page.close();
  }

  // ── 3. Phone width: reveals are OFF entirely (no hidden base state below
  //      768px — scroll animations add nothing on a phone, cost everything) ──
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    // Immediately after load, BEFORE any scrolling: below-the-fold sections
    // must already be fully opaque at phone width.
    await page.waitForTimeout(250);
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll(".lp-reveal")].filter(el => parseFloat(getComputedStyle(el).opacity) < 0.9).length
    );
    ok("390px: no section is ever opacity-hidden (reveals disabled under 768px)", hidden === 0, hidden);
    await page.close();
  }

  // ── 4. Calculator slider: real pointer drag at 390px updates the figure ──
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    const slider = page.locator(".lp-slider");
    await slider.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const before = await page.locator(".lp-calc-loss").innerText();
    const box = await slider.boundingBox();
    ok("slider present and sized at 390px", !!box && box.width > 200, box);
    // Drag the thumb from its current position to ~90% of the track.
    const startX = box.x + box.width * (1300 / 19800); // value 1500 of 200–20000
    const y = box.y + box.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await page.locator(".lp-calc-loss").innerText();
    const val = await slider.inputValue();
    ok("slider drag moved the value", Number(val) > 10000, val);
    ok("loss figure updated from the drag", after !== before, { before, after });
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
