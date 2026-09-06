// BUILD-81 Part 4 — THE LANDING PAGE, IN A REAL BROWSER.
//
// The page was rebuilt around THE THREAD: hero question → how-it-works →
// when-a-card-stops → Drift (the ONE dot field, moved down as evidence, FEP
// caption intact) → the record → your data → closing. This suite is the
// local pre-push mirror of scripts/landing-prod-verify.js and pins:
//
//   1. REDUCED MOTION. The dot field's entrance wave AND the thread visual's
//      breathing brass knot live inside prefers-reduced-motion:
//      no-preference; with the setting on, everything renders at full
//      opacity, static. A blank hero for the visitors most likely to need
//      the page to just work is the highest-consequence failure here.
//   2. THE STRUCTURE: the question as the H1, the BUILD-81 section order,
//      the five thread knots, one 199-dot field with 74 gold.
//   3. NO PRICE, NO OUTCOME CLAIM, NO EM DASH, anywhere in rendered text.
//   4. CTA SEMANTICS: a navigating CTA is a real <a href>; <button> is for
//      on-page actions only.
//   5. NO HORIZONTAL SCROLL from 320 to 1920, tap targets ≥44px at 390.
//
// The year-progression assertions (four fields, June ⊆ December) died WITH
// their section in BUILD-81 — the nesting math is still proven in
// tests/donor-field.test.js, which is untouched.
//
// Same browser-suite conventions as landing-reveal: serves client/dist on
// its own port, loads Playwright from PLAYWRIGHT_DIR, SKIPs cleanly when
// either is missing.

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

(async () => {
  const srv = await serveDist();
  const browser = await chromium.launch();
  const URL = `http://localhost:${PORT}/`;

  // ── §1 · REDUCED MOTION — everything visible, nothing animating ─────────
  console.log("\n— §1 · reduced motion: nothing is ever invisible —");
  const rctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const rp = await rctx.newPage();
  await rp.goto(URL, { waitUntil: "networkidle" });
  await rp.waitForTimeout(900);
  const rm = await rp.evaluate(() => {
    const dots = [...document.querySelectorAll(".df-dot")];
    const knots = [...document.querySelectorAll(".lt-knot")];
    const knotDots = [...document.querySelectorAll(".lt-dot")];
    return {
      n: dots.length,
      minOpacity: dots.length ? Math.min(...dots.map(d => parseFloat(getComputedStyle(d).opacity))) : -1,
      anyAnimation: [...dots, ...knotDots].some(d => getComputedStyle(d).animationName !== "none"),
      allSized: dots.every(d => d.getBoundingClientRect().width > 0),
      knots: knots.length,
      knotMin: knotDots.length ? Math.min(...knotDots.map(d => parseFloat(getComputedStyle(d).opacity))) : -1,
    };
  });
  ok("the field renders (199 dots)", rm.n === 199, rm.n);
  ok("EVERY dot is fully visible with reduced motion on (min opacity 1)", rm.minOpacity === 1, rm.minOpacity);
  ok("the thread visual renders all five knots at FULL opacity, static", rm.knots === 5 && rm.knotMin === 1, rm);
  ok("no animation runs at all under reduced motion", rm.anyAnimation === false, rm.anyAnimation);
  ok("every dot has real geometry, not a collapsed box", rm.allSized === true, rm.allSized);
  await rctx.close();

  // ── §2 · motion allowed — the wave runs, the brass knot breathes ────────
  console.log("\n— §2 · motion allowed —");
  const mctx = await browser.newContext({ reducedMotion: "no-preference", viewport: { width: 1440, height: 1000 } });
  const mp = await mctx.newPage();
  await mp.goto(URL, { waitUntil: "networkidle" });
  const names = await mp.evaluate(() => ({
    dots: [...new Set([...document.querySelectorAll(".df-dot")].map(d => getComputedStyle(d).animationName))],
    knot: getComputedStyle(document.querySelector(".lt-dot-open")).animationName,
  }));
  ok("the entrance wave animates when motion is allowed", names.dots.some(n => n.includes("lpDotIn")), names);
  ok("drifting dots also breathe", names.dots.some(n => n.includes("lpDotGlow")), names);
  ok("the open knot breathes (opacity + transform only, one slow cycle)", /ltBreathe/.test(names.knot), names.knot);
  await mctx.close();

  // ── §3 · structure — the question, the order, the knots, the field ──────
  console.log("\n— §3 · the page is the page —");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("pageerror", e => consoleErrors.push(String(e).slice(0, 160)));
  page.on("response", r => { if (r.status() >= 400 && !r.url().includes("_vercel")) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim());
  ok("the question renders as THE H1", h1 === "Who did you mean to call back?", h1);
  const text = await page.evaluate(() => document.body.innerText);
  const SECTIONS = [
    "mean to call back?",  // the hero H1 wraps over a <br>; innerText carries a newline
    "For the shops where one person holds the whole donor file",
    "Log it. The next step comes back. It keeps asking.",
    "A monthly donor's card expires.",
    "And the ones who already went quiet.",
    "Yours, plainly.",
    "Start with one conversation.",
  ];
  const positions = SECTIONS.map(s => text.indexOf(s));
  ok("every BUILD-81 section is present, in order",
     positions.every(p => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]), positions);
  ok('"The Thread" is named on the page', /the Thread/i.test(text), null);
  const knots = await page.evaluate(() => [...document.querySelectorAll(".lt-knot")].map(k => k.textContent.trim()));
  ok("the thread panel: five knots, coffee first, 'Still open. Day 11.' last, donor + lifetime on top",
     knots.length === 5 && /Coffee/.test(knots[0]) && /Still open[.] Day 11[.]/.test(knots[4]), knots);
  const panel = await page.evaluate(() => ({
    name: document.querySelector(".lt-panel")?.textContent.includes("Robert Harmon"),
    logCall: [...document.querySelectorAll(".lt-panel a")].map(a => a.getAttribute("href")),
  }));
  ok("…and 'Log the call' is a real anchor to /signup", panel.name && panel.logCall.length === 1 && panel.logCall[0] === "/signup", panel);
  const field = await page.evaluate(() => ({
    total: document.querySelectorAll(".df-dot").length,
    gold: [...document.querySelectorAll(".df-dot")].filter(d => getComputedStyle(d).backgroundColor === "rgb(201, 168, 76)").length,
  }));
  ok("ONE field of 199 dots, in the Drift section", field.total === 199, field);
  ok("74 gold — the FEP expectation, unchanged", field.gold === 74, field);
  const fepIdx = text.indexOf("Fundraising Effectiveness Project, full-year 2025");
  const driftIdx = text.indexOf("And the ones who already went quiet.");
  ok("the FEP caption sits IN the Drift section, under its dot field", driftIdx >= 0 && fepIdx > driftIdx, { driftIdx, fepIdx });

  // ── §4 · accessibility ──────────────────────────────────────────────────
  console.log("\n— §4 · accessibility —");
  const a11y = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('[role="img"]')];
    return {
      count: imgs.length,
      labelled: imgs.every(f => (f.getAttribute("aria-label") || "").length > 20),
      containersHidden: imgs.every(f => f.firstElementChild?.getAttribute("aria-hidden") === "true"),
      legendIsText: /125 steady/.test(document.body.innerText) && /74 drifting/.test(document.body.innerText),
      threadLabel: /conversation/.test(document.querySelector(".lt-wrap")?.getAttribute("aria-label") || ""),
    };
  });
  ok("both role=img figures (thread visual + dot field) state the fact in words", a11y.count === 2 && a11y.labelled, a11y);
  ok("their containers are aria-hidden — no reader is read 199 empty elements", a11y.containersHidden, null);
  ok("the field's legend is real text, not decoration", a11y.legendIsText, null);
  ok("the thread visual's aria-label reads the sequence", a11y.threadLabel, null);

  // ── §5 · what the page must NOT say ────────────────────────────────────
  console.log("\n— §5 · no price, no outcome claim, no em dash —");
  const PRICE = [/\$\d{2,4}\s*\/\s*mo/i, /\bper month\b/i, /\bfounding[- ]partner\b/i, /\bCore plan\b/i, /\bTeam plan\b/i, /\bpricing\b/i, /\bplans?\b/i, /\btiers?\b/i];
  const BANNED = [/\brecovered\b/i, /\bre-?engaged\b/i, /\brecaptured\b/i, /\bwon\s+back\b/i, /\bbrought\s+back\b/i];
  ok("no price, plan name or tier in the rendered text",
     !PRICE.some(re => re.test(text)), PRICE.filter(re => re.test(text)).map(String));
  ok("no outcome-claim language in the rendered text",
     !BANNED.some(re => re.test(text)), BANNED.filter(re => re.test(text)).map(String));
  ok("no invented social proof (no testimonial, logo bar, review score or customer count)",
     !/trusted by|as seen in|\d+\s*(customers|nonprofits) use|★|rated \d/i.test(text), null);
  // FIX after BUILD-81: the how-it-works cards are real screenshots.
  const hiw = await page.evaluate(() => [...document.querySelectorAll("#how-it-works img")].map(i => ({
    w: Number(i.getAttribute("width")) || 0, h: Number(i.getAttribute("height")) || 0,
    alt: (i.getAttribute("alt") || "").trim(), loaded: i.naturalWidth > 0,
  })));
  ok("three real screenshots in #how-it-works: intrinsic dimensions, real alt, all loading",
     hiw.length === 3 && hiw.every(i => i.w > 100 && i.h > 50 && i.alt.length > 20 && i.loaded), hiw);
  ok('the "drawn in code" caption is gone', !/drawn in code/i.test(text), null);
  // photograph pass: the chapel (card-stops), the potter's hands (your-data),
  // the decorative doorway (close) — dimensions everywhere, alt everywhere
  // except the one decorative background.
  const photoSecs = await page.evaluate(() => {
    const one = id => (document.getElementById(id)?.querySelectorAll("img") || []).length;
    const allImgs = [...document.querySelectorAll("img")].map(i => ({
      w: Number(i.getAttribute("width")) || 0, h: Number(i.getAttribute("height")) || 0,
      alt: i.getAttribute("alt"), hidden: i.getAttribute("aria-hidden") === "true",
    }));
    return { cardStops: one("card-stops"), yourData: one("your-data"), closing: one("closing"), allImgs };
  });
  ok("one photograph each in card-stops, your-data and the close",
     photoSecs.cardStops === 1 && photoSecs.yourData === 1 && photoSecs.closing === 1, photoSecs);
  ok("every img carries width, height and alt; only the close background is decorative (alt='' + aria-hidden)",
     photoSecs.allImgs.every(i => i.w > 0 && i.h > 0) && photoSecs.allImgs.filter(i => !(i.alt || "").length).length === 1
       && photoSecs.allImgs.filter(i => !(i.alt || "").length).every(i => i.hidden),
     photoSecs.allImgs.filter(i => !(i.alt || "").length || !i.w));
  // FIX after BUILD-81: the who-it's-for photo strip, between hero and hiw.
  const strip = await page.evaluate(() => {
    const sec = document.getElementById("who-its-for");
    const hiwSec = document.getElementById("how-it-works");
    const hero = document.querySelector(".lp-hero");
    return {
      imgs: sec ? [...sec.querySelectorAll("img")].map(i => ({
        w: Number(i.getAttribute("width")) || 0, h: Number(i.getAttribute("height")) || 0,
        alt: (i.getAttribute("alt") || "").trim(), loaded: i.naturalWidth > 0,
      })) : [],
      after: sec && hero ? !!(hero.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
      before: sec && hiwSec ? !!(sec.compareDocumentPosition(hiwSec) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
    };
  });
  ok("who-its-for strip: three photos, dimensions, alt, loading, hero→strip→how-it-works order",
     strip.imgs.length === 3 && strip.imgs.every(i => i.w > 100 && i.h > 50 && i.alt.length > 20 && i.loaded) && strip.after && strip.before, strip);
  ok("no customer language: trusted by / customers / clients absent",
     !/trusted by|\bcustomers?\b|\bclients?\b/i.test(text), null);
  ok("no em dash in the rendered copy (Jonathan's voice uses periods)", !text.includes("—"), null);

  // ── §6 · copy that must not change ─────────────────────────────────────
  console.log("\n— §6 · load-bearing copy —");
  ok('"Fundraising Effectiveness Project, full-year 2025" is intact — FEP rebased in Q1 2026 and now headlines a QUARTERLY figure',
     /Fundraising Effectiveness Project, full-year 2025/.test(text), null);
  ok("the © placeholder is VISIBLE on the page, not silently blank",
     text.includes("[LEGAL ENTITY NAME]"), null);
  ok("the honest fee line survives (no platform fee · own Stripe)",
     /No platform fee/i.test(text) && /own Stripe/i.test(text), null);
  ok("the card-stops arithmetic stays the READER's, never a number on the page",
     /You know what four fifty-dollar sustainers a month are worth to you by December\./.test(text), null);

  // ── §7 · wiring + CTA semantics ────────────────────────────────────────
  console.log("\n— §7 · every path goes somewhere real —");
  const links = await page.evaluate(() => [...document.querySelectorAll("a")].map(a => a.getAttribute("href")));
  ok('no dead href="#"', !links.includes("#"), links.filter(l => l === "#"));
  ok("Terms and Privacy link to their real routes", links.includes("/terms") && links.includes("/privacy"), links);
  ok("Log in links to /login", links.includes("/login"), links);
  ok("no /pricing link in nav or footer — price is a conversation", !links.includes("/pricing"), links);
  const semantics = await page.evaluate(() => ({
    startFreeAnchors: [...document.querySelectorAll("a")].filter(a => /start free/i.test(a.textContent || "")).map(a => a.getAttribute("href")),
    startFreeButtons: [...document.querySelectorAll("button")].filter(b => /start free/i.test(b.textContent || "")).length,
    talkButtons: [...document.querySelectorAll("button")].filter(b => /talk to the founder/i.test(b.textContent || "")).length,
    talkAnchors: [...document.querySelectorAll("a")].filter(a => /talk to the founder/i.test(a.textContent || "")).length,
  }));
  ok("Start free is a REAL <a href=/signup> everywhere, never a <button>",
     semantics.startFreeAnchors.length >= 2 && semantics.startFreeAnchors.every(h => h === "/signup") && semantics.startFreeButtons === 0, semantics);
  ok("Talk to the founder stays a <button> (an on-page action), never a fake anchor",
     semantics.talkButtons >= 2 && semantics.talkAnchors === 0, semantics);
  const scrolled = await page.evaluate(async () => {
    const before = window.scrollY;
    [...document.querySelectorAll("a")].find(a => a.getAttribute("href") === "#how-it-works")?.click();
    await new Promise(r => setTimeout(r, 700));
    return { before, after: window.scrollY, target: !!document.getElementById("how-it-works") };
  });
  ok("the How-it-works nav anchor jumps to its section", scrolled.target && scrolled.after > scrolled.before, scrolled);
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
      const both = await p.evaluate(() => ({
        knots: document.querySelectorAll(".lt-knot").length,
        dots: document.querySelectorAll(".df-dot").length,
      }));
      ok("390px: the thread visual (stacked below the copy) and the field both survive",
         both.knots === 5 && both.dots === 199, both);
    }
    await p.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("SUITE ERROR:", e); process.exit(1); });
