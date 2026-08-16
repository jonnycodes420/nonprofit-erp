// Demo-content guard (BUILD-54 follow-up, 2026-08-15). Pure Node, no DB.
// Run: node tests/demo-content.test.js
//
// Two live findings this pins:
//   • GAP 5 — a flat-color <rect> SVG seeded as an impact "photo" renders as a
//     solid brand-green block on the donor page (objectFit:cover crops the
//     caption away). Demo photos must be real committed photographs
//     (scripts/demo-assets/), never generated rect-SVG placeholders.
//   • GAP 6 — seed-build54 reused the org's theme banner as BOTH the page hero
//     widget image and the campaign hero, so one photo repeated across every
//     surface. Each surface must carry its own image.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const read = p => fs.readFileSync(path.join(root, p), "utf8");

// 1 — No seed/fix script feeds an SVG generator into a photos: array, and no
//     "svgPhoto"-style generator exists at all. A designed band/monogram SVG
//     remains legal as a theme banner/logo FALLBACK (svgBand/svgLogo) — the
//     ban is on SVGs posing as photographs.
const seedScripts = fs.readdirSync(path.join(root, "scripts"))
  .filter(f => /^(seed|fix)-.*\.js$/.test(f));
ok(seedScripts.length >= 5, "found the seed/fix script family");
for (const f of seedScripts) {
  const src = read(path.join("scripts", f));
  ok(!/svgPhoto|photo\s*=\s*\([^)]*\)\s*=>[^;]*svg\+xml/.test(src),
    `${f} defines an SVG photo generator (solid-block regression)`);
  for (const m of src.matchAll(/photos:\s*\[([^\]]*)\]/g)) {
    ok(!/svg/i.test(m[1]), `${f} seeds an SVG as an impact photo: photos:[${m[1].slice(0, 60)}…]`);
  }
}

// 2 — The demo photo assets exist, are real JPEGs, and are all distinct files.
const assets = ["demo-hero-choir.jpg", "demo-impact-exhibition.jpg", "demo-impact-studio.jpg", "demo-campaign-chapel.jpg"];
const sizes = new Set();
for (const a of assets) {
  const p = path.join(root, "scripts", "demo-assets", a);
  ok(fs.existsSync(p), `scripts/demo-assets/${a} exists`);
  if (fs.existsSync(p)) {
    const buf = fs.readFileSync(p);
    ok(buf[0] === 0xff && buf[1] === 0xd8, `${a} is a real JPEG (not SVG/placeholder)`);
    ok(buf.length > 20000, `${a} is a real photograph, not a stub (${buf.length} bytes)`);
    sizes.add(buf.length);
  }
}
ok(sizes.size === assets.length, "all demo photos are distinct images");
ok(fs.existsSync(path.join(root, "scripts", "demo-assets", "README.md")), "provenance README.md present (license record)");

// 3 — seed-build45 impact updates use the committed real photos.
const b45 = read("scripts/seed-build45-portal-demo.js");
ok(b45.includes("demo-impact-exhibition.jpg"), "seed-build45 exhibition update uses the real photo");
ok(b45.includes("demo-impact-studio.jpg"), "seed-build45 studio update uses the real photo");

// 4 — seed-build54: the page hero widget and the campaign hero each carry
//     their OWN image, and neither echoes the theme banner asset.
const b54 = read("scripts/seed-build54-demo.js");
ok(b54.includes("demo-hero-choir.jpg"), "seed-build54 page hero uses its own real photo");
ok(b54.includes("demo-campaign-chapel.jpg"), "seed-build54 campaign hero uses its own real photo");
ok(!/heroPath|header_image_url \|\|/.test(b54), "seed-build54 no longer echoes the theme banner into widgets");

console.log(`\ndemo-content: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
