// BUILD-20 Part 1 — no-emoji grep-guard.
// Pure Node, no deps, no DB. Run: node tests/no-emoji.test.js
//
// What it proves / enforces (the standing rule):
//   Steward reads serious and premium — NO emoji anywhere user-facing, ever.
//   This scans tracked product source + user-facing templates (the app UI, the
//   landing page, and email/receipt templates in server.js) and FAILS if any
//   color/pictographic emoji codepoint appears.
//
// What counts as "emoji" here (forbidden):
//   - Every Supplementary-Multilingual-Plane pictograph  U+1F000–U+1FAFF
//     (🎉 💳 🗑 📊 🔒 …), regional-indicator flags, keycap combiner.
//   - The handful of Basic-Plane symbols that DEFAULT to emoji (color)
//     presentation: ⚠ ⚡ ⭐ ⬇ ✅ ❌ ❤ ‼ ⁉ … and the U+FE0F emoji
//     variation-selector.
//
// What is DELIBERATELY ALLOWED (the design's monochrome icon set / typography):
//   - Geometric shapes  U+25A0–U+25FF (◈ ♦ ◫ ◉ ◑ ◇ ▤ ● …) — the nav/icon set.
//   - Arrows  U+2190–U+21FF, U+2794… (→ ← ↑ ↓ ↗ ↻ ⇆) — UI affordances.
//   - Text-default dingbats used as glyphs: ✓ ✕ ✗ ✎ ✦ ✉ and the ⚙ gear
//     (U+2699) — these render monochrome, read premium, and carry meaning.
// If you want a new icon, use one of these text-default glyphs or a plain word,
// never a color emoji. See CLAUDE.md "No emoji (BUILD-20)".

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };

const forbidden = (cp) => {
  const o = cp;
  if (o >= 0x1F000 && o <= 0x1FAFF) return true;   // SMP pictographs / emoticons / transport / symbols
  if (o >= 0x1F1E6 && o <= 0x1F1FF) return true;   // regional-indicator (flags)
  if (o === 0xFE0F || o === 0x20E3) return true;    // emoji variation-selector / keycap combiner
  // Basic-plane symbols whose DEFAULT presentation is emoji (color):
  return [
    0x26A0, 0x26A1, 0x2B50, 0x2B07, 0x2B06, 0x2705, 0x274C, 0x2764,
    0x2733, 0x2734, 0x2B55, 0x2611, 0x2714, 0x203C, 0x2049, 0x2757, 0x2753,
    0x1F004,
  ].includes(o);
};

// Scope: tracked product source + user-facing templates. NOT docs/*.md, NOT tests.
const repoRoot = path.join(__dirname, "..");
const tracked = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
const inScope = (f) => {
  if (!/\.(jsx?|tsx?|html|css)$/.test(f)) return false;
  if (f.startsWith("tests/")) return false;          // this guard + suites describe ranges numerically
  if (f.startsWith("node_modules/")) return false;
  if (f.startsWith("scripts/")) return false;         // internal tooling, not user-facing
  if (f.startsWith("client/src/") || f === "server.js" || f === "db.js" ||
      f === "auth.js" || f === "branding.js" || f === "index.html" || f === "client/index.html") return true;
  return false;
};
const files = tracked.filter(inScope);
ok(files.length > 20, `scanned a reasonable set of source files (${files.length})`);

const offenders = [];
for (const rel of files) {
  const abs = path.join(repoRoot, rel);
  let txt;
  try { txt = fs.readFileSync(abs, "utf8"); } catch { continue; }
  const lines = txt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (forbidden(ch.codePointAt(0))) {
        offenders.push(`${rel}:${i + 1}  U+${ch.codePointAt(0).toString(16).toUpperCase()}  ${lines[i].trim().slice(0, 80)}`);
        break;
      }
    }
  }
}

ok(offenders.length === 0, `no emoji in tracked product source (found ${offenders.length})`);
if (offenders.length) {
  console.error("\n  Emoji found — remove them (plain word or the monochrome icon set):");
  for (const o of offenders.slice(0, 60)) console.error("    " + o);
}

console.log(`\nno-emoji: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
