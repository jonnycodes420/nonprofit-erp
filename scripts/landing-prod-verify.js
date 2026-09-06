#!/usr/bin/env node
// scripts/landing-prod-verify.js — the landing page's PROD honesty + quality gate.
//
// ── BUILD-81 REBUILD ────────────────────────────────────────────────────────
// The page was rebuilt around THE THREAD (BUILD-81 Part 4): hero question →
// how-it-works beats → when-a-card-stops → Drift (the dot field moved DOWN
// the page as evidence, FEP caption byte-intact) → the record → your data →
// closing. This gate GROWS, never shrinks — the guard count is compared to
// BUILD-73's baseline below, and every assertion that CHANGED is listed with
// its reason in audit/BUILD-81-FINDINGS.md. The ones that DIED died with
// their subject:
//   · "four fields of 199 dots" / "June ⊆ December" — the year section and
//     the every-dot-is-a-person section are gone; ONE field remains, in the
//     Drift section, and it is asserted there (199 dots, 74 gold).
//   · the old section-order strings — replaced by the BUILD-81 order.
//   · (photograph pass) the RECORD section died whole — its SECTIONS entry
//     "Built with a development director" went with the headline, the
//     donor-map screenshot and the caption; the map asset was deleted.
// Everything else carried forward: the honesty gates, NO PRICING, the FEP
// attribution incl. "full-year 2025", no competitor as the authority, no
// "keep 100%" overclaim, no outcome-claim language, measured contrast,
// CLS + no-sideways-scroll, reduced-motion visibility, the visible ©
// placeholder. New BUILD-81 gates: the question is the H1; "The Thread"
// renders on the page; the thread visual's five knots render at full
// opacity under reduced motion; CLS is 0.0000 at BOTH 1440 and 390; CTA
// semantics (a navigating CTA is a real <a href>, never a <button>; no
// dead-# anchor).
//
// READ-ONLY: it loads a public page and asserts. No login, no writes, and it
// defaults to prod deliberately because that is the point of it.
//
// Usage:
//   node scripts/landing-prod-verify.js
//   BASE=http://localhost:4173 node scripts/landing-prod-verify.js

const path = require("path");

const BASE = (process.env.BASE || "https://www.stewardapp.dev").replace(/\/+$/, "");
const PW = process.env.PLAYWRIGHT_DIR || path.join(process.env.HOME || "", "steward-qa");

// ── GUARD COUNT ────────────────────────────────────────────────────────────
// This file grows, never shrinks: BUILD-74 measured 29 against prod, and
// BUILD-81 must run MORE guards than that. If the count ever falls, a gate
// was dropped without the deliberate paper trail this comment demands.
const GUARDS_BEFORE = 29; // BUILD-74's count against prod at 261dc73

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 260) : "")); }
};

let chromium;
try { ({ chromium } = require(path.join(PW, "node_modules", "playwright"))); }
catch { console.log("  SKIP  Playwright not found (set PLAYWRIGHT_DIR)\n\n0 passed, 0 failed (skipped)"); process.exit(0); }

const lum = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);

(async () => {
  console.log(`landing-prod-verify → ${BASE}\n`);
  const browser = await chromium.launch();

  // ── §1 · structure — the BUILD-81 order ─────────────────────────────────
  console.log("— §1 · the page is the page —");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 140)));
  page.on("response", r => { if (r.status() >= 400 && !r.url().includes("_vercel")) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 80)}`); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);

  const text = await page.evaluate(() => document.body.innerText);
  const SECTIONS = [
    "mean to call back?",   // the hero H1 wraps over a <br>; innerText carries a newline
    "For the shops where one person holds the whole donor file", // who it's for
    "Log it. The next step comes back. It keeps asking.",        // how it works
    "A monthly donor's card expires.",                           // when a card stops
    "And the ones who already went quiet.",                      // drift
    "Yours, plainly.",                                           // your data
    "Start with one conversation.",                              // closing
  ];
  const positions = SECTIONS.map(s => text.indexOf(s));
  ok("every section is present", positions.every(p => p >= 0),
     SECTIONS.filter((_, i) => positions[i] < 0));
  ok("the sections render IN ORDER", positions.every((p, i) => i === 0 || p > positions[i - 1]), positions);
  const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim());
  ok("the question renders as THE H1", h1 === "Who did you mean to call back?", h1);
  ok('"The Thread" is named on the page (the app names it too — tests/threads + the Home suite)',
     /the Thread/i.test(text), null);

  // ── §2 · NO PRICING — the standing rule ─────────────────────────────────
  console.log("\n— §2 · no pricing, anywhere —");
  const PRICE = [/\$\d{2,4}\s*\/\s*mo/i, /\bper month\b/i, /\/month\b/i, /\bfounding[- ]partner\b/i,
                 /\bCore plan\b/i, /\bTeam plan\b/i, /\bpricing\b/i, /\bplans?\b/i, /\btiers?\b/i];
  ok("no price, plan name or tier in the rendered text",
     !PRICE.some(re => re.test(text)), PRICE.filter(re => re.test(text)).map(String));
  const links = await page.evaluate(() => [...document.querySelectorAll("a")].map(a => a.getAttribute("href")));
  ok("no /pricing link in nav or footer (the ROUTE survives; the links do not)",
     !links.includes("/pricing"), links);

  // ── §3 · honesty gates — permanent ──────────────────────────────────────
  console.log("\n— §3 · honesty —");
  const SOCIAL_PROOF = [
    /trusted by/i, /as seen in/i, /join (hundreds|thousands|dozens|\d+)/i,
    /loved by/i, /used by \d/i, /\bour customers\b/i, /\btestimonial/i,
    /★|⭐/, /\brated\s*\d/i, /\d(\.\d)?\s*(\/\s*5|out of 5|stars)/i,
    /\b\d[\d,]*\+?\s*(customers|clients|nonprofits|organizations|orgs|teams|users)\b/i,
    /\b(customers|nonprofits|organizations|orgs|teams)\s+(use|trust|rely on|switched to)\b/i,
  ];
  ok("no fabricated social proof — the whole family (logos, review scores, testimonials, customer counts, trusted-by, join-hundreds-of)",
     !SOCIAL_PROOF.some(re => re.test(text)), SOCIAL_PROOF.filter(re => re.test(text)).map(String));
  const imgs = await page.evaluate(() => [...document.querySelectorAll("img")].map(i => i.getAttribute("src") || ""));
  ok("no logo-bar imagery", !imgs.some(s => /logo|client|partner/i.test(s)), imgs);
  // FIX after BUILD-81 — section two got its pictures back: the three
  // how-it-works cards are REAL screenshots of the product (webp, 1x + 2x),
  // each with intrinsic dimensions (CLS stays 0.0000) and real alt text.
  const hiw = await page.evaluate(() => [...document.querySelectorAll("#how-it-works img")].map(i => ({
    src: i.getAttribute("src"), w: Number(i.getAttribute("width")) || 0, h: Number(i.getAttribute("height")) || 0,
    alt: (i.getAttribute("alt") || "").trim(), loading: i.getAttribute("loading"),
    loaded: i.naturalWidth > 0,
  })));
  ok("three product screenshots inside #how-it-works, each with intrinsic dimensions",
     hiw.length === 3 && hiw.every(i => i.w > 100 && i.h > 50), hiw);
  ok("…each with real, non-empty alt text (a screen reader hears the screen, not a filename)",
     hiw.every(i => i.alt.length > 20 && !/\.webp|\.png/i.test(i.alt)), hiw.map(i => i.alt));
  ok("…each actually loads (no broken image ships)", hiw.every(i => i.loaded), hiw);
  ok('the retired caption is gone — "drawn in code" absent from rendered text',
     !/drawn in code/i.test(text), null);
  // FIX after BUILD-81 — the "Who it's for" photo strip: the pre-BUILD-41
  // page's photographs, back between the hero and how-it-works. Exactly
  // three photos, intrinsic dimensions (CLS stays 0.0000), real alt text,
  // and NOTHING testimonial around them.
  const strip = await page.evaluate(() => {
    const sec = document.getElementById("who-its-for");
    const hiwSec = document.getElementById("how-it-works");
    const hero = document.querySelector(".lp-hero");
    const imgsIn = sec ? [...sec.querySelectorAll("img")].map(i => ({
      w: Number(i.getAttribute("width")) || 0, h: Number(i.getAttribute("height")) || 0,
      alt: (i.getAttribute("alt") || "").trim(), loaded: i.naturalWidth > 0,
    })) : [];
    const after = sec && hero ? !!(hero.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
    const before = sec && hiwSec ? !!(sec.compareDocumentPosition(hiwSec) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
    return { exists: !!sec, count: imgsIn.length, imgsIn, after, before };
  });
  ok("#who-its-for exists with EXACTLY three photographs, each with intrinsic dimensions",
     strip.exists && strip.count === 3 && strip.imgsIn.every(i => i.w > 100 && i.h > 50), strip);
  ok("…each with real, non-empty alt text describing the photograph",
     strip.imgsIn.every(i => i.alt.length > 20 && !/\.webp|\.png/i.test(i.alt)), strip.imgsIn.map(i => i.alt));
  ok("…each actually loads", strip.imgsIn.every(i => i.loaded), null);
  ok("the strip sits AFTER the hero and BEFORE #how-it-works", strip.after && strip.before, strip);
  ok('no customer language anywhere: "trusted by", "customers" and "clients" absent from rendered text',
     !/trusted by/i.test(text) && !/customers?/i.test(text) && !/clients?/i.test(text), null);
  // photograph pass — one photograph each in card-stops (the chapel, 4:5),
  // your-data (the potter's hands, 4:3) and the close (the doorway,
  // DECORATIVE: alt="" + aria-hidden under the ink gradient, text above).
  const secImgs = await page.evaluate(() => {
    const grab = id => [...(document.getElementById(id)?.querySelectorAll("img") || [])].map(i => ({
      w: Number(i.getAttribute("width")) || 0, h: Number(i.getAttribute("height")) || 0,
      alt: i.getAttribute("alt"), hidden: i.getAttribute("aria-hidden") === "true", loaded: i.naturalWidth > 0,
    }));
    return { cardStops: grab("card-stops"), yourData: grab("your-data"), closing: grab("closing") };
  });
  ok("card-stops carries ONE photograph with intrinsic dimensions and real alt",
     secImgs.cardStops.length === 1 && secImgs.cardStops[0].w > 100 && secImgs.cardStops[0].h > 100 && (secImgs.cardStops[0].alt || "").length > 10 && secImgs.cardStops[0].loaded, secImgs.cardStops);
  ok("your-data carries ONE photograph with intrinsic dimensions and real alt",
     secImgs.yourData.length === 1 && secImgs.yourData[0].w > 100 && secImgs.yourData[0].h > 100 && (secImgs.yourData[0].alt || "").length > 10 && secImgs.yourData[0].loaded, secImgs.yourData);
  ok('the close carries ONE decorative background photograph: alt="" AND aria-hidden, dimensions set',
     secImgs.closing.length === 1 && secImgs.closing[0].alt === "" && secImgs.closing[0].hidden && secImgs.closing[0].w > 100 && secImgs.closing[0].loaded, secImgs.closing);
  const closeStack = await page.evaluate(() => {
    const img = document.querySelector("#closing img");
    const grad = document.querySelector("#closing .lp-closegrad");
    const inner = document.querySelector("#closing .lp-closeinner");
    return { imgOpacity: img ? getComputedStyle(img).opacity : null,
             grad: grad ? getComputedStyle(grad).backgroundImage.includes("linear-gradient") : false,
             textAbove: inner ? getComputedStyle(inner).position === "relative" : false };
  });
  ok("…at 0.28 opacity under the ink gradient, with the text stacked above",
     closeStack.imgOpacity === "0.28" && closeStack.grad && closeStack.textAbove, closeStack);
  const allImgs = await page.evaluate(() => [...document.querySelectorAll("img")].map(i => ({
    src: (i.getAttribute("src") || "").slice(0, 40),
    w: Number(i.getAttribute("width")) || 0, h: Number(i.getAttribute("height")) || 0,
    alt: i.getAttribute("alt"), hidden: i.getAttribute("aria-hidden") === "true",
  })));
  ok("EVERY <img> on the page has width, height and non-empty alt — except the ONE decorative close background",
     allImgs.every(i => i.w > 0 && i.h > 0) && allImgs.filter(i => !(i.alt || "").length).every(i => i.hidden) && allImgs.filter(i => !(i.alt || "").length).length === 1,
     allImgs.filter(i => !(i.alt || "").length || !i.w || !i.h));
  ok("the 43%-class stat is attributed to the Fundraising Effectiveness Project",
     /Fundraising Effectiveness Project/.test(text), null);
  ok('"full-year 2025" is intact — FEP rebased in Q1 2026 and now headlines a QUARTERLY figure',
     /Fundraising Effectiveness Project, full-year 2025/.test(text), null);
  const driftIdx = text.indexOf("And the ones who already went quiet.");
  const fepIdx = text.indexOf("Fundraising Effectiveness Project, full-year 2025");
  ok("the FEP caption sits IN the Drift section, with its dot field (moved down the page as evidence, never re-captioned)",
     driftIdx >= 0 && fepIdx > driftIdx, { driftIdx, fepIdx });
  ok("no competitor cited as the authority (Bloomerang republishes FEP's number)",
     !/bloomerang/i.test(text), null);
  ok('no "keep 100% of every gift" overclaim — Stripe\'s own fee still applies',
     !/keep 100%/i.test(text), null);
  ok("the fee claim is the honest one (no platform fee · no donor tip · own Stripe)",
     /No platform fee/i.test(text) && /own Stripe/i.test(text), null);
  const BANNED = [/\brecovered\b/i, /\bre-?engaged\b/i, /\brecaptured\b/i, /\bwon\s+back\b/i, /\bbrought\s+back\b/i];
  ok("no outcome-claim language (recovery stays a feature noun, recovered a banned outcome)",
     !BANNED.some(re => re.test(text)), BANNED.filter(re => re.test(text)).map(String));
  ok("no em dash in the rendered copy (Jonathan's voice uses periods)",
     !text.includes("—"), null);
  ok("the © placeholder is VISIBLE, not silently blank or invented",
     text.includes("[LEGAL ENTITY NAME]"), null);
  // BUILD-81 §4.4 item 7 — "assert it is not shipped as literal brackets":
  // read as "never as bare bracket TEXT pretending to be a finished name."
  // Until Jonathan fills the value it must render through the Placeholder
  // treatment (dashed outline — visibly unfinished); once filled, the
  // brackets disappear and this guard passes on the absence branch.
  const placeholderTreatment = await page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find(s => s.textContent.trim() === "[LEGAL ENTITY NAME]");
    if (!el) return { present: false };
    return { present: true, dashed: getComputedStyle(el).borderStyle.includes("dashed") };
  });
  ok("the placeholder never ships as bare bracket text: it renders flagged (dashed outline) until filled",
     !placeholderTreatment.present || placeholderTreatment.dashed === true, placeholderTreatment);

  // ── §4 · the thread visual + the dot field ──────────────────────────────
  console.log("\n— §4 · the thread visual, and the dot field as evidence —");
  const knots = await page.evaluate(() =>
    [...document.querySelectorAll(".lt-knot")].map(k => k.textContent.trim()));
  ok("the thread visual renders all five knots", knots.length === 5, knots);
  ok("the knots read the sequence: coffee → thank-you → called → try again → still open, day 11",
     /Coffee/.test(knots[0] || "") && /Thank-you/.test(knots[1] || "") && /Called, left a message/.test(knots[2] || "")
       && /Try again/.test(knots[3] || "") && /Still open[.] Day 11[.]/.test(knots[4] || ""), knots);
  const visualA11y = await page.evaluate(() => {
    const w = document.querySelector(".lt-wrap");
    return { role: w?.getAttribute("role"), label: (w?.getAttribute("aria-label") || "").slice(0, 200) };
  });
  ok('the visual carries role="img" and an aria-label that reads the sequence',
     visualA11y.role === "img" && /conversation/.test(visualA11y.label), visualA11y);
  const panel = await page.evaluate(() => ({
    name: document.querySelector(".lt-panel")?.textContent.includes("Robert Harmon"),
    lifetime: document.querySelector(".lt-panel")?.textContent.includes("$14,500"),
    logCall: [...document.querySelectorAll(".lt-panel a")].map(a => [a.textContent.trim(), a.getAttribute("href")]),
  }));
  ok("the panel carries the donor and lifetime at the top, and 'Log the call' is a REAL anchor to /signup",
     panel.name && panel.lifetime && panel.logCall.length === 1 && /Log the call/.test(panel.logCall[0][0]) && panel.logCall[0][1] === "/signup", panel);
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('[role="img"] .df-dot')].length
      ? {
          total: document.querySelectorAll(".df-dot").length,
          gold: [...document.querySelectorAll(".df-dot")].filter(d => getComputedStyle(d).backgroundColor === "rgb(201, 168, 76)").length,
        }
      : { total: 0, gold: 0 });
  ok("ONE field of 199 dots remains, in the Drift section", fields.total === 199, fields);
  ok("74 of them are gold — the FEP expectation, unchanged", fields.gold === 74, fields);

  // ── §5 · measured contrast (floor 5.0, every text element) ─────────────
  const FLOOR = 5.0;
  console.log(`\n— §5 · measured contrast (floor ${FLOOR.toFixed(1)}:1, every text element) —`);
  const swatches = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".lp *")) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
      let bg = "", n = el;
      while (n && (!bg || bg === "rgba(0, 0, 0, 0)")) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      out.push({ t: el.textContent.trim().slice(0, 44), fg: cs.color, bg, size: parseFloat(cs.fontSize) });
    }
    return out;
  });
  const measured = swatches.map(s => {
    // composite an rgba() foreground over its ground before measuring
    const m = s.fg.match(/rgba?\(([\d.\s,]+)\)/);
    let fg = rgb(s.fg);
    if (m && m[1].split(",").length === 4) {
      const parts = m[1].split(",").map(Number);
      const a = parts[3]; const bgc = rgb(s.bg);
      fg = parts.slice(0, 3).map((c, i) => Math.round(c * a + (bgc[i] ?? 255) * (1 - a)));
    }
    return { ...s, c: contrast(fg, rgb(s.bg)) };
  }).sort((a, b) => a.c - b.c);
  const worst = measured[0];
  ok(`all ${measured.length} visible text elements ≥ ${FLOOR.toFixed(1)}:1 (worst ${worst ? worst.c.toFixed(2) : "n/a"}:1)`,
     measured.length > 20 && measured.every(m => m.c >= FLOOR),
     measured.filter(m => m.c < FLOOR).slice(0, 5).map(m => `${m.c.toFixed(2)}:1 ${m.fg} on ${m.bg} — ${m.t}`));

  // ── §6 · wiring + CTA semantics ─────────────────────────────────────────
  console.log("\n— §6 · wiring —");
  ok('no dead href="#"', !links.includes("#"), links.filter(l => l === "#"));
  ok("Terms and Privacy link to real routes", links.includes("/terms") && links.includes("/privacy"), links);
  ok("Log in links to /login", links.includes("/login"), links);
  ok('"Start free" is present', /Start free/.test(text), null);
  ok('"Talk to the founder" is present', /Talk to the founder/.test(text), null);
  // BUILD-81 CTA-semantics rule: a CTA that NAVIGATES is a real <a href>
  // (cmd-click / open-in-new-tab / crawlers); <button> is reserved for
  // on-page actions (the Calendly modal). No element fakes the other.
  const semantics = await page.evaluate(() => {
    const startFree = [...document.querySelectorAll("a")].filter(a => /start free/i.test(a.textContent || ""));
    const startFreeButtons = [...document.querySelectorAll("button")].filter(b => /start free/i.test(b.textContent || ""));
    const talk = [...document.querySelectorAll("button")].filter(b => /talk to the founder/i.test(b.textContent || ""));
    const talkAnchors = [...document.querySelectorAll("a")].filter(a => /talk to the founder/i.test(a.textContent || ""));
    return {
      startFreeAnchors: startFree.length, startFreeHrefs: startFree.map(a => a.getAttribute("href")),
      startFreeButtons: startFreeButtons.length, talkButtons: talk.length, talkAnchors: talkAnchors.length,
    };
  });
  ok("every navigating CTA is a REAL anchor: Start free is <a href=/signup>, never a <button>",
     semantics.startFreeAnchors >= 2 && semantics.startFreeButtons === 0 && semantics.startFreeHrefs.every(h => h === "/signup"), semantics);
  ok("on-page actions stay <button>: Talk to the founder opens the modal, never a fake anchor",
     semantics.talkButtons >= 2 && semantics.talkAnchors === 0, semantics);
  const overlay = await page.evaluate(() => [...document.querySelectorAll("div")].some(d => {
    const s = getComputedStyle(d);
    if (s.position !== "fixed" || s.display === "none") return false;
    const r = d.getBoundingClientRect();
    return r.width > innerWidth * 0.6 && r.height > innerHeight * 0.6 && parseFloat(s.opacity) > 0.1;
  }));
  ok("NO auto popup, modal or interstitial covers the page on load", !overlay, null);
  ok("console is clean — no page errors, no asset 404s", errors.length === 0, errors.slice(0, 4));

  // ── §7 · CLS 0.0000 at BOTH widths + no sideways scroll ────────────────
  console.log("\n— §7 · layout stability —");
  for (const width of [1440, 390]) {
    const vp = width === 1440 ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
    const p2 = await browser.newPage({ viewport: vp });
    await p2.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
        .observe({ type: "layout-shift", buffered: true });
    });
    await p2.goto(BASE + "/", { waitUntil: "networkidle" });
    const docH = await p2.evaluate(() => document.documentElement.scrollHeight);
    for (const f of [0.25, 0.5, 0.75, 1]) {
      await p2.evaluate(y => window.scrollTo(0, y), Math.round((docH - vp.height) * f));
      await p2.waitForTimeout(250);
    }
    const cls = await p2.evaluate(() => window.__cls);
    ok(`${width}px: CLS ${cls.toFixed(4)} === 0.0000 over a full scroll`, cls === 0, cls);
    const sw = await p2.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    ok(`${width}px: the page body does not scroll sideways`, sw.s <= sw.c + 1, sw);
    await p2.close();
  }
  await page.close();

  // ── §8 · reduced motion — field AND thread visual fully visible ────────
  console.log("\n— §8 · reduced motion —");
  const rctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const rp = await rctx.newPage();
  await rp.goto(BASE + "/", { waitUntil: "networkidle" });
  await rp.waitForTimeout(900);
  const rm = await rp.evaluate(() => {
    const d = [...document.querySelectorAll(".df-dot")];
    const k = [...document.querySelectorAll(".lt-knot")];
    const dots = [...document.querySelectorAll(".lt-dot")];
    return {
      n: d.length, min: d.length ? Math.min(...d.map(x => parseFloat(getComputedStyle(x).opacity))) : -1,
      knots: k.length,
      knotMin: dots.length ? Math.min(...dots.map(x => parseFloat(getComputedStyle(x).opacity))) : -1,
      anyAnim: [...document.querySelectorAll(".lt-dot,.df-dot")].some(x => getComputedStyle(x).animationName !== "none"),
    };
  });
  ok(`all ${rm.n} dots present with reduced motion on`, rm.n === 199, rm.n);
  ok("EVERY dot is fully visible with reduced motion on", rm.min === 1, rm.min);
  ok("the thread visual renders all five knots under reduced motion, at full opacity, not breathing",
     rm.knots === 5 && rm.knotMin === 1 && rm.anyAnim === false, rm);
  await rctx.close();

  await browser.close();
  const ran = pass + fail;
  const delta = ran - GUARDS_BEFORE;
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`${ran} guards ran — ${delta === 0 ? "SAME AS" : delta < 0 ? `${-delta} FEWER than` : `${delta} MORE than`} BUILD-74's ${GUARDS_BEFORE}.`);
  if (delta <= 0) console.log("  ↑ BUILD-81's rule: this gate GROWS, never shrinks. A same-or-lower count means a guard was dropped.");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
