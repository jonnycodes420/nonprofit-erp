// BUILD-59 — WCAG AA over the portal, pinned. Two families:
//
//   §1 text OVER A PHOTOGRAPH — the banner scrim (lib/portalScrim.js, the same
//      model the render uses) is composited over the ACTUAL pixels of each demo
//      image in the region where the identity plaque sits, and the resulting
//      contrast for the white plaque text must clear AA (4.5:1) at EVERY
//      sampled pixel — tested against the lightest image (the church), which is
//      where a bottom scrim is most likely to fail.
//
//   §2 the STATIC palette pairs the portal renders as text (neutral body/label
//      on the page/card backgrounds) must clear AA; and the light brand colors
//      (brass/sage) must NOT be used as small body text on cream (they can't
//      hit 4.5 — the BUILD-12 rule), which the render honors by using them only
//      as non-text accents.
//
// Pure Node (sharp reads the pixels) — no browser, no server. The images are
// committed at tests/fixtures/portal-images/.

const { ok, summary } = require("./helpers");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IMG_DIR = path.join(__dirname, "fixtures", "portal-images");
const WHITE = [255, 255, 255];

// The plaque text band, as fractions of the banner. The plaque sits at the
// bottom-left: name text spans ~x[0.04,0.60], and vertically sits in the
// bottom ~[0.74,0.96] of the banner. We sample a grid there.
const TEXT_BOX = { x0: 0.03, x1: 0.62, y0: 0.72, y1: 0.97 };

async function sampleBannerContrast(file, scrim) {
  // Emulate the render: object-fit:cover into the 1200/300 (4:1) banner ratio,
  // then read the pixels under the text box. cover = resize to fill + crop.
  const RW = 1200, RH = 300;
  const buf = await sharp(path.join(IMG_DIR, file))
    .resize(RW, RH, { fit: "cover", position: "attention" })
    .raw().toBuffer({ resolveWithObject: true });
  const { data, info } = buf;
  const chans = info.channels;
  const results = [];
  const cols = 24, rows = 8;
  for (let r = 0; r < rows; r++) {
    const yf = TEXT_BOX.y0 + (TEXT_BOX.y1 - TEXT_BOX.y0) * (r / (rows - 1));
    const py = Math.min(info.height - 1, Math.round(yf * info.height));
    for (let c = 0; c < cols; c++) {
      const xf = TEXT_BOX.x0 + (TEXT_BOX.x1 - TEXT_BOX.x0) * (c / (cols - 1));
      const px = Math.min(info.width - 1, Math.round(xf * info.width));
      const idx = (py * info.width + px) * chans;
      const rgb = [data[idx], data[idx + 1], data[idx + 2]];
      results.push(scrim.textContrastOverPixel(rgb, yf, WHITE));
    }
  }
  return { min: Math.min(...results), mean: results.reduce((a, b) => a + b, 0) / results.length };
}

(async () => {
  console.log("portal-contrast (BUILD-59)");
  const scrim = await import("../client/src/lib/portalScrim.js");

  // ── §1 scrim over each demo photo, worst-case pixel ≥ AA ─────────────────
  console.log("\n§1 white plaque text over the banner photo clears AA (4.5:1)");
  const images = ["church-card-16x9.jpg", "installation-banner-3x1.jpg", "gallery-banner-3x1.jpg"];
  for (const img of images) {
    const { min, mean } = await sampleBannerContrast(img, scrim);
    ok(`${img}: worst-case text pixel ≥ 4.5:1 (min ${min.toFixed(2)}, mean ${mean.toFixed(1)})`, min >= 4.5, { min: +min.toFixed(2) });
  }
  // The church is the lightest → the binding case. Called out explicitly.
  {
    const { min } = await sampleBannerContrast("church-card-16x9.jpg", scrim);
    ok(`the lightest image (church) is the binding case and passes (${min.toFixed(2)}:1)`, min >= 4.5, { min: +min.toFixed(2) });
  }

  // ── §2 static palette pairs ──────────────────────────────────────────────
  console.log("\n§2 static portal text pairs clear AA");
  const CREAM = [240, 237, 230];   // #f0ede6 brand cream
  const PAGE = [250, 249, 246];    // portal --pt-bg default #faf9f6
  const WHITE_BG = [255, 255, 255];// card
  const INK = [28, 28, 26];        // #1c1c1a body
  const MUTED = [107, 107, 100];   // #6b6b64 labels/footer/muted
  const BRASS = [201, 168, 76];    // #c9a84c gold/brass
  const SAGE = [143, 168, 150];    // #8fa896 sage
  for (const [name, fg, bg] of [
    ["ink body on page", INK, PAGE], ["ink body on card", INK, WHITE_BG],
    ["muted label on page", MUTED, PAGE], ["muted label on card", MUTED, WHITE_BG],
    ["muted on cream", MUTED, CREAM],
  ]) {
    const cr = scrim.contrastRatio(fg, bg);
    ok(`${name}: ${cr.toFixed(2)}:1 ≥ 4.5`, cr >= 4.5, { cr: +cr.toFixed(2) });
  }
  // The light brand colors as body text on cream FAIL — the render must not use
  // them there (they live on non-text accents: the 3px underline, washes). This
  // asserts the KNOWN fact so nobody "fixes" the portal by making brass a text
  // color on cream.
  for (const [name, fg] of [["brass", BRASS], ["sage", SAGE]]) {
    const cr = scrim.contrastRatio(fg, CREAM);
    ok(`${name} on cream is <4.5 as small text (${cr.toFixed(2)}) — used as accent only, never body`, cr < 4.5, { cr: +cr.toFixed(2) });
  }

  // ── §3 the scrim is a GRADIENT behind text, not a flat wash ──────────────
  console.log("\n§3 scrim is a bottom gradient, not a flat overlay");
  ok("scrim is fully transparent at the top (photo unobscured)", scrim.scrimAlphaAt(0) === 0, { top: scrim.scrimAlphaAt(0) });
  ok("scrim is strong at the bottom text band", scrim.scrimAlphaAt(1) >= 0.6, { bottom: scrim.scrimAlphaAt(1) });
  ok("scrim ramps (mid < bottom) — a gradient, not a flat overlay", scrim.scrimAlphaAt(0.5) < scrim.scrimAlphaAt(1), null);

  summary();
})().catch(e => { console.error(e); process.exit(1); });
