// Onboarding brand grep-guard (FIX 2026-07-21 — kill the AI gradient + diamond).
// Pure Node, no deps, no DB. Run: node tests/onboarding-brand.test.js
//
// What it enforces: the 5-step onboarding flow (WelcomePage.jsx) is on the
// Steward brand system — cream / forest green / gold, the serif "Steward"
// wordmark, BUILD-12 tokens — with NO off-brand "AI" gradient, NO diamond/hexagon
// glyph, and NO off-palette blue/red/cool-grey. The ONE allowed gradient is the
// documented gold-moment celebration sheen (gold→light-gold→gold), never blue.

const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "client", "src", "pages", "WelcomePage.jsx");
const src = fs.readFileSync(file, "utf8");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };

// 1 — No off-brand "AI" gradient blue anywhere.
ok(!src.includes("#3b82f6"), "no blue #3b82f6 (the killed AI-gradient blue)");
ok(!src.includes("#2563eb"), "no blue #2563eb");
ok(!/linear-gradient\([^)]*#(3b82f6|2563eb|10b981)/i.test(src),
  "no linear-gradient FILL on the import CTA / progress bar (was blue→green)");

// 2 — The only gradient left is the on-brand gold-moment sheen (no blue in it).
const gradients = src.match(/linear-gradient\([^)]*\)/g) || [];
ok(gradients.every(g => !/#(3b82f6|2563eb)/i.test(g)),
  "every remaining linear-gradient is gold, none contain blue");

// 3 — Diamond / hexagon glyph removed; no <svg> logo at all (wordmark instead).
ok(!src.includes("M8 2L13 5v6"), "diamond/hexagon SVG path removed");
ok(!src.includes("<svg"), "no <svg> glyph in the onboarding flow");

// 4 — The serif 'Steward' wordmark is present and rendered in DM Serif Display.
ok(/DM Serif Display[\s\S]{0,120}>\s*\n?\s*Steward\s*\n?\s*<\/span>/.test(src) ||
   /Steward\s*<\/span>/.test(src),
  "serif 'Steward' wordmark rendered");
ok(/Wordmark/.test(src), "wordmark comment/section present (glyph replaced by word)");

// 5 — On palette: no off-palette red/pink error colors, no cool greys.
for (const hex of ["#fef2f2", "#fecaca", "#dc2626"]) {
  ok(!src.includes(hex), `no off-palette red/pink error hex ${hex} (errors ride terracotta)`);
}
for (const hex of ["#e5e7eb", "#f9f8f6", "#9ca3af", "#6b7280", "#a08434"]) {
  ok(!src.includes(hex), `no cool-grey / off-token hex ${hex}`);
}

// 6 — Tokenized: reads BUILD-12 tokens from shared, and the primary CTA is the
//     gold token (not a gradient, not raw hex).
ok(/import\s*\{\s*T\s*\}\s*from\s*"\.\.\/components\/shared"/.test(src),
  "imports the BUILD-12 T tokens from ../components/shared");
ok(/background:\s*disabled\s*\?\s*T\.bg3\s*:\s*gold/.test(src),
  "primary CTA background is the solid gold token (no gradient)");
ok(/const\s+gold\s*=\s*T\.gold500/.test(src), "gold constant maps to the T.gold500 token");

console.log(`\nonboarding-brand: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
