// BUILD-41 — solid-ink hero verification (supersedes the BUILD-28 photo-hero
// version of this script; the choir photograph was retired 2026-08-06).
//
// Asserts the hero is the SOLID FIELD design and stays honest:
//   1. NO image anywhere in the hero — no <img>, no CSS background-image, no
//      scrim layer. (The photo muddied the type and was the LCP problem; the
//      cream serif on ink with the brass rule carries itself. A reintroduced
//      hero image should fail here until this script is deliberately updated.)
//   2. the hero background is the ink field #0f1a12, and the headline/subhead
//      are present with AA+ contrast (cream on ink is 15.1:1, computed, not
//      assumed).
//   3. the subhead is the ONE-CLAUSE promise (no trailing "— and stops you…"
//      clause), and the trust strip is present.
//   4. the BUILD-29 floated product card: DOM/vector, shown at 1280px, never
//      colliding with the type at 1280/1024, dropped on mobile.
//   5. no fabricated-proof strings in the verticals band (unchanged).
//
//   PLAYWRIGHT_DIR=/path/with/playwright BASE=http://localhost:4173 \
//     node scripts/landing-hero-verify.js
//   (default BASE https://www.stewardapp.dev)

const path = require("path");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");

const BASE = process.env.BASE || "https://www.stewardapp.dev";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};

// WCAG contrast for the solid-field case (no per-pixel sampling needed).
const chan = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = (r, g, b) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const parseRgb = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
const contrast = (a, b) => { const [l1, l2] = [lum(...a), lum(...b)]; const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };

(async () => {
  console.log("landing-hero-verify against " + BASE + "\n");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // ── 1. No image in the hero — solid field only ──
  const hero = await page.evaluate(() => {
    const h = document.querySelector(".lp-hero-photo");
    if (!h) return null;
    const cs = getComputedStyle(h);
    const imgs = h.querySelectorAll("img").length;
    const bgImages = [h, ...h.querySelectorAll("*")].filter(el => {
      const bi = getComputedStyle(el).backgroundImage;
      return bi && bi !== "none";
    }).length;
    const scrim = h.querySelector(".lp-hero-scrim") ? 1 : 0;
    return { bg: cs.backgroundColor, imgs, bgImages, scrim };
  });
  ok("hero section present", !!hero);
  ok("hero contains NO <img> (photo retired, BUILD-41)", hero && hero.imgs === 0, hero && hero.imgs);
  ok("hero has NO css background-image on any layer", hero && hero.bgImages === 0, hero && hero.bgImages);
  ok("no scrim layer (nothing to scrim)", hero && hero.scrim === 0);
  ok("hero background is the ink field #0f1a12", hero && parseRgb(hero.bg).join(",") === "15,26,18", hero && hero.bg);

  // ── 2. type present + computed AA contrast on the solid field ──
  const type = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    const h1 = q(".lp-hero-copy h1"), sub = q(".lp-hero-copy p:not(.lp-hero-trust)"), trust = q(".lp-hero-trust");
    return {
      h1: h1 && { text: h1.innerText, color: getComputedStyle(h1).color },
      sub: sub && { text: sub.innerText, color: getComputedStyle(sub).color },
      trust: trust && trust.innerText,
    };
  });
  ok("headline present ('Steward notices')", type.h1 && /notices/.test(type.h1.text));
  ok("headline contrast on ink ≥ 7:1", type.h1 && contrast(parseRgb(type.h1.color), [15, 26, 18]) >= 7,
    type.h1 && +contrast(parseRgb(type.h1.color), [15, 26, 18]).toFixed(1));
  ok("subhead is the ONE-CLAUSE promise", type.sub && /who to call today, and what to say\./.test(type.sub.text));
  ok("subhead does NOT carry the old trailing clause", type.sub && !/failed\s+cards and silence/.test(type.sub.text), type.sub && type.sub.text);
  ok("subhead contrast on ink ≥ 4.5:1", type.sub && contrast(parseRgb(type.sub.color), [15, 26, 18]) >= 4.5,
    type.sub && +contrast(parseRgb(type.sub.color), [15, 26, 18]).toFixed(1));
  ok("trust strip present (no platform fee · no donor tip · own Stripe)",
    /no platform fee/i.test(type.trust || "") && /own\s+stripe/i.test(type.trust || ""), type.trust);

  // ── 5. no fabricated proof in the verticals band ──
  const bandText = await page.evaluate(() =>
    [...document.querySelectorAll(".lp-vert-card")].map(e => e.innerText).join(" \n ")
  );
  const BANNED = [/trusted by/i, /\d[\d,]*\+?\s+(nonprofits|orgs|organizations|customers)/i, /★|⭐|\bout of 5\b/i, /loved by/i];
  ok("verticals band present (3 cards)", bandText.length > 0);
  for (const re of BANNED) ok("verticals band: no fabricated-proof " + re, !re.test(bandText));

  // ── 4. floated product card behavior (BUILD-29, unchanged) ──
  const card = async (width) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const c = document.querySelector(".lp-hero-card");
      if (!c) return { present: false };
      const cs = getComputedStyle(c);
      const shown = cs.display !== "none" && cs.visibility !== "hidden";
      const cr = c.getBoundingClientRect();
      const overlaps = (sel) => {
        const el = document.querySelector(sel); if (!el) return false;
        const r = el.getBoundingClientRect();
        return !(cr.right <= r.left || cr.left >= r.right || cr.bottom <= r.top || cr.top >= r.bottom);
      };
      const hitsType = shown && (overlaps(".lp-hero-copy h1") || overlaps(".lp-hero-copy p:not(.lp-hero-trust)") || overlaps(".lp-hero-copy button"));
      const isImg = !!c.querySelector("img");
      return { present: true, shown, hitsType, isImg };
    });
  };
  const c1280 = await card(1280);
  ok("hero product card present in DOM", c1280.present);
  ok("hero product card shown at 1280px", c1280.present && c1280.shown);
  ok("hero product card is DOM/vector (no raster <img>)", c1280.present && !c1280.isImg);
  ok("hero product card does NOT collide with type at 1280px", c1280.present && !c1280.hitsType);
  const c1024 = await card(1024);
  ok("hero product card does NOT collide with type at 1024px (hidden or clear)", c1024.present && !c1024.hitsType);
  const c390 = await card(390);
  ok("hero product card dropped on mobile (390px)", c390.present && !c390.shown);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
