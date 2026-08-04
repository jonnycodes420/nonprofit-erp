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

// 6 — The off-brand "AI green" (Tailwind emerald-500 #10b981, + its mint
//     sibling #34d399) appears NOWHERE on the public front-door surfaces or in
//     the server-rendered email templates (FIX 2026-07-30). Sign-in survived
//     the BUILD-20/brand-glyph public-surface sweep; this closes it. The
//     convention: public auth pages use GOLD for the primary action + the page-
//     title underline (like the landing's "Start free" / onboarding CTA) and
//     FOREST-green for links/accents.
//     Scope note: this guard covers the PUBLIC/auth + email surfaces only. The
//     authenticated app still uses #10b981 as its documented "accent green"
//     (the ~1300-literal BUILD-12 backlog); migrating that is a separate,
//     deliberate pass — CLAUDE.md explicitly warns against a repo-wide sed on
//     the live app — so it is intentionally NOT scanned here.
const EMERALD = /#10b981|#34d399/i;
const publicSurfaces = [
  "client/src/pages/LoginPage.jsx",
  "client/src/pages/SignupPage.jsx",
  "client/src/pages/ForgotPasswordPage.jsx",
  "client/src/pages/ResetPasswordPage.jsx",
  "client/src/pages/InvitePage.jsx",
  "client/src/pages/publicTheme.js",
  "server.js", // password-reset / invite / manage-fundraiser email CTAs
];
for (const f of publicSurfaces) {
  ok(!EMERALD.test(read(f)),
    `${path.relative(".", f)}: no off-brand emerald (#10b981 / #34d399)`);
}

// 7 — Sign-in follows the brand convention: gold primary button + gold title
//     underline + forest-green "Sign up free" link.
const login = read("client/src/pages/LoginPage.jsx");
ok(/gold:\s*"#c9a84c"/.test(login), "sign-in: gold token = gold500 #c9a84c");
ok(/forest:\s*"#0d5c3a"/.test(login), "sign-in: forest token = greenDk #0d5c3a");
ok(/background:\s*loading\s*\?\s*T\.cream3\s*:\s*T\.gold/.test(login),
  "sign-in: Sign In button background is gold");
ok(/borderBottom:\s*`3px solid \$\{T\.gold\}`/.test(login),
  "sign-in: 'Welcome back' underline is gold");
ok(/color:\s*T\.forest[^]{0,40}Sign up free/.test(login),
  "sign-in: 'Sign up free' link is forest green");

// 8 — The public sign-in page carries NO demo credentials (it's the front door;
//     any demo shortcut is gated to non-production via import.meta.env.DEV).
ok(/import\.meta\.env\.DEV\s*&&[^]{0,400}admin@creoarts\.org/.test(login),
  "sign-in: demo credentials are DEV-gated (never in a production build)");

// 9 — No gradient fills on progress bars / thermometers / charts anywhere in the
//     app (BUILD-31 Part 5). The gold→terracotta fade on the Home goal bar was
//     the single most AI-template-looking element; bars now carry meaning by
//     LENGTH + a SOLID gold fill. Gradients were already banned on the landing;
//     this extends the ban app-wide. The `linear-gradient(90deg` (horizontal)
//     signature is exactly the progress-bar/thermometer fill pattern — forbidden
//     across every component. The gold-moment celebration sheen is the ONE
//     documented exception and uses `linear-gradient(100deg` (a moving highlight,
//     not a bar fill), so it is not matched here.
const componentsDir = path.join(root, "client/src/components");
const walkComponents = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walkComponents(p) : (/\.jsx?$/.test(d.name) ? [p] : []);
});
for (const file of walkComponents(componentsDir)) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  ok(!/linear-gradient\(90deg/i.test(src),
    `${rel}: no gradient progress-bar/thermometer fill (linear-gradient(90deg…) — use a solid gold fill, length carries the meaning`);
}
// The celebration sheen (the ONE allowed gradient bar effect) is still present.
const shared9 = read("client/src/components/shared.jsx");
ok(/linear-gradient\(100deg/i.test(shared9), "gold-moment celebration sheen (the documented exception) is intact");

console.log(`\nbrand-glyph: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
