// BUILD-28 — one-time landing photography asset generator.
//
// Converts the licensed source photos (staged in ~/Downloads) into the
// responsive WebP variants the image-forward landing serves from
// client/public/. Run once; the outputs are committed. Re-runnable and
// idempotent (overwrites the same output files).
//
//   node scripts/build28-prepare-images.js
//
// Naming: outputs deliberately AVOID an `lp-` prefix so they never trip the
// landing crispness/image guards (which forbid any `/lp-` product <img>).
// Provenance + license for each source is recorded in client/public/ASSETS.md.

const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require(path.join(__dirname, "..", "node_modules", "sharp"));

const DL = path.join(os.homedir(), "Downloads");
const OUT = path.join(__dirname, "..", "client", "public");

// Sources are free-tier Unsplash downloads (photographer + photo id in the
// filename → provenance for client/public/ASSETS.md). User-confirmed free use.
// [sourceFile, outBasename, widths[], quality]
const JOBS = [
  // Hero — community choir mid-performance (Omar Flores). LCP element, 16:9,
  // near-black upper-left for the headline. Served responsive at 100vw.
  ["omar-flores-AndwyJNdk1k-unsplash.jpg", "hero-choir", [960, 1280, 1920, 2560], 80],
  // (Retired FIX 2026-07-30: the mid-page pottery/studio band was removed from
  // the landing — a tight macro read as texture, not a place. Do not regenerate
  // band-studio-*. If a mid-page breath returns, use a wide art-studio ROOM shot.)
  // Arts & culture vertical card — patrons at an arts space (Dillon Wanner).
  // ~360px displayed, so lower-res is fine at 2x.
  ["dillon-wanner-EeAL5G9HDV0-unsplash.jpg", "card-arts", [400, 800], 80],
  // Rescue & relief vertical card — shelter dogs (Sasha Sashina). ~360px.
  ["sasha-sashina-Xcscr_sNSEY-unsplash.jpg", "card-rescue", [400, 800], 80],
  // Faith & community vertical card — hillside chapel at dusk (Kevin Mueller).
  // Portrait source; cropped to the card via object-position (see Landing.jsx).
  ["kevin-mueller-8IbeGOj9AGA-unsplash.jpg", "card-faith", [400, 800], 80],
];

(async () => {
  for (const [srcName, base, widths, quality] of JOBS) {
    const src = path.join(DL, srcName);
    if (!fs.existsSync(src)) { console.error("MISSING source:", src); process.exit(1); }
    const meta = await sharp(src).metadata();
    for (const w of widths) {
      if (w > meta.width) { console.log(`  skip ${base}-${w} (source only ${meta.width}px wide)`); continue; }
      const out = path.join(OUT, `${base}-${w}.webp`);
      await sharp(src).resize({ width: w }).webp({ quality }).toFile(out);
      const kb = (fs.statSync(out).size / 1024).toFixed(0);
      console.log(`  ${path.basename(out)}  ${w}px  ${kb}KB`);
    }
  }
  console.log("done.");
})().catch(e => { console.error(e); process.exit(1); });
