#!/usr/bin/env node
// scripts/landing-prod-verify.js — the landing page's PROD honesty + quality gate.
//
// ── WHY THIS FILE REPLACED FIVE ─────────────────────────────────────────────
// BUILD-73 Part 4 rebuilt the landing page, and five prod-targeting scripts
// were left asserting against a page that no longer exists:
//
//   landing-funnel-verify.js    section order, the recovery calculator, the
//                               "$149" pricing signal, the /invitation copy
//   landing-hero-verify.js      the ink-field hero (BUILD-41) and its scrim
//   landing-crispness-prod.js   raster-vs-DOM product screenshots at DPR 2/3
//   landing-image-verify.js     the same, byte-level
//   landing-motion-verify.js    the .lp-reveal IntersectionObserver machinery
//
// Three of those subjects are simply GONE — there is no calculator, no photo or
// ink hero, no product screenshots, and no reveal machinery on the rebuilt
// page. Two of them had assertions that INVERTED: the old script required a
// "$149" pricing signal and a /pricing link in the body, and the rebuilt page
// forbids both.
//
// But the gates worth keeping were scattered across all five, so they are
// consolidated here rather than deleted with them:
//
//   · the HONESTY gates (no fabricated social proof, no invented numbers, the
//     FEP attribution, no competitor cited as the authority, no "keep 100%"
//     overclaim) — these are permanent and predate the rebuild;
//   · CLS ≤ 0.02 on mobile and "no auto popup covers the page on load", which
//     were buried in landing-motion-verify;
//   · measured text contrast, which was buried in landing-hero-verify.
//
// Plus the rebuilt page's own rules: NO PRICING ANYWHERE, no outcome-claim
// language, and the dot field's four renders nesting correctly.
//
// The retired scripts' remaining subject — "is the product shot a crisp DOM
// render rather than a blurry raster?" — has no page left to police. That is
// recorded in audit/BUILD-73-FINDINGS.md rather than kept as dead code.
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

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 260) : "")); }
};

let chromium;
try { ({ chromium } = require(path.join(PW, "node_modules", "playwright"))); }
catch { console.log("  SKIP  Playwright not found (set PLAYWRIGHT_DIR)\n\n0 passed, 0 failed (skipped)"); process.exit(0); }

// Relative luminance / contrast, so the text gates are MEASURED rather than
// assumed from the palette.
const lum = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);

(async () => {
  console.log(`landing-prod-verify → ${BASE}\n`);
  const browser = await chromium.launch();

  // ── §1 · structure ──────────────────────────────────────────────────────
  console.log("— §1 · the page is the page —");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 140)));
  page.on("response", r => { if (r.status() >= 400 && !r.url().includes("_vercel")) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 80)}`); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);

  const text = await page.evaluate(() => document.body.innerText);
  const SECTIONS = [
    "Donors don't leave.",                                   // hero
    "Fundraising Effectiveness Project, full-year 2025",     // source strip
    "You know your donors. Steward notices when they're slipping.", // verticals
    "Nobody decides to stop giving. It just stops.",         // the year
    "They have names, and one of them is about to be gone.", // every dot is a person
    "Built around the fundraiser's week, not the database.", // what it does
    "You didn't take this job to chase money.",              // who built this
    "Find out which of yours are gold.",                     // closing
  ];
  const positions = SECTIONS.map(s => text.indexOf(s));
  ok("every section is present", positions.every(p => p >= 0),
     SECTIONS.filter((_, i) => positions[i] < 0));
  ok("the sections render IN ORDER", positions.every((p, i) => i === 0 || p > positions[i - 1]), positions);
  ok("all three verticals cards are present",
     /Arts & culture/.test(text) && /Rescue & relief/.test(text) && /Faith & community/.test(text), null);

  // ── §2 · NO PRICING — the rebuilt page's own rule ───────────────────────
  console.log("\n— §2 · no pricing, anywhere —");
  const PRICE = [/\$\d{2,4}\s*\/\s*mo/i, /\bper month\b/i, /\/month\b/i, /\bfounding[- ]partner\b/i,
                 /\bCore plan\b/i, /\bTeam plan\b/i, /\bpricing\b/i, /\bplans?\b/i, /\btiers?\b/i];
  ok("no price, plan name or tier in the rendered text",
     !PRICE.some(re => re.test(text)), PRICE.filter(re => re.test(text)).map(String));
  const links = await page.evaluate(() => [...document.querySelectorAll("a")].map(a => a.getAttribute("href")));
  ok("no /pricing link in nav or footer (the ROUTE survives; the links do not)",
     !links.includes("/pricing"), links);

  // ── §3 · honesty gates — permanent, and older than this rebuild ─────────
  console.log("\n— §3 · honesty —");
  ok("no fabricated social proof (trusted-by / as-seen-in / star ratings / user counts)",
     !/trusted by|as seen in|★|rated \d|\d+\s*(customers|nonprofits|organizations)\s+(use|trust)/i.test(text), null);
  const imgs = await page.evaluate(() => [...document.querySelectorAll("img")].map(i => i.getAttribute("src") || ""));
  ok("no logo-bar imagery", !imgs.some(s => /logo|client|partner/i.test(s)), imgs);
  ok("the 43%-class stat is attributed to the Fundraising Effectiveness Project",
     /Fundraising Effectiveness Project/.test(text), null);
  ok('"full-year 2025" is intact — FEP rebased in Q1 2026 and now headlines a QUARTERLY figure',
     /Fundraising Effectiveness Project, full-year 2025/.test(text), null);
  ok("no competitor cited as the authority (Bloomerang republishes FEP's number)",
     !/bloomerang/i.test(text), null);
  ok('no "keep 100% of every gift" overclaim — Stripe\'s own fee still applies',
     !/keep 100%/i.test(text), null);
  ok("the fee claim is the honest one (no platform fee · no donor tip · own Stripe)",
     /No platform fee/i.test(text) && /own Stripe/i.test(text), null);
  const BANNED = [/\brecovered\b/i, /\bre-?engaged\b/i, /\brecaptured\b/i, /\bwon\s+back\b/i, /\bbrought\s+back\b/i];
  ok("no outcome-claim language (BUILD-73 Part 3's ban reaches the landing page too)",
     !BANNED.some(re => re.test(text)), BANNED.filter(re => re.test(text)).map(String));
  ok("the placeholders are VISIBLE, not silently blank or invented",
     ["[LAST NAME]", "[SCHOOL]", "[ FOUNDER PHOTO ]", "[LEGAL ENTITY NAME]"].every(p => text.includes(p)),
     ["[LAST NAME]", "[SCHOOL]", "[ FOUNDER PHOTO ]", "[LEGAL ENTITY NAME]"].filter(p => !text.includes(p)));

  // ── §4 · the dot field ──────────────────────────────────────────────────
  console.log("\n— §4 · the dot field —");
  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('[role="img"]')].map(f =>
      [...f.querySelectorAll("span")]
        .map((d, i) => getComputedStyle(d).backgroundColor === "rgb(201, 168, 76)" ? i : -1)
        .filter(i => i >= 0)));
  ok("four fields of 199 dots", fields.length === 4, fields.length);
  const [hero, jan, jun, dec] = fields;
  ok("January 0 · June 31 · December 74 · hero 74",
     jan?.length === 0 && jun?.length === 31 && dec?.length === 74 && hero?.length === 74,
     fields.map(f => f.length));
  ok("June's 31 are a SUBSET of December's 74 — the section does not lie",
     jun && dec && jun.every(i => dec.includes(i)), null);

  // ── §5 · measured contrast ──────────────────────────────────────────────
  console.log("\n— §5 · measured contrast —");
  const c = await page.evaluate(() => {
    const pick = sel => { const el = document.querySelector(sel); if (!el) return null;
      let bg = "", n = el;
      while (n && (!bg || bg === "rgba(0, 0, 0, 0)")) { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
      return { fg: getComputedStyle(el).color, bg, size: parseFloat(getComputedStyle(el).fontSize) }; };
    return { h1: pick("h1"), lede: pick("h1 + p") || pick("p") };
  });
  if (c.h1) ok(`hero headline contrast ${contrast(rgb(c.h1.fg), rgb(c.h1.bg)).toFixed(2)}:1 ≥ 4.5 (large text)`,
    contrast(rgb(c.h1.fg), rgb(c.h1.bg)) >= 4.5, c.h1);
  if (c.lede) ok(`hero lede contrast ${contrast(rgb(c.lede.fg), rgb(c.lede.bg)).toFixed(2)}:1 ≥ 4.5`,
    contrast(rgb(c.lede.fg), rgb(c.lede.bg)) >= 4.5, c.lede);

  // ── §6 · wiring, and nothing interrupts the reader ─────────────────────
  console.log("\n— §6 · wiring —");
  ok('no dead href="#"', !links.includes("#"), links.filter(l => l === "#"));
  ok("Terms and Privacy link to real routes", links.includes("/terms") && links.includes("/privacy"), links);
  ok("Log in links to /login", links.includes("/login"), links);
  ok('"Start free" is present', /Start free/.test(text), null);
  ok('"Talk to the founder" is present', /Talk to the founder/.test(text), null);
  const overlay = await page.evaluate(() => [...document.querySelectorAll("div")].some(d => {
    const s = getComputedStyle(d);
    if (s.position !== "fixed" || s.display === "none") return false;
    const r = d.getBoundingClientRect();
    return r.width > innerWidth * 0.6 && r.height > innerHeight * 0.6 && parseFloat(s.opacity) > 0.1;
  }));
  ok("NO auto popup, modal or interstitial covers the page on load", !overlay, null);
  ok("console is clean — no page errors, no asset 404s", errors.length === 0, errors.slice(0, 4));
  await page.close();

  // ── §7 · mobile CLS + no sideways scroll ───────────────────────────────
  console.log("\n— §7 · mobile —");
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mp.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: "layout-shift", buffered: true });
  });
  await mp.goto(BASE + "/", { waitUntil: "networkidle" });
  const docH = await mp.evaluate(() => document.documentElement.scrollHeight);
  for (const f of [0.25, 0.5, 0.75, 1]) {
    await mp.evaluate(y => window.scrollTo(0, y), Math.round((docH - 844) * f));
    await mp.waitForTimeout(250);
  }
  const cls = await mp.evaluate(() => window.__cls);
  ok(`CLS ${cls.toFixed(4)} ≤ 0.02 over a full mobile scroll`, cls <= 0.02, cls);
  const sw = await mp.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  ok("390px: the page body does not scroll sideways", sw.s <= sw.c + 1, sw);
  await mp.close();

  // ── §8 · reduced motion — the field must be visible ────────────────────
  console.log("\n— §8 · reduced motion —");
  const rctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
  const rp = await rctx.newPage();
  await rp.goto(BASE + "/", { waitUntil: "networkidle" });
  await rp.waitForTimeout(900);
  const rm = await rp.evaluate(() => {
    const d = [...document.querySelectorAll(".df-dot")];
    return { n: d.length, min: d.length ? Math.min(...d.map(x => parseFloat(getComputedStyle(x).opacity))) : -1 };
  });
  ok(`all ${rm.n} dots present with reduced motion on`, rm.n === 796, rm.n);
  ok("EVERY dot is fully visible with reduced motion on — a blank hero is the failure this prevents",
     rm.min === 1, rm.min);
  await rctx.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
