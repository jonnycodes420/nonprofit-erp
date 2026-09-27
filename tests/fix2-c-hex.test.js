// FIX-2 C — ZERO HEX LITERALS OUTSIDE THE TOKENS (claude/FIX-2.md Part C, Tests).
//
// The palette census (tests/palette-census.test.js) has RATCHETED the hex
// count down since BUILD-86: 1,404 → 1,149. This suite is the ratchet's end.
// A colour is written ONCE, as a token, and every screen names the token.
//
//   · THE AUTHENTICATED APP (everything in client/src that is not a public or
//     white-label surface): a hex literal may appear ONLY inside shared.jsx's
//     `export const T = { … }`. Every style, every CSS string in GlobalStyles,
//     every SVG fill reads T.
//   · THE PUBLIC AND WHITE-LABEL SURFACES (the landing, auth pages, the donor
//     portal and its editor, the giving pages, the ops console, the entry
//     splash): these are separate bundles on purpose — the landing is the
//     eager chunk and may not import shared.jsx, the portal renders the ORG's
//     theme, not Steward's — so each keeps its own named palette. A hex
//     literal there is legal only as a NAME: the whole value of a `const X =`
//     or of a property in a top-level palette object. Never inline in a style.
//
// The scan reads the AST (@babel/parser), so a comment is never a screen and a
// string is always a string. #rgb, #rgba, #rrggbb and #rrggbbaa all count.
//
// PER-FILE EXCEPTIONS, EMPTIED AT MERGE. Four files belong to other FIX-2
// workstreams (A: Dashboards.jsx · B: Reports.jsx, ReportBuilder.jsx ·
// D: Agent.jsx) and are not edited on this branch. Each holds a ceiling at
// what it has today; the lead empties OWNED_ELSEWHERE when A, B and D land,
// and from then on those files obey the app rule like every other.

const fs = require("fs");
const path = require("path");
const { ok, summary } = require("./helpers");
const root = path.join(__dirname, "..");
const SRC = path.join(root, "client/src");
const { parse } = require(path.join(root, "client/node_modules/@babel/parser"));

// EMPTY THIS AT MERGE (see the header). file → the most hex it may hold.
const OWNED_ELSEWHERE = {};   // emptied at the FIX-2 merge: A, B and D landed with zero hex

// Public and white-label surfaces: their own palettes, named once.
const PUBLIC = new Set([
  "main.jsx",                                      // the entry splash, before the app chunk loads
  "components/ProductMark.jsx",                    // no dependencies, used by the eager landing
  "pages/Landing.jsx", "pages/publicTheme.js",     // the eager entry chunk + the public pages' palette
  "pages/LoginPage.jsx", "pages/InvitePage.jsx", "pages/ForgotPasswordPage.jsx",
  "pages/ResetPasswordPage.jsx", "pages/Pricing.jsx", "pages/PrivacyPage.jsx",
  "pages/TermsPage.jsx", "pages/Invitation.jsx",   // public/auth pages
  "pages/Donate.jsx", "pages/ManageFundraiser.jsx", "pages/JoinNetwork.jsx",
  "pages/EmbeddedForm.jsx", "pages/GiveSteps.jsx", // giving pages
  "pages/Portal.jsx", "pages/PortalEditor.jsx", "pages/GivingDashboard.jsx",
  "components/PortalWidgets.jsx", "components/PortalBanner.jsx", "components/ShareBlocks.jsx",
  "lib/portalTheme.js",                            // the white-label donor portal
  "pages/AdminDashboard.jsx",                      // the super-admin ops tool, its own `A`
]);

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])/g;
const WHOLE = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})$/;

function walkDir(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (/\.(jsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Every string-ish node with its parent chain.
function literals(ast) {
  const out = [];
  (function visit(node, parents) {
    if (!node || typeof node.type !== "string") return;
    const kids = parents.concat(node);
    if (node.type === "StringLiteral") out.push({ node, text: node.value, parents });
    else if (node.type === "TemplateElement") out.push({ node, text: node.value.raw, parents });
    else if (node.type === "JSXText") out.push({ node, text: node.value, parents });
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === "string" && visit(c, kids));
      else if (v && typeof v.type === "string") visit(v, kids);
    }
  })(ast.program, []);
  return out;
}

// A literal that IS a token definition: the whole value of a `const X = "#…"`,
// or of a property in an object that is itself a top-level const's value.
function isDefinition(lit) {
  if (lit.node.type !== "StringLiteral" || !WHOLE.test(lit.text)) return false;
  const p = lit.parents[lit.parents.length - 1];
  if (p.type === "VariableDeclarator" && p.init === lit.node) return true;
  if (p.type === "ObjectProperty" && p.value === lit.node) {
    const obj = lit.parents[lit.parents.length - 2];
    const decl = lit.parents[lit.parents.length - 3];
    const declList = lit.parents[lit.parents.length - 4];
    const top = lit.parents[lit.parents.length - 5];
    return obj && obj.type === "ObjectExpression" && decl && decl.type === "VariableDeclarator" && decl.init === obj
      && declList && declList.type === "VariableDeclaration"
      && top && (top.type === "Program" || (top.type === "ExportNamedDeclaration" && lit.parents[lit.parents.length - 6]?.type === "Program"));
  }
  return false;
}

// shared.jsx's T: the one token block of the authenticated app.
function inTokenBlock(rel, lit) {
  if (rel !== "components/shared.jsx") return false;
  return lit.parents.some(n => n.type === "VariableDeclarator" && n.id && n.id.name === "T"
    && lit.parents[lit.parents.indexOf(n) - 2]?.type === "ExportNamedDeclaration");
}

const violations = [], perFile = {};
let scanned = 0, tokenDefs = 0;
for (const abs of walkDir(SRC)) {
  const rel = path.relative(SRC, abs).split(path.sep).join("/");
  const code = fs.readFileSync(abs, "utf8");
  if (/\.css$/.test(rel)) {                       // no CSS files today; if one arrives, its :root holds the tokens
    const body = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/:root\s*\{[^}]*\}/g, "");
    for (const m of body.matchAll(HEX)) violations.push(`${rel} ${m[0]}`);
    continue;
  }
  let ast;
  try { ast = parse(code, { sourceType: "module", plugins: ["jsx"], errorRecovery: true }); }
  catch (e) { violations.push(`${rel} did not parse: ${e.message}`); continue; }
  scanned++;
  for (const lit of literals(ast)) {
    const hits = lit.text.match(HEX);
    if (!hits) continue;
    if (inTokenBlock(rel, lit)) { tokenDefs += hits.length; continue; }
    if (PUBLIC.has(rel) && isDefinition(lit)) { tokenDefs += hits.length; continue; }
    for (const h of hits) {
      perFile[rel] = (perFile[rel] || 0) + 1;
      if (!(rel in OWNED_ELSEWHERE)) violations.push(`${rel}:${lit.node.loc.start.line} ${h}  (${JSON.stringify(lit.text.slice(0, 60))})`);
    }
  }
}

console.log(`\n— zero hex outside the tokens — (${scanned} files, ${tokenDefs} literals inside token definitions)`);
ok("every file in client/src parsed", scanned >= 90, scanned);
ok("zero hex literals outside the token definitions", violations.length === 0,
  { count: violations.length, first: violations.slice(0, 20) });
for (const [rel, ceiling] of Object.entries(OWNED_ELSEWHERE)) {
  const n = perFile[rel] || 0;
  ok(`${rel} holds no more than its ${ceiling} (owned by another workstream; emptied at merge)`, n <= ceiling, n);
}
ok("the token definitions exist (shared.jsx's T is read, not skipped)", tokenDefs > 50, tokenDefs);
if (violations.length) {
  const by = {};
  for (const v of violations) { const f = v.split(/[: ]/)[0]; by[f] = (by[f] || 0) + 1; }
  console.log("  by file:", JSON.stringify(by));
}
summary();
