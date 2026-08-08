// BUILD-33 Part 4 — the HARD token allowlist. Every color literal in active
// client source must be a value from the T token set (shared.jsx), the public
// theme, or the explicit, documented EXTRAS list below. Anything else fails —
// brand drift stops being "Jonathan notices it in a screenshot" and becomes
// "the build fails."
//
// Pure source guard — no server needed. Run: node tests/brand-allowlist.test.js
//
// To add a color: add it to the T object in shared.jsx (preferred — that's the
// single source of truth) or, for a surface-specific one-off (a chart ramp
// stop, a public-page neutral), add it to EXTRAS *with a comment saying where
// and why*. Never inline a new raw color and ignore this test.

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra)?.slice(0, 500) : "")); }
}

const ROOT = path.join(__dirname, "..", "client");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

// ── 1) The token set — read live from shared.jsx's T object + publicTheme ──
const shared = read("src/components/shared.jsx");
const tObject = shared.match(/export const T = \{[\s\S]*?\n\};/);
ok("shared.jsx exposes the T token object", !!tObject);
const publicTheme = read("src/pages/publicTheme.js");
const ALLOWED = new Set();
for (const m of (tObject[0] + publicTheme).matchAll(/#[0-9a-fA-F]{6}/g)) ALLOWED.add(m[0].toLowerCase());

// ── 2) Documented EXTRAS — every entry has a reason. Keep this list SHORT. ──
const EXTRAS = [
  // Warm neutrals / sage one-offs inside the authenticated app — same cream/
  // pine family as the palette, used for hairlines and muted chrome:
  "#f3f0eb", "#c9beac", "#b7ad9b", "#a1b5a8", "#f6f4ee", "#faf9f6", "#c9c3b8",
  "#4a5e4f", "#c9c2b4", "#0a120c", "#3d5245", "#5a7566", "#e8f3ee", "#f6ece8",
  "#a9c3b2", "#faf5e6", "#e0dccf", "#5b6b60", "#faf6f3",
  // Public-surface extended neutrals (Landing/auth/legal/Pricing — the
  // art-directed BUILD-28/29 pages; all warm greys, sage, and gold tints):
  "#ddd9d0", "#3a3a3a", "#030712", "#e9e5dc", "#152420", "#cfe8dc", "#d6ebe0",
  "#f5f5f0", "#6b7c72", "#f8f6f0", "#e8e4da", "#0f0f0f", "#d9c48a", "#5a4d29",
  "#dfe8e2", "#e0a893", "#12241a", "#3d4a42", "#9ca896",
  // InvitePage's deliberate dark-grey theme (kept in the 2026-07-30 emerald
  // sweep — gold accents on Tailwind greys; documented, not drift):
  "#111827", "#1f2937", "#0d1117", "#374151", "#f3f4f6", "#6b7280", "#f9fafb",
  // Settings › Branding PRESET_ACCENTS — customer-choice org accent colors
  // (data an org picks for ITS brand, normalized on save — not Steward chrome):
  "#7c3a12", "#3f5c8a", "#6b3f8a", "#8a5a1f",
  // D-1 (BUILD-45): "Cream alt" hover wash on the Home "Needs your attention"
  // row link (GlobalStyles a.attn-row-main:hover) — a warm neutral in the cream
  // family, one surface, gives the row a clickable affordance:
  "#e8e4db",
];
for (const v of EXTRAS) ALLOWED.add(v.toLowerCase());

// ── 3) Library defaults that are BANNED outright (the drift this guard
// exists to stop) — they must appear nowhere in scanned source, and must
// never be smuggled back in via the EXTRAS list above.
const BANNED = [
  "#ef4444", "#dc2626", "#f87171", "#b91c1c",             // Tailwind red
  "#f59e0b", "#fbbf24", "#eab308", "#d97706",             // Tailwind amber
  "#3b82f6", "#2563eb", "#1d4ed8", "#60a5fa", "#0ea5e9",  // Tailwind blue/sky
  "#8b5cf6", "#7c3aed", "#6366f1", "#a855f7", "#c084fc",  // violet/indigo/purple
  "#ec4899", "#f472b6",                                    // pink
  "#34d399", "#6ee7b7",                                    // the banned mint/emerald siblings
];
ok("EXTRAS never smuggles a banned library color", BANNED.every(v => !EXTRAS.includes(v)));

// ── 4) Scan scope ──
// Excluded, documented:
//   pages/AdminDashboard.jsx — super-admin ops tool with its own `A` palette
//   components/{Events,Board,Volunteers,Programs,AnnualFund}.jsx — hidden/
//     deprecated surfaces (pivot backlog, not in any nav; AnnualFund and
//     Programs are not even imported)
const EXCLUDE = new Set([
  "pages/AdminDashboard.jsx",
  "components/Events.jsx", "components/Board.jsx", "components/Volunteers.jsx",
  "components/Programs.jsx", "components/AnnualFund.jsx",
]);
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(path.join(ROOT, "src", dir))) {
    const rel = dir ? dir + "/" + f : f;
    const full = path.join(ROOT, "src", rel);
    if (fs.statSync(full).isDirectory()) walk(rel);
    else if (/\.(jsx|js|css)$/.test(f) && !EXCLUDE.has(rel)) files.push(rel);
  }
})("");

// ── 5) The allowlist check ──
const violations = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, "src", rel), "utf8");
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}(?![0-9a-fA-F])/g)) {
      let v = m[0].toLowerCase();
      if (v.length === 4) v = "#" + [...v.slice(1)].map(c => c + c).join("");
      if (!ALLOWED.has(v)) violations.push(`${rel}:${i + 1} ${v}`);
    }
  });
}
ok("every color literal in active client source is an allowlisted token (0 violations)", violations.length === 0, violations.slice(0, 25));

// index.html carries only the documented body bg + brand ink
{
  const html = read("index.html");
  const bad = [...html.matchAll(/#[0-9a-fA-F]{6}/g)].map(m => m[0].toLowerCase()).filter(v => !ALLOWED.has(v) && v !== "#0f1a12");
  ok("index.html inline colors are allowlisted", bad.length === 0, bad);
}

// ── 6) Banned library colors appear NOWHERE (belt over the allowlist) ──
{
  const hits = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, "src", rel), "utf8").toLowerCase();
    for (const b of BANNED) if (src.includes(b)) hits.push(rel + " " + b);
  }
  ok("no banned library color anywhere in active source", hits.length === 0, hits);
}

// ── 7) The T object itself carries no off-palette legacy tokens ──
ok("legacy off-palette tokens (red/amber/blue/greenPale) are gone from T",
  !/\bred:\s*"#c0392b"/.test(tObject[0]) && !/\bamber:/.test(tObject[0]) && !/\bblue:/.test(tObject[0]) && !/greenPale/.test(tObject[0]));
ok("T defines the BUILD-33 ramp stops (sage, green650, terracotta ramp, gold700/gold50)",
  ["sage400", "sage600", "green650", "terra700", "terra200", "terra100", "gold700", "gold50"].every(k => tObject[0].includes(k)));

// ── 8) BUILD-33 surface guards ──
// Grants (Part 2): on-palette columns, no colored top borders, honest overdue.
const grants = read("src/components/Grants.jsx");
ok("Grants kanban columns reference T tokens only", /id:"prospecting", label:"Prospecting",  color:T\.green500/.test(grants));
ok("Grants has NO colored top borders on stat cards", !grants.includes("borderTop:`3px solid"));
ok("Grants has NO colored left border bars on cards/columns", !grants.includes("borderLeft:`3px solid"));
ok("Grants overdue is honest — only actionable statuses carry deadline urgency",
  grants.includes("GRANT_ACTIONABLE") && grants.includes("const deadlineMeta = g => {") && grants.includes("!GRANT_ACTIONABLE.has(g.status)) return null"));
ok("Grants keeps a summary strip above the board/list", grants.includes("grants-summary-strip"));
ok("Grants keeps Kanban/List toggle + drag-and-drop", grants.includes('[["kanban","Kanban"],["list","List"]]') && grants.includes("onDragStart"));

// Donors (Part 3): consolidated action row — one menu, every path reachable.
const donors = read("src/components/Donors.jsx");
const menuBlock = donors.slice(donors.indexOf("Import &amp; tools"), donors.indexOf("Import &amp; tools") + 2600);
ok("Donors has ONE 'Import & tools' menu", donors.includes("Import &amp; tools"));
ok("menu reaches Import + History (recommended default)", menuBlock.includes("setShowCombinedImport(true)") && menuBlock.includes('badge:"Recommended"'));
ok("menu reaches donor-only import", menuBlock.includes("setShowImport(true)"));
ok("menu reaches giving-history import", menuBlock.includes("setShowGiftImport(true)"));
ok("menu reaches merge duplicates", menuBlock.includes("setShowMerge(true)"));
ok("the four sibling toolbar buttons are gone", !donors.includes("↑ Giving History</button>") && !donors.includes("⇆ Merge duplicates</button>"));
ok("+ Add is the gold primary action", /setShowAdd\(!showAdd\)[^\n]*background:T\.gold500/.test(donors));

// Communications (Part 4 known offenders): conventions applied.
const comms = read("src/components/Communications.jsx");
ok("Communications primary buttons are gold with ink text", comms.includes('primary: { background: T.gold500, border: "none", borderRadius: 8, padding: "9px 18px", color: T.ink'));
ok("Communications destructive buttons are quiet terracotta outlines", comms.includes('danger:  { background: "transparent", border: "1px solid " + T.terracotta'));
ok("no giant-letter template thumbnails", !comms.includes("{t.name[0]}"));
ok("template thumbnails are serif type-samples with a gold rule", comms.includes("'DM Serif Display',serif\", fontSize: 19") && comms.includes("background: T.gold500, borderRadius: 2"));
ok("sequence rows are cream cards, not near-black panels", comms.includes('<div key={seq.id} style={{ background: T.white') && !comms.includes('background: "#0f1a12", borderRadius: 12, border: "1px solid #1a2e1f"'));

// shared.jsx: the status/tier pill sets are on-palette by construction.
ok("SC status colors reference T tokens", /export const SC = \{ major:T\.greenDk/.test(shared));
ok("TIER_COLOR references T tokens", /export const TIER_COLOR = \{Micro:T\.ink3/.test(shared));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
