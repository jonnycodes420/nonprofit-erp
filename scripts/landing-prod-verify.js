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
// CLS + no-sideways-scroll, reduced-motion visibility, and the © line —
// which 2026-09-12 INVERTED: it used to require the bracketed placeholder be
// visible (BUILD-73's refusal to invent a legal entity), and now requires the
// registered name and the current year, with no bracketed placeholder of any
// shape surviving on a public page. New BUILD-81 gates: the question is the H1; "The Thread"
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
// BUILD-89S 89f added 7: the Keep-how-people-give section, and the rule that
// the page may never name a source the product cannot actually read.
// BUILD-91 91i adds the PUBLIC SOURCE ROW: one gate per source the row
// actually shows, driven by shared/publicSources.js rather than by a list
// typed twice, plus the standing negative — Cash App and Venmo may never
// appear under "Connects directly", on any page, ever.

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
  // The entity name is READ, never re-typed: shared/legalEntity.js is the one
  // module that holds it (ESM, hence the dynamic import from this CJS script),
  // so this gate cannot drift from what the page renders.
  const { LEGAL_ENTITY_NAME } = await import("../shared/legalEntity.js");
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
    "Log it. The next step comes back. It stays with you.",        // how it works
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
  // the close photo is loading="lazy": bring it into the viewport and wait for
  // the fetch before asserting — the guard tests what a reader who scrolls
  // there actually sees, not the browser's lazy-margin heuristics (which moved
  // when BUILD-82 shortened the section heads and turned this into a flake).
  // BUILD-96: ALL THREE are loading="lazy", and only #closing was being
  // scrolled to and waited for. #card-stops and #your-data were left to the
  // browser's lazy-margin heuristics, so this pass raced them: on 2026-09-24
  // against an UNCHANGED prod it went 80/0, then 79/1 on "your-data carries ONE
  // photograph", then 80/0 again. Both images serve 200 at their exact repo
  // byte sizes — the asset was never the problem, the assertion was.
  //
  // A guard that passes or fails on timing is worse than no guard: the next
  // person reads a red landing verifier and cannot tell a broken image from a
  // slow one. So every section gets the treatment #closing already had.
  for (const id of ["card-stops", "your-data", "closing"]) {
    await page.evaluate(sec => document.getElementById(sec)?.scrollIntoView({ block: "center" }), id);
    await page.waitForFunction(sec => {
      const imgs = [...(document.getElementById(sec)?.querySelectorAll("img") || [])];
      return imgs.length > 0 && imgs.every(i => i.naturalWidth > 0);
    }, id, { timeout: 15000 }).catch(() => {});
  }
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
  // FIX (product marks + language): The Thread and Drift are NAMED PRODUCTS,
  // rendered by the shared ProductMark pill on the landing AND in the app;
  // and Steward HOLDS things, it doesn't nag — "keeps asking" and "until
  // you've done it" are banned from every rendered surface.
  const marks = await page.evaluate(() => [...document.querySelectorAll(".pm-mark")].map(m => m.textContent.trim()));
  ok('the ProductMark pills render the literal names: "The Thread" (hero panel + how-it-works) and "Drift" (the Drift section)',
     marks.filter(m => m === "The Thread").length >= 2 && marks.filter(m => m === "Drift").length >= 1, marks);
  ok('no naggy language: "keeps asking" and "until you\'ve done it" absent from rendered text',
     !/keeps asking/i.test(text) && !/until you['\u2019]ve done it/i.test(text), null);
  // FILLED 2026-09-12 (the entity was registered in Kentucky). These assertions
  // used to demand the BRACKETED PLACEHOLDER be visible — BUILD-73's refusal to
  // invent a legal entity, made into a guard. The entity exists now, so they
  // invert: the DEPLOYED footer must carry the registered name, and no
  // bracketed placeholder of any shape may reach a public page. Asserted on the
  // family, not the one string — the value itself is read from the ONE constant
  // so this file holds no second copy of the name.
  ok("the © line names the registered legal entity on the DEPLOYED page",
     text.includes(LEGAL_ENTITY_NAME), (text.match(/©[^\n]{0,60}/g) || []));
  ok("…with the CURRENT year, computed rather than hardcoded",
     text.includes(`© ${new Date().getFullYear()} ${LEGAL_ENTITY_NAME}`), (text.match(/©[^\n]{0,60}/g) || []));
  const bracketed = text.match(/\[[A-Z][A-Z0-9]*(?: +[A-Z0-9]+)+\]/g) || [];
  ok("no bracketed placeholder of ANY shape survives on the public page",
     bracketed.length === 0, bracketed);
  // The dashed-outline Placeholder treatment is gone with the last blank it
  // flagged; a reintroduced one would be caught by the family check above and
  // by tests/legal-entity.test.js before it could ever deploy.
  const dashedLeft = await page.evaluate(() =>
    [...document.querySelectorAll("span")].filter(s => /^\[[A-Z]/.test(s.textContent.trim())).length);
  ok("no dashed unfinished-value chip remains in the DOM", dashedLeft === 0, dashedLeft);

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

  // ── BUILD-89S 89f — KEEP HOW PEOPLE GIVE ────────────────────────────────
  // The build's whole claim, on the page where a prospect reads it. The gate
  // that matters is NOT that the section exists: it is that the page never
  // names a source the product cannot actually read, and never softens the
  // second half of the promise. Its own page, so it does not depend on which
  // earlier section last closed a context.
  console.log("\n— §7c · keep how people give —");
  {
    const kp = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await kp.goto(BASE + "/", { waitUntil: "networkidle" });
    await kp.waitForTimeout(500);
    const keep = await kp.evaluate(() => {
      const sec = document.querySelector("#keep-giving");
      const data = document.querySelector("#your-data");
      if (!sec) return null;
      const t = sec.innerText;
      const line = label => {
        const el = [...sec.querySelectorAll("p")].find(p => p.innerText.startsWith(label));
        return el ? el.innerText : "";
      };
      return {
        text: t, connected: line("Connected:"), statement: line("Statement upload:"),
        emDash: t.includes("\u2014"),
        live: /\b(live|real[- ]time|realtime|instantly)\b/i.test(t),
        dataText: data ? data.innerText : "",
      };
    });
    ok("the Keep-how-people-give section is on the page", !!keep);
    ok("it says plainly that Steward never holds or moves your money",
       !!keep && /never holds or moves your money/i.test(keep.text), keep?.text?.slice(0, 160));
    ok("PayPal, Zeffy, Stripe and Givebutter are named as CONNECTED",
       !!keep && ["PayPal", "Zeffy", "Stripe", "Givebutter"].every(n => keep.connected.includes(n)), keep?.connected);
    ok("Cash App and Venmo are named as STATEMENT UPLOAD, never as connected",
       !!keep && ["Cash App", "Venmo"].every(n => keep.statement.includes(n) && !keep.connected.includes(n)),
       { connected: keep?.connected, statement: keep?.statement });
    ok('the section never says "live" or "real time" about a six-hourly read',
       !!keep && keep.live === false, keep?.text?.slice(0, 160));
    ok("no em dash in the section (the standing voice rule)", !!keep && keep.emDash === false);
    ok("the Your-data section carries the same money line",
       !!keep && /never holds or moves your money/i.test(keep.dataText), keep?.dataText?.slice(0, 200));
    await kp.close();
  }

  // ── BUILD-91 91i — THE PUBLIC SOURCE ROW ────────────────────────────────
  // A tile on this page is a claim made to somebody who has not signed up and
  // cannot check it. So the gate does not ask "does the row look right"; it
  // asks whether the page shows EXACTLY what the allowlist permits and not one
  // name more. The expected set is read from shared/publicSources.js — the
  // same module the page renders from — because a gate that keeps its own copy
  // of the answer stops being a gate the first time the two are edited apart.
  //
  // With an empty allowlist the correct page has NO direct group at all. That
  // is asserted as the positive result it is, not skipped: "we claim no direct
  // connection yet" is the thing 91i exists to make true.
  console.log("\n— §7d · the public source row —");
  {
    const pub = await import("../shared/publicSources.js");
    const expected = pub.publicSourceRow();
    const directNames = expected.direct.map(t => t.label);
    const uploadNames = expected.upload.map(t => t.label);

    const sp = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await sp.goto(BASE + "/", { waitUntil: "networkidle" });
    await sp.waitForTimeout(500);
    const seen = await sp.evaluate(() => {
      const row = document.querySelector('[data-testid="lp-source-row"]');
      if (!row) return null;
      const groups = [...row.querySelectorAll('[data-testid="lp-source-group"]')].map(g => ({
        heading: g.getAttribute("data-heading"),
        tiles: [...g.querySelectorAll('[data-testid="lp-source-tile"]')].map(t => t.getAttribute("data-source")),
      }));
      const promise = row.querySelector('[data-testid="lp-row-promise"]');
      return {
        groups,
        promise: promise ? promise.innerText.trim() : "",
        inKeepSection: !!document.querySelector("#keep-giving [data-testid=\"lp-source-row\"]"),
      };
    });

    ok("the source row renders, inside the Keep-how-people-give section",
       !!seen && seen.inKeepSection, seen);

    const group = h => (seen?.groups || []).find(g => g.heading === h);
    const direct = group(pub.DIRECT_HEADING);
    const upload = group(pub.UPLOAD_HEADING);

    // ONE GATE PER SOURCE SHOWN. The loop is over what the config permits, so
    // the gate count grows by itself the day a source is cleared, and nobody
    // has to remember to add an assertion for it.
    for (const name of directNames) {
      ok(`${name} is shown under "${pub.DIRECT_HEADING}", and its row in SOURCES.md is cleared`,
         !!direct && direct.tiles.includes(name), direct?.tiles);
    }
    for (const name of uploadNames) {
      ok(`${name} is shown under "${pub.UPLOAD_HEADING}"`,
         !!upload && upload.tiles.includes(name), upload?.tiles);
    }

    ok(`the direct group shows exactly the ${directNames.length} source(s) the allowlist permits, and no other`,
       directNames.length === 0 ? !direct : !!direct && direct.tiles.length === directNames.length,
       { shown: direct ? direct.tiles : null, allowed: directNames });

    if (directNames.length === 0) {
      ok("with nothing cleared, the page claims no direct connection and renders no empty heading",
         !direct, direct);
    }

    // THE STANDING NEGATIVE. Neither has an API that reads an account, so
    // neither may ever sit under the direct heading, whatever the allowlist
    // says and whoever edited it.
    const directTiles = direct ? direct.tiles : [];
    ok("Cash App never appears under the direct heading", !directTiles.includes("Cash App"), directTiles);
    ok("Venmo never appears under the direct heading", !directTiles.includes("Venmo"), directTiles);

    ok("the row carries the promise, both halves of it",
       !!seen && seen.promise === expected.promise, { on_page: seen?.promise, expected: expected.promise });
    ok("the row adds no em dash to the section (the standing voice rule)",
       !!seen && !seen.promise.includes("\u2014"), seen?.promise);

    await sp.close();
  }

  // ── §8 · reduced motion — field AND thread visual fully visible ────────
  // ── §7b · BUILD-82 Part 8 — the section heads STACK, left-aligned ───────
  console.log("\n— §7b · stacked section heads —");
  {
    const hp = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await hp.goto(BASE + "/", { waitUntil: "networkidle" });
    await hp.waitForTimeout(800);
    const heads = await hp.evaluate(() => {
      const out = {};
      for (const id of ["who-its-for", "how-it-works"]) {
        const sec = document.getElementById(id);
        if (!sec) { out[id] = null; continue; }
        const h2 = sec.querySelector("h2");
        const p = sec.querySelector(".lp-sechead-p") || (h2 && h2.parentElement.querySelector("p"));
        if (!h2 || !p) { out[id] = { missing: true }; continue; }
        const hb = h2.getBoundingClientRect(), pb = p.getBoundingClientRect();
        out[id] = { hx: hb.x, px: pb.x, hBottom: hb.bottom, pTop: pb.top,
                    hMax: parseFloat(getComputedStyle(h2).maxWidth) || null,
                    pMax: parseFloat(getComputedStyle(p).maxWidth) || null };
      }
      return out;
    });
    for (const id of ["who-its-for", "how-it-works"]) {
      const h = heads[id];
      ok(`#${id}: H2 and its paragraph share the same left edge (within 1px)`,
         h && !h.missing && Math.abs(h.hx - h.px) <= 1, h);
      ok(`#${id}: the paragraph sits BELOW the headline, never beside it`,
         h && !h.missing && h.pTop > h.hBottom - 1, h && { hBottom: h.hBottom, pTop: h.pTop });
    }
    ok("the head measures: H2 capped at 920, paragraph at 620",
       heads["how-it-works"] && heads["how-it-works"].hMax === 920 && heads["how-it-works"].pMax === 620, heads["how-it-works"]);
    await hp.close();
  }

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
