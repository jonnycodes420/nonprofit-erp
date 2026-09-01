// BUILD-73 Part 4 — THE LANDING PAGE, IN A REAL BROWSER.
//
// tests/donor-field.test.js proves the field's MATH. This proves the page
// actually renders it, and pins the four things a green build would otherwise
// say nothing about:
//
//   1. REDUCED MOTION. The entrance wave lives inside a
//      prefers-reduced-motion: no-preference query. If an `opacity: 0` base
//      state ever escapes that query, the animation never runs and the field
//      is INVISIBLE for anyone with the setting on — a blank hero, silently,
//      for the visitors most likely to need the page to just work. This is
//      the single highest-consequence failure on the page and the reason
//      Part 4's brief calls it out by name.
//   2. THE NESTING, ON SCREEN. June's gold dots must be a subset of
//      December's — asserted from computed background colours, not from the
//      module the page imports, so a rendering bug between the two is caught.
//   3. NO PRICE, NO OUTCOME CLAIM, anywhere in the rendered text.
//   4. NO HORIZONTAL SCROLL from 320 to 1920, and every tap target ≥44px.
//
// Same browser-suite conventions as landing-reveal: serves client/dist on its
// own port, loads Playwright from PLAYWRIGHT_DIR, and SKIPs cleanly (exit 0,
// "0 failed") when either is missing so run-all stays portable.

const path = require("path");
const fs = require("fs");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const PW_DIR = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");
const PORT = 4181;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};
const skip = why => { console.log("  SKIP  " + why + "\n\n0 passed, 0 failed (suite skipped)"); process.exit(0); };

if (!fs.existsSync(path.join(DIST, "index.html"))) skip("client/dist not built");
let chromium;
try { module.paths.unshift(path.join(PW_DIR, "node_modules")); ({ chromium } = require("playwright")); }
catch { skip("Playwright not found (set PLAYWRIGHT_DIR)"); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon", ".json": "application/json" };
function serveDist() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split("?")[0]);
      if (p.startsWith("/_vercel/")) { res.statusCode = 404; return res.end(); }
      let file = path.join(DIST, p);
      if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
      res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

// Runs INSIDE the browser, so it can close over nothing from this file — the
// gold literal is inlined deliberately.
const goldIndices = () => [...document.querySelectorAll('[role="img"]')].map(f =>
  [...f.querySelectorAll("span")]
    .map((d, i) => getComputedStyle(d).backgroundColor === "rgb(201, 168, 76)" ? i : -1)
    .filter(i => i >= 0));

(async () => {
  const srv = await serveDist();
  const browser = await chromium.launch();
  const URL = `http://localhost:${PORT}/`;

  // ── §1 · REDUCED MOTION — the field must be visible ─────────────────────
  console.log("\n— §1 · reduced motion: the field is never invisible —");
  const rctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const rp = await rctx.newPage();
  await rp.goto(URL, { waitUntil: "networkidle" });
  await rp.waitForTimeout(900);
  const rm = await rp.evaluate(() => {
    const dots = [...document.querySelectorAll(".df-dot")];
    return {
      n: dots.length,
      minOpacity: dots.length ? Math.min(...dots.map(d => parseFloat(getComputedStyle(d).opacity))) : -1,
      anyAnimation: dots.some(d => getComputedStyle(d).animationName !== "none"),
      allSized: dots.every(d => d.getBoundingClientRect().width > 0),
    };
  });
  ok("all four fields render (796 dots)", rm.n === 796, rm.n);
  ok("EVERY dot is fully visible with reduced motion on (min opacity 1)", rm.minOpacity === 1, rm.minOpacity);
  ok("no animation runs at all under reduced motion", rm.anyAnimation === false, rm.anyAnimation);
  ok("every dot has real geometry, not a collapsed box", rm.allSized === true, rm.allSized);
  await rctx.close();

  // ── §2 · motion allowed — the wave runs, and only cheaply ───────────────
  console.log("\n— §2 · motion allowed —");
  const mctx = await browser.newContext({ reducedMotion: "no-preference", viewport: { width: 1440, height: 1000 } });
  const mp = await mctx.newPage();
  await mp.goto(URL, { waitUntil: "networkidle" });
  const names = await mp.evaluate(() =>
    [...new Set([...document.querySelectorAll(".df-dot")].map(d => getComputedStyle(d).animationName))]);
  ok("the entrance wave animates when motion is allowed", names.some(n => n.includes("lpDotIn")), names);
  ok("drifting dots also breathe", names.some(n => n.includes("lpDotGlow")), names);
  await mctx.close();

  // ── §3 · THE NESTING, from rendered pixels ─────────────────────────────
  console.log("\n— §3 · the year progression, read off the screen —");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("pageerror", e => consoleErrors.push(String(e).slice(0, 160)));
  page.on("response", r => { if (r.status() >= 400 && !r.url().includes("_vercel")) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const fields = await page.evaluate(goldIndices);
  ok("four dot fields on the page", fields.length === 4, fields.length);
  const [hero, jan, jun, dec] = fields;
  ok("January is ALL emerald — zero gold", jan.length === 0, jan.length);
  ok("June shows 31 gold", jun.length === 31, jun.length);
  ok("December shows 74 gold", dec.length === 74, dec.length);
  ok("the hero shows 74 gold", hero.length === 74, hero.length);
  ok("ON SCREEN, June's 31 are a subset of December's 74",
     jun.every(i => dec.includes(i)), jun.filter(i => !dec.includes(i)));
  ok("ON SCREEN, the hero field is the same set as December",
     JSON.stringify(hero) === JSON.stringify(dec), null);
  ok("each field is exactly 199 dots",
     await page.evaluate(() => [...document.querySelectorAll('[role="img"]')].every(f => f.querySelectorAll("span").length === 199)), null);

  // ── §4 · accessibility ──────────────────────────────────────────────────
  console.log("\n— §4 · accessibility —");
  const a11y = await page.evaluate(() => {
    const fs_ = [...document.querySelectorAll('[role="img"]')];
    return {
      labelled: fs_.every(f => (f.getAttribute("aria-label") || "").length > 20),
      containersHidden: fs_.every(f => f.firstElementChild?.getAttribute("aria-hidden") === "true"),
      labels: fs_.map(f => (f.getAttribute("aria-label") || "").slice(0, 30)),
      legendIsText: /125 steady/.test(document.body.innerText) && /74 drifting/.test(document.body.innerText),
    };
  });
  ok("every field states the fact in words via aria-label", a11y.labelled, a11y.labels);
  ok("the dot container is aria-hidden — no reader is read 199 empty elements", a11y.containersHidden, null);
  ok("the legend below the hero field is real text, not decoration", a11y.legendIsText, null);

  // ── §5 · what the page must NOT say ────────────────────────────────────
  console.log("\n— §5 · no price, no outcome claim —");
  const text = await page.evaluate(() => document.body.innerText);
  const PRICE = [/\$\d{2,4}\s*\/\s*mo/i, /\bper month\b/i, /\bfounding[- ]partner\b/i, /\bCore plan\b/i, /\bTeam plan\b/i, /\bpricing\b/i, /\bplans?\b/i, /\btiers?\b/i];
  const BANNED = [/\brecovered\b/i, /\bre-?engaged\b/i, /\brecaptured\b/i, /\bwon\s+back\b/i, /\bbrought\s+back\b/i];
  ok("no price, plan name or tier in the rendered text",
     !PRICE.some(re => re.test(text)), PRICE.filter(re => re.test(text)).map(String));
  ok("no outcome-claim language in the rendered text",
     !BANNED.some(re => re.test(text)), BANNED.filter(re => re.test(text)).map(String));
  ok("no invented social proof (no testimonial, logo bar, review score or customer count)",
     !/trusted by|as seen in|\d+\s*(customers|nonprofits) use|★|rated \d/i.test(text), null);

  // ── §6 · copy that must not change ─────────────────────────────────────
  console.log("\n— §6 · load-bearing copy —");
  ok('"Fundraising Effectiveness Project, full-year 2025" is intact — FEP rebased in Q1 2026 and now headlines a QUARTERLY figure',
     /Fundraising Effectiveness Project, full-year 2025/.test(text), null);
  ok("the placeholders are VISIBLE on the page, not silently blank",
     ["[LAST NAME]", "[SCHOOL]", "[ FOUNDER PHOTO ]", "[LEGAL ENTITY NAME]"].every(p => text.includes(p)),
     ["[LAST NAME]", "[SCHOOL]", "[ FOUNDER PHOTO ]", "[LEGAL ENTITY NAME]"].filter(p => !text.includes(p)));
  ok("the 'Built for orgs like yours' section is present with all three verticals",
     /You know your donors\. Steward notices when they're slipping\./.test(text)
     && /Arts & culture/.test(text) && /Rescue & relief/.test(text) && /Faith & community/.test(text), null);

  // ── §7 · wiring ─────────────────────────────────────────────────────────
  console.log("\n— §7 · every path goes somewhere real —");
  const links = await page.evaluate(() => [...document.querySelectorAll("a")].map(a => a.getAttribute("href")));
  ok('no dead href="#"', !links.includes("#"), links.filter(l => l === "#"));
  ok("Terms and Privacy link to their real routes", links.includes("/terms") && links.includes("/privacy"), links);
  ok("Log in links to /login", links.includes("/login"), links);
  ok("no /pricing link in nav or footer — price is a conversation", !links.includes("/pricing"), links);
  const scrolled = await page.evaluate(async () => {
    const before = window.scrollY;
    [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "How it works")?.click();
    await new Promise(r => setTimeout(r, 700));
    return { before, after: window.scrollY, target: !!document.getElementById("how-it-works") };
  });
  ok("the How-it-works nav item scrolls to its section", scrolled.target && scrolled.after > scrolled.before, scrolled);
  ok("console is clean — no page errors, no asset 404s", consoleErrors.length === 0, consoleErrors.slice(0, 4));
  await page.close();

  // ── §8 · responsive ─────────────────────────────────────────────────────
  console.log("\n— §8 · 320 → 1920, no horizontal scroll —");
  for (const w of [320, 390, 768, 1024, 1440, 1920]) {
    const p = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(URL, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    ok(`${w}px: the page body does not scroll sideways`, r.s <= r.c + 1, r);
    if (w === 390) {
      const small = await p.evaluate(() => [...document.querySelectorAll("a,button")]
        .filter(e => e.offsetParent)
        .map(e => ({ t: (e.innerText || e.getAttribute("aria-label") || "").slice(0, 24), h: Math.round(e.getBoundingClientRect().height) }))
        .filter(e => e.h < 44));
      ok("390px: every visible tap target is at least 44px tall", small.length === 0, small);
      const stillFour = await p.evaluate(() => [...document.querySelectorAll('[role="img"]')].length);
      ok("390px: the field rewraps and all four remain", stillFour === 4, stillFour);
    }
    await p.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("SUITE ERROR:", e); process.exit(1); });
