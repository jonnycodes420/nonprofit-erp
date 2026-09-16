// BUILD-86 C.1 — THE PALETTE CENSUS. Run: node tests/palette-census.test.js
//
// The rule: four colours reach a screen. Ink, white (with cream as its warm
// shade), ONE emerald action colour, and brass for emphasis. Warm grey for
// secondary text. Red exists only for a destructive confirm.
//
// WHAT THIS GUARD IS, HONESTLY. The brief asks for zero hex literals outside
// the token file. There are 1,404 of them across 49 files in client/src, and
// CLAUDE.md records that full migration as "a separate, deliberate,
// non-overnight pass (do not attempt as a risky repo-wide sed on the live
// app)". Doing it the night before a demo is exactly the risk the brief's own
// hard stop exists to prevent, so this guard does the honest thing instead:
//
//   · it RATCHETS. The count may go DOWN and never up. A build that adds a
//     literal fails; a build that removes ten lowers the ceiling for good.
//   · it holds the parts of the rule that ARE done to ZERO — one action
//     colour, no second green, no retired AI green, no bright library red.
//
// A ratchet is not a weaker rule than "zero". It is the same rule with a date
// on it, and it cannot be quietly lost.

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 500) : "")); }
};

// Public surfaces keep their own audited palettes and their own guards (the
// landing verifier measures its contrast against real composited pixels; the
// portal is WHITE-LABEL and renders the ORG's colours, not Steward's). The
// admin ops tool has its own documented `A` palette.
// The pivot backlog: hidden from the nav since 2026-07-12, code intact, and
// already a documented brand-allowlist exclude. They are not on a screen.
const DEPRECATED = new Set([
  "components/Events.jsx", "components/Board.jsx", "components/Volunteers.jsx",
  "components/Programs.jsx", "components/AnnualFund.jsx",
]);

const PUBLIC_OR_WHITELABEL = new Set([
  "pages/Landing.jsx", "pages/publicTheme.js", "pages/Donate.jsx", "pages/Portal.jsx",
  "pages/GivingDashboard.jsx", "pages/ManageFundraiser.jsx", "pages/JoinNetwork.jsx",
  "pages/AdminDashboard.jsx", "pages/PortalEditor.jsx", "components/PortalBanner.jsx",
  "components/ShareBlocks.jsx", "lib/portalTheme.js",
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); continue; }
    if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC = path.join(root, "client/src");
const files = walk(SRC).map(f => ({ rel: path.relative(SRC, f), text: fs.readFileSync(f, "utf8") }));
// COMMENTS ARE NOT A SCREEN. This file's own notes name the colours it bans,
// and a guard that cannot tell a comment from a style is a guard that forces
// you to stop writing down why.
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const f of files) f.code = stripComments(f.text);
const app = files.filter(f => !PUBLIC_OR_WHITELABEL.has(f.rel) && !DEPRECATED.has(f.rel));
const live = files.filter(f => !DEPRECATED.has(f.rel) && f.rel !== "pages/AdminDashboard.jsx");

const countIn = (list, re) => list.reduce((n, f) => n + (f.code.match(re) || []).length, 0);
const where = (list, re) => list.filter(f => re.test(f.code)).map(f => f.rel);

console.log("\n— the parts of the rule that are DONE, at zero —");

// ONE ACTION COLOUR. The retired Tailwind emerald and the old mid-green are
// gone from the authenticated app; all three green token NAMES point at
// emerald, so 358 call sites render one colour.
ok("the retired AI green (#10b981 / #34d399) is gone from the app",
   countIn(app, /#10b981|#34d399/gi) === 0, where(app, /#10b981|#34d399/i));
ok("the second green (#1a6b4a) is gone from the app",
   countIn(app, /#1a6b4a/gi) === 0, where(app, /#1a6b4a/i));

const shared = fs.readFileSync(path.join(SRC, "components/shared.jsx"), "utf8");
const tok = k => (new RegExp(`\\b${k}:\\s*"(#[0-9a-fA-F]{6})"`).exec(shared) || [])[1];
ok("green, greenMid and greenDk are ONE colour — emerald",
   [tok("green"), tok("greenMid"), tok("greenDk")].every(v => v === "#0d5c3a"),
   { green: tok("green"), greenMid: tok("greenMid"), greenDk: tok("greenDk") });
ok("emerald is the brief's emerald", tok("greenDk") === "#0d5c3a");
ok("brass is the brief's brass", tok("gold500") === "#c9a84c");
ok("ink and cream are the brief's", tok("ink") === "#0f1a12" && tok("bg") === "#f0ede6");

// NO BRIGHT LIBRARY RED. The terracotta family is the product's only red and
// is reserved; a Tailwind/Bootstrap red anywhere is the thing this forbids.
const BRIGHT_RED = /#(?:ef4444|dc2626|f87171|e53e3e|ff0000|d32f2f|c53030)\b/gi;
ok("no bright library red anywhere in the client",
   countIn(live, BRIGHT_RED) === 0, where(live, BRIGHT_RED));

// OVERDUE IS BRASS, NOT RED, on the screen she opens every morning.
const dash = fs.readFileSync(path.join(SRC, "components/Dashboard.jsx"), "utf8");
ok("the Thread queue's overdue band is brass",
   /BAND_STYLE=\{overdue:\{label:"Overdue",color:T\.gold700\}/.test(dash));
ok("…its overdue rows are brass, not terracotta",
   /t\.overdue\?T\.gold500:T\.greenDk/.test(dash) && /t\.overdue\?T\.gold700:T\.ink/.test(dash));
ok("…and the failing-gift rows are brass too",
   !/borderLeft:"3px solid "\+T\.terracotta/.test(dash), (dash.match(/T\.terracotta/g) || []).length);

console.log("\n— the ratchet —");

// THE COUNT MAY GO DOWN AND NEVER UP. Lower this number when you remove
// literals; raising it is the thing the guard exists to refuse.
const HEX_CEILING = 1325;         // MEASURED 2026-09-16, after the green collapse (was 1404)
const SAGE_CEILING = 104;         // #8fa896 — the hue the rule deletes; the next pass
const RGB_CEILING = 124;

const hex = countIn(files, /#[0-9a-fA-F]{6}\b/g);
const sage = countIn(files, /#8fa896/gi);
const rgb = countIn(files, /rgba?\(/g);
console.log(`  hex literals ${hex} (ceiling ${HEX_CEILING}) · sage ${sage} (${SAGE_CEILING}) · rgb() ${rgb} (${RGB_CEILING})`);

ok(`hex literals do not grow (${hex} ≤ ${HEX_CEILING})`, hex <= HEX_CEILING, hex);
ok(`sage does not grow (${sage} ≤ ${SAGE_CEILING})`, sage <= SAGE_CEILING, sage);
ok(`rgb()/rgba() does not grow (${rgb} ≤ ${RGB_CEILING})`, rgb <= RGB_CEILING, rgb);
// A ratchet that nobody tightens is a ceiling nobody notices. If the count has
// fallen well below the ceiling, say so loudly enough to be lowered.
if (hex < HEX_CEILING - 25) console.log(`  NOTE  hex is ${HEX_CEILING - hex} under the ceiling — lower HEX_CEILING to ${hex}.`);

console.log(`\npalette-census: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
