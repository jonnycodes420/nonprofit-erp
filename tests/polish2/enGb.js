// POLISH-2 Part 1: American English, enforced.
//
// scanEnGb(rootDir) returns every British spelling that a person can read:
// a word like "organisation" or "cheque" inside a string literal, a template
// literal or JSX text that holds a space (a sentence or a label). A string
// with no space is a key, an enum or a stored value ('cheque' as a payment
// method), and stays. Comments and regex literals are never read, because
// the files are parsed, not grepped. SQL text is skipped (it names stored
// values, not words on a screen).
//
// It fails when: someone writes "Paid by cheque" or "your organisation's
// months" in a screen, an email, a PDF, a help article or the demo seed.
"use strict";
const fs = require("fs");
const path = require("path");

function loadParser(rootDir) {
  for (const base of [path.join(rootDir, "client"), rootDir, __dirname]) {
    try { return require(require.resolve("@babel/parser", { paths: [base] })); } catch (_) { /* next */ }
  }
  throw new Error("polish2/enGb: @babel/parser not found (npm ci in client/)");
}

// The British spellings, each with the forms it takes. "cancelled" is fine.
const STEMS = [
  "cheque", "organisation", "programme", "colour", "favour", "licence", "catalogue",
  "behaviour", "centre", "honour", "recognis", "analys", "summaris", "apologis",
  "organis", "realis", "judgement", "instalment", "enrol", "fulfil",
];
// One regex per word family. -ise verbs need an ending so "analysis" and
// "organism" don't match; "enrol"/"fulfil" must not match "enroll"/"fulfill".
const WORDS = new RegExp(
  "\\b(" + [
    "cheques?",
    "organisations?(?:'s)?",
    "programmes?",
    "colours?|coloured|colouring",
    "favours?|favoured|favourite|favourites",
    "licences?",
    "catalogues?",
    "behaviours?",
    "centres?|centred",
    "honours?|honoured|honouring",
    "recognis(?:e|es|ed|ing)",
    "analys(?:e|es|ed|ing)",
    "summaris(?:e|es|ed|ing)",
    "apologis(?:e|es|ed|ing)",
    "organis(?:e|es|ed|ing|er|ers)",
    "realis(?:e|es|ed|ing)",
    "judgements?",
    "instalments?",
    "enrol|enrols|enrolment|enrolments",
    "fulfil|fulfils|fulfilment",
  ].join("|") + ")\\b", "i");

// The places a person reads.
const ROOTS = ["client/src", "routes", "shared", "server.js", "scripts/seed-demo.js",
  // Email and PDF builders that live at the root.
  "emailCompose.js", "readout.js", "grantDocs.js", "depositsFile.js", "memberCard.js",
  "why.js", "appealWhy.js", "prospectBrief.js", "timelineLine.js", "groups.js",
  "callsToMake.js", "engagement.js", "figureSources.js", "oldReports.js", "importThanks.js"];

// Files that READ someone else's file: their headers and values are inputs
// in whatever spelling the export used, so they keep the British forms.
const PARSER_FILES = new Set([
  "shared/importShape.js",        // header + value aliases from donor exports
  "shared/importMoney.js",        // payment-method words in imported rows
  "shared/methodNormalize.js",    // maps "Cheque" in a file to the 'check' method
  "shared/historyImport.js",      // activity-type aliases from history exports
  "shared/grantImport.js",        // grant export header aliases
  "shared/membershipImport.js",   // membership export header aliases
  "shared/volunteerImport.js",    // volunteer export header aliases
  "shared/volunteerHours.js",     // hours export header aliases
  "shared/migrationPresets.js",   // vendor export column names
  "shared/npspPreset.js",         // Salesforce export column names
  "shared/oldReportsParse.js",    // old report headers
  "shared/askCatalog.js",         // the question parser accepts either spelling
]);

// Keys whose array lists how other systems spell a header or a value.
const ALIAS_KEYS = /^(labels|aliases|signals|headers|synonyms|matches|keywords)$/;

const SQL = /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|WHERE|CREATE TABLE|ALTER TABLE)\b/;

function walk(abs, out) {
  let st;
  try { st = fs.statSync(abs); } catch (_) { return; }
  if (st.isDirectory()) {
    const base = path.basename(abs);
    if (base === "node_modules" || base === "dist" || base.startsWith(".")) return;
    for (const f of fs.readdirSync(abs)) walk(path.join(abs, f), out);
  } else if (/\.(jsx?|mjs|cjs)$/.test(abs)) out.push(abs);
}

function scanEnGb(rootDir) {
  const parser = loadParser(rootDir);
  const files = [];
  for (const r of ROOTS) walk(path.join(rootDir, r), files);
  const hits = [];
  for (const abs of files) {
    const rel = path.relative(rootDir, abs).split(path.sep).join("/");
    if (PARSER_FILES.has(rel)) continue;
    const src = fs.readFileSync(abs, "utf8");
    let ast;
    try {
      ast = parser.parse(src, { sourceType: "unambiguous", errorRecovery: true,
        plugins: ["jsx", "classProperties", "optionalChaining", "topLevelAwait"] });
    } catch (e) {
      hits.push({ file: rel, line: 0, word: "(unparsed)", text: e.message });
      continue;
    }
    // `alias` is true under an array that lists how SOMEONE ELSE'S file
    // spells a header or a value ({ labels: ["organisation name", ...] }):
    // those are inputs to a parser, not words on a screen.
    const visit = (node, alias) => {
      if (!node || typeof node.type !== "string") return;
      let text = null, ranges = null;
      if (node.type === "StringLiteral" || node.type === "JSXText") { text = node.value; ranges = [[node.start, node.end]]; }
      else if (node.type === "TemplateLiteral") {
        text = node.quasis.map((q) => q.value.cooked || q.value.raw).join(" ${} ");
        ranges = node.quasis.map((q) => [q.start, q.end]);
      }
      if (text != null && !alias) {
        // A word in quotes inside the text ('organisation') is a stored value.
        const m = WORDS.exec(text.replace(/'[A-Za-z_]+'/g, ""));
        const human = node.type === "JSXText" || /\s/.test(text.trim());
        if (m && human && !SQL.test(text)) {
          hits.push({ file: rel, line: node.loc ? node.loc.start.line : 0, word: m[1], text: text.trim().slice(0, 160), ranges });
        }
      }
      if (node.type === "StringLiteral" || node.type === "JSXText") return;
      for (const k of Object.keys(node)) {
        if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
        const v = node[k];
        const childAlias = alias || (node.type === "ObjectProperty" && k === "value" && node.key &&
          ALIAS_KEYS.test(node.key.name || node.key.value || ""));
        if (Array.isArray(v)) v.forEach((c) => c && typeof c === "object" && visit(c, childAlias));
        else if (v && typeof v === "object" && typeof v.type === "string") visit(v, childAlias);
      }
    };
    visit(ast.program, false);
  }
  return hits;
}

module.exports = { scanEnGb, PARSER_FILES };

if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, "..", "..");
  const hits = scanEnGb(root);
  for (const h of hits) console.log(`${h.file}:${h.line}  [${h.word}]  ${h.text}`);
  console.log(`${hits.length} British spelling(s) a person can read`);
}
