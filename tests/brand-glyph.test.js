// Brand-glyph grep-guard (FIX 2026-07-29 — retire the hexagon/diamond mark
// app-wide; the serif "Steward" wordmark, or a serif "S", is the only logo).
// Pure Node, no deps, no DB. Run: node tests/brand-glyph.test.js
//
// What it enforces:
//   • The hexagon/diamond LOGO SVG (path "M8 2L13 5v6…") appears NOWHERE in the
//     app, public assets, landing, or email/server-rendered templates. It was
//     the retired brand mark and had leaked onto signup, sign-in, pricing, the
//     legal pages, the app splash, the donate page, the reset/forgot pages, the
//     offline splash, and two server templates (reset email + unsubscribe page).
//   • The shared EmptyState ornament is NOT a diamond/logo-ish glyph (it's a
//     restrained on-palette rule now).
//   • The serif "Steward" wordmark is present on the key public surfaces.
//   • The killed blue "AI" gradient is gone from the invite page.
//
// This is the grep guard the FIX brief asked to commit: the hexagon/diamond
// asset has no remaining references in app, landing, or email templates.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + msg); } };
const read = p => fs.readFileSync(path.join(root, p), "utf8");

// The distinctive substring of the retired hexagon/diamond logo path.
const HEX = "M8 2L13 5v6";

// 1 — The hexagon logo path is gone from every tracked source surface.
function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(jsx?|html|svg)$/.test(e.name)) acc.push(full);
  }
  return acc;
}
const scanned = [
  ...walk(path.join(root, "client", "src"), []),
  ...walk(path.join(root, "client", "public"), []),
  path.join(root, "client", "index.html"),
  path.join(root, "server.js"),
];
const offenders = scanned.filter(f => fs.readFileSync(f, "utf8").includes(HEX));
ok(offenders.length === 0,
  "hexagon/diamond logo path absent everywhere — offenders: " +
  offenders.map(f => path.relative(root, f)).join(", "));

// 2 — EmptyState renders a restrained ornament, not a diamond glyph.
const shared = read("client/src/components/shared.jsx");
const emptyStateBlock = shared.slice(shared.indexOf("export function EmptyState"), shared.indexOf("export function EmptyState") + 700);
ok(!/[◇◈♦]/.test(emptyStateBlock), "EmptyState body carries no diamond glyph ornament");
ok(/background:\s*T\.gold500/.test(emptyStateBlock), "EmptyState ornament is an on-palette gold rule");
// And no call site still passes an equals-form diamond icon prop.
const callSiteDiamond = scanned.filter(f =>
  /\.jsx$/.test(f) && /icon="[◇◈♦]"/.test(fs.readFileSync(f, "utf8")));
ok(callSiteDiamond.length === 0,
  "no EmptyState call site still passes a diamond icon= prop — offenders: " +
  callSiteDiamond.map(f => path.relative(root, f)).join(", "));

// 3 — The serif wordmark is present on the key public surfaces.
for (const [file, label] of [
  ["client/src/pages/LoginPage.jsx", "sign-in"],
  ["client/src/pages/SignupPage.jsx", "signup"],
  ["client/src/pages/Pricing.jsx", "pricing"],
  ["client/src/pages/PrivacyPage.jsx", "privacy"],
  ["client/src/pages/TermsPage.jsx", "terms"],
]) {
  const src = read(file);
  ok(/DM Serif Display[^]{0,160}Steward/.test(src) || /Steward[^]{0,160}DM Serif Display/.test(src),
    `${label}: serif 'Steward' wordmark present`);
}

// 4 — The killed blue "AI" gradient is gone from the invite page.
const invite = read("client/src/pages/InvitePage.jsx");
ok(!/#3b82f6/.test(invite), "invite page: no leftover AI-gradient blue #3b82f6");
ok(!/linear-gradient\([^)]*#(3b82f6|2563eb)/i.test(invite), "invite page: no AI blue→green gradient");

// 5 — Dead Login.jsx (old 'Mission Suite' branding) is removed.
ok(!fs.existsSync(path.join(root, "client", "src", "Login.jsx")),
  "dead client/src/Login.jsx (stale off-brand mark) removed");

console.log(`\nbrand-glyph: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
