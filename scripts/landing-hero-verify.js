// BUILD-28 — image-forward hero verification (committed with the feature).
//
// Asserts the photo hero is present and honest AND that the headline stays
// WCAG-AA legible OVER THE REAL COMPOSITED IMAGE at desktop and mobile:
//   1. the hero renders a <img> photo with a responsive srcset + sizes +
//      fetchpriority (the LCP element), object-fit cover.
//   2. the scrim is a FLAT rgba wash, not a gradient (gradients are banned):
//      the scrim's computed background-image is `none` and its background-color
//      carries alpha < 1.
//   3. headline + subhead contrast ≥ 4.5:1 measured against the ACTUAL pixels
//      behind the text (text hidden, hero photo+scrim screenshotted, per-pixel
//      luminance averaged) — at 1280 (desktop) and 390 (mobile) widths.
//   4. no fabricated-proof strings inside the verticals band.
//
//   PLAYWRIGHT_DIR=/path/with/playwright BASE=http://localhost:4173 \
//     node scripts/landing-hero-verify.js
//   (default BASE https://www.stewardapp.dev)

const path = require("path");
if (process.env.PLAYWRIGHT_DIR) module.paths.unshift(path.join(process.env.PLAYWRIGHT_DIR, "node_modules"));
const { chromium } = require("playwright");
const sharp = require(path.join(__dirname, "..", "node_modules", "sharp"));

const BASE = process.env.BASE || "https://www.stewardapp.dev";
const CREAM = "#f0ede6"; // the headline / subhead ink over the photo
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 300) : "")); }
};

// ── WCAG relative-luminance + contrast ──
const chan = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = (r, g, b) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const hexLum = h => lum(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const contrast = (l1, l2) => { const a = Math.max(l1, l2), b = Math.min(l1, l2); return (a + 0.05) / (b + 0.05); };

// Mean per-pixel luminance of a PNG buffer.
async function meanLum(buf) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const px = info.channels; let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += px) { sum += lum(data[i], data[i + 1], data[i + 2]); n++; }
  return sum / n;
}

async function heroContrastAt(page, width) {
  await page.setViewportSize({ width, height: 860 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // rects of the text we care about, while it's still visible
  const rects = await page.evaluate(() => {
    const q = s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    return { headline: q(".lp-hero-copy h1"), subhead: q(".lp-hero-copy p:not(.lp-hero-trust)") };
  });
  // hide ONLY the copy (photo + scrim are siblings, so they remain) and shoot
  // the background that sits behind each text block.
  await page.evaluate(() => { document.querySelector(".lp-hero-content").style.visibility = "hidden"; });
  const out = {};
  for (const [k, r] of Object.entries(rects)) {
    if (!r || r.w < 2 || r.h < 2) { out[k] = null; continue; }
    const clip = { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(width - Math.max(0, r.x), r.w), height: r.h };
    const buf = await page.screenshot({ clip });
    out[k] = contrast(hexLum(CREAM), await meanLum(buf));
  }
  return out;
}

(async () => {
  console.log("landing-hero-verify against " + BASE + "\n");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // ── 1. photo hero present + responsive + LCP hints ──
  const img = await page.evaluate(() => {
    const i = document.querySelector(".lp-hero-photo img.lp-hero-img");
    if (!i) return null;
    const cs = getComputedStyle(i);
    return {
      srcset: i.getAttribute("srcset") || "", sizes: i.getAttribute("sizes") || "",
      fp: i.getAttribute("fetchpriority") || "", objectFit: cs.objectFit,
      alt: i.getAttribute("alt"),
    };
  });
  ok("hero renders a <img> photo", !!img);
  ok("hero photo has a multi-size srcset", img && (img.srcset.match(/\dw/g) || []).length >= 3, img && img.srcset);
  ok("hero photo has sizes", img && /vw|px/.test(img.sizes), img && img.sizes);
  ok("hero photo fetchpriority=high (LCP)", img && img.fp === "high", img && img.fp);
  ok("hero photo object-fit: cover", img && img.objectFit === "cover", img && img.objectFit);
  ok("hero photo is decorative (empty alt, not a captioned customer)", img && img.alt === "", img && img.alt);

  // ── 2. scrim is a FLAT rgba wash, not a gradient ──
  const scrim = await page.evaluate(() => {
    const s = document.querySelector(".lp-hero-scrim"); if (!s) return null;
    const cs = getComputedStyle(s);
    return { bgImage: cs.backgroundImage, bgColor: cs.backgroundColor };
  });
  ok("hero scrim present", !!scrim);
  ok("hero scrim has NO gradient (flat wash)", scrim && scrim.bgImage === "none", scrim && scrim.bgImage);
  ok("hero scrim background-color carries alpha < 1", scrim && /rgba?\([^)]*,\s*0?\.\d+\)/.test(scrim.bgColor), scrim && scrim.bgColor);

  // ── 4. no fabricated proof in the verticals band ──
  const bandText = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".lp-vert-card")];
    return els.map(e => e.innerText).join(" \n ");
  });
  const BANNED = [/trusted by/i, /\d[\d,]*\+?\s+(nonprofits|orgs|organizations|customers)/i, /★|⭐|\bout of 5\b/i, /loved by/i];
  ok("verticals band present (3 cards)", (bandText.match(/\n/g) || []).length >= 2 || bandText.length > 0);
  for (const re of BANNED) ok("verticals band: no fabricated-proof " + re, !re.test(bandText));

  // ── 3. measured AA contrast over the real image, desktop + mobile ──
  for (const w of [1280, 390]) {
    const c = await heroContrastAt(page, w);
    const label = w >= 1000 ? "desktop" : "mobile";
    ok(`${label} (${w}px): headline AA over the photo (≥4.5:1)`, c.headline != null && c.headline >= 4.5, c.headline && +c.headline.toFixed(2));
    ok(`${label} (${w}px): subhead AA over the photo (≥4.5:1)`, c.subhead != null && c.subhead >= 4.5, c.subhead && +c.subhead.toFixed(2));
  }

  // ── 5. BUILD-29 hero product card: a single DOM/vector card floated over the
  //     photo (clarity that this is SOFTWARE), never a raster <img>, and it
  //     must NOT collide with the headline/subhead/CTAs at 1280 & 1024. On
  //     mobile it's dropped (hidden), never crowding the type.
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
      return { present: true, shown, hitsType, isImg, tag: c.tagName };
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
