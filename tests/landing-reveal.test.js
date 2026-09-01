// BUILD-40 P0-1, rewritten by BUILD-73 Part 4 — NO INVISIBLE LANDING CONTENT.
//
// ── WHAT THIS ORIGINALLY PINNED, AND WHY IT CHANGED ─────────────────────────
// The BUILD-40 bug: `.lp-reveal` was authored fail-CLOSED (base opacity:0,
// visibility depending on an IntersectionObserver callback arriving). A fast
// momentum flick, an anchor jump or back-navigation scroll restoration moved
// sections through the viewport BETWEEN callbacks — they never got
// `is-visible` and stayed blank forever. Measured live 2026-08-06: EIGHT
// sections at opacity 0 in a 390px viewport.
//
// BUILD-73 Part 4 rebuilt the landing page and the reveal machinery is GONE
// entirely — there is no `.lp-reveal`, no IntersectionObserver, and no
// JS-armed visibility anywhere on the page. That is a stronger fix than
// fail-open: content that never depends on an observer cannot be stranded by
// one. Two assertions that were about the OLD implementation are therefore
// retired, and both are named here rather than quietly dropped:
//
//   · "reveals are OFF below 768px" — there are no reveals at any width.
//   · the recovery-calculator slider drag — the calculator is not on the
//     rebuilt page (the section order in BUILD-73's brief does not include
//     it). Nothing about it regressed; it was removed by design.
//
// ── WHAT THIS STILL PINS, AND MUST KEEP PINNING ─────────────────────────────
// The RULE, which is permanent and not tied to any implementation:
// **content visibility must never depend on an animation succeeding.** So the
// original failure mode is still driven, against whatever the page is made of
// today: hard scroll jumps at 390 and 1440, then assert that ZERO text-bearing
// elements sit at an opacity below 0.9 — and the same with reduced motion on,
// which is the cheap proxy for "the animation path never ran."
//
// The dot field's own reduced-motion guarantee — the highest-consequence
// version of this rule on the new page — is asserted in detail in
// tests/landing-field.test.js §1.
//
// Needs a browser + built client, unlike the API suites, so it bootstraps
// itself: serves client/dist on its own port and loads Playwright from
// PLAYWRIGHT_DIR (default ~/steward-qa — Playwright is deliberately not a
// project dep). If either is missing it SKIPS (exit 0, "0 failed") so
// `run-all.sh` stays runnable on a bare API-only checkout.

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
  // Scan every element that CARRIES ITS OWN TEXT (a leaf, not a wrapper whose
  // text is its children's) — the class-scoped version only worked while the
  // page had a reveal class to scope to.
  const invisible = await page.evaluate(() =>
    [...document.querySelectorAll("p, h1, h2, h3, li, span, div, a, button")]
      .filter(el => {
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
        if (!own) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;  // deliberately hidden ≠ stranded
        return parseFloat(st.opacity) < 0.9;
      })
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
      [...document.querySelectorAll("p, h1, h2, h3, span, div, a, button")].filter(el => {
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
        if (!own) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        return parseFloat(st.opacity) < 0.9;
      }).length
    );
    ok("prefers-reduced-motion: every text element is visible immediately", hidden === 0, hidden);
    // And the thing that would actually bite: the 199-dot field.
    const dotsHidden = await page.evaluate(() =>
      [...document.querySelectorAll(".df-dot")].filter(d => parseFloat(getComputedStyle(d).opacity) < 1).length);
    ok("prefers-reduced-motion: not one of the 796 dots is dimmed", dotsHidden === 0, dotsHidden);
    await page.close();
  }

  // ── 3. The fail-closed pattern is GONE, structurally ────────────────────
  //      BUILD-40 fixed the reveal by making it fail-open. BUILD-73 removed it
  //      altogether. This asserts the class cannot come back by accident: no
  //      element anywhere starts hidden waiting for JS to reveal it.
  {
    const fs2 = require("fs");
    const src = fs2.readFileSync(path.join(ROOT, "client", "src", "pages", "Landing.jsx"), "utf8");
    ok("no .lp-reveal / IntersectionObserver visibility machinery on the page",
      !/lp-reveal/.test(src) && !/IntersectionObserver/.test(src), null);
    ok("no opacity:0 base state outside a prefers-reduced-motion: no-preference query",
      (() => {
        const guarded = src.slice(src.indexOf("@media (prefers-reduced-motion: no-preference)"));
        const unguarded = src.slice(0, src.indexOf("@media (prefers-reduced-motion: no-preference)"));
        return !/opacity:\s*0\b/.test(unguarded) && /opacity: 0/.test(guarded);
      })(), null);

    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    // The hero's `.up` entrance is a PURE CSS animation (0.95s, longest delay
    // 0.3s, fill `both`) — unlike the retired reveal it needs no JS to arm and
    // no observer to fire, so it always completes. Wait past its full duration
    // and then assert; measuring mid-flight would be testing the clock.
    await page.waitForTimeout(1600);   // BEFORE any scrolling
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll("h1, h2, h3, p")].filter(el =>
        el.innerText.trim().length > 0 && parseFloat(getComputedStyle(el).opacity) < 0.9)
        .map(el => el.innerText.trim().slice(0, 40)));
    ok("390px: below-the-fold copy is opaque at load, before any scroll", hidden.length === 0, hidden);
    await page.close();
  }

  // RETIRED (BUILD-73 Part 4, deliberately — see the header):
  //   · "reveals are OFF below 768px"  → there are no reveals at any width.
  //   · the calculator slider drag     → the calculator is not on the rebuilt
  //     page. Nothing regressed; the section was removed by design.

  await browser.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
