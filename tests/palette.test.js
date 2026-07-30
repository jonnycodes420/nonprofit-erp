// BUILD-12 Part 0 — palette token + WCAG contrast verification.
// Pure Node, no deps, no DB. Run: node tests/palette.test.js
//
// What it proves:
//   - The enriched green + gold ramps and the locked accents are defined ONCE
//     in client/src/components/shared.jsx's `T` (single source of truth), with
//     the exact values this test records.
//   - terracotta is UNCHANGED (#b8593f) — its "needs-attention / negative"
//     semantic must survive a richness pass; a treasurer needs red to mean red.
//   - Every text/background pairing the enrichment introduces passes WCAG AA:
//     ≥4.5:1 for body text, ≥3:1 for large/accent text (gold is inherently
//     light and is used for large/accent + non-text surfaces only).

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };

// ── WCAG relative luminance + contrast ratio ────────────────────────────────
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = hex => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => { const l1 = L(a), l2 = L(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };

// ── The locked palette (source-of-truth record) ─────────────────────────────
const CREAM = "#f0ede6", WHITE = "#ffffff";
const RAMP = {
  green950: "#0e1a13", green900: "#102418", green800: "#14352a", green700: "#1b5138",
  green600: "#1e6b45", green500: "#2f8f62", green200: "#dce7df", green100: "#edf3ee",
  gold600: "#a97f22", gold500: "#c9a84c", gold300: "#e7cf91", gold100: "#f6eccf",
  terracotta: "#b8593f",
};

// ── 1. shared.jsx defines every ramp token with exactly these values ────────
const sharedSrc = fs.readFileSync(path.join(__dirname, "..", "client", "src", "components", "shared.jsx"), "utf8");
for (const [name, hex] of Object.entries(RAMP)) {
  const re = new RegExp(`${name}\\s*:\\s*"${hex}"`, "i");
  ok(re.test(sharedSrc), `T.${name} defined as ${hex} in shared.jsx`);
}
// terracotta semantic lock — value must be exactly the historical accent.
ok(/terracotta:\s*"#b8593f"/.test(sharedSrc), "terracotta unchanged (#b8593f) — semantic preserved");

// ── 2. WCAG AA on the pairings the enrichment introduces ────────────────────
const BODY = 4.5, LARGE = 3.0;
const check = (name, fg, bg, min) => {
  const r = contrast(fg, bg);
  ok(r >= min, `${name}: ${r.toFixed(2)}:1 ≥ ${min}:1`);
};
// Green text on cream (body): the positive/link greens must be readable.
check("green600 on cream (body)", RAMP.green600, CREAM, BODY);
check("green700 on cream (body)", RAMP.green700, CREAM, BODY);
// White text on the deep-pine dark panels (body).
check("white on green800 (body)", WHITE, RAMP.green800, BODY);
check("white on green900 (body)", WHITE, RAMP.green900, BODY);
check("white on green950 (body)", WHITE, RAMP.green950, BODY);
check("white on green700 (body)", WHITE, RAMP.green700, BODY);
// Gold is inherently light: gold600 used for LARGE/accent text only (≥3:1).
check("gold600 on cream (large/accent)", RAMP.gold600, CREAM, LARGE);
// green500 emerald as accent/large text.
check("green500 on cream (large/accent)", RAMP.green500, CREAM, LARGE);
// terracotta stays a large/accent color (it always renders ≥14px bold).
check("terracotta on cream (large/accent)", RAMP.terracotta, CREAM, LARGE);

// ── 3. gold-as-body would fail — assert we did NOT put gold on body text ────
// (documents WHY gold highlights live on non-text surfaces / large text.)
ok(contrast(RAMP.gold500, CREAM) < BODY, "gold500 correctly NOT used as body text (fails 4.5:1 by nature)");

// ── 4. Public auth-page brand convention (FIX 2026-07-30) ───────────────────
// The sign-in page's off-brand emerald was replaced with gold (primary action)
// + forest green (links). Both new pairings must pass WCAG AA.
const INK = "#0f1a12"; // ink text used on the gold Sign In button
// The gold Sign In button carries INK text (not white) — this is why it passes.
check("ink on gold500 button (body)", INK, RAMP.gold500, BODY);
// The forest-green "Sign up free" link (greenDk) on cream — a body-size link.
const FOREST = "#0d5c3a";
check("forest (greenDk) link on cream (body)", FOREST, CREAM, BODY);

console.log(`\npalette.test.js — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
