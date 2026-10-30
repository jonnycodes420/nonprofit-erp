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

// ── JOURNEYS-3 · NO EM DASH IN CLIENT COPY ─────────────────────────────────
// The house voice uses commas and full stops (docs/MESSAGING.md). Every string
// a screen can show in client/src (string literals, template text, JSX text,
// with escapes and &mdash; decoded) is read by a real parser, so a comment may
// say what it likes and copy may not. It fails if the parser is missing: a
// guard that cannot run is not a pass.
{
  let parse = null;
  try { ({ parse } = require(path.join(repoRoot, "client", "node_modules", "@babel", "parser"))); } catch { /* reported below */ }
  ok(!!parse, "the parser for the em dash guard is installed (npm ci --prefix client)");
  const dashes = [], notSet = [];
  const scanCopy = (rel, src) => {
    const ast = parse(src, { sourceType: "module", plugins: ["jsx"], errorRecovery: true });
    (function visit(n) {
      if (!n || typeof n.type !== "string") return;
      let text = null;
      if (n.type === "StringLiteral" || n.type === "JSXText") text = n.value;
      else if (n.type === "TemplateElement") text = n.value.cooked != null ? n.value.cooked : n.value.raw;
      if (text && text.includes("\u2014")) dashes.push(`${rel}:${n.loc.start.line}  ${text.trim().slice(0, 80)}`);
      // JOURNEYS-3 follow-up: the dash codemod turned SEPARATORS (" \u2014 " between two values)
      // into the words "Not set" ("charge of $199 Not set"). "Not set" is only ever a whole
      // placeholder: alone in its literal (JSX line breaks around it are fine) or the select
      // option "Not set yet". A space or tab beside it means it sits between other copy.
      if (text && /Not set/.test(text) && text.trim() !== "Not set yet" && /[ \t]Not set|Not set[ \t]/.test(text)) {
        notSet.push(`${rel}:${n.loc.start.line}  ${JSON.stringify(text.slice(0, 80))}`);
      }
      for (const k of Object.keys(n)) {
        if (k === "loc" || /Comments$/.test(k)) continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === "object" && v.type) visit(v);
      }
    })(ast.program);
  };
  if (parse) {
    const copyFiles = tracked.filter(f => f.startsWith("client/src/") && /\.(jsx?|mjs)$/.test(f));
    for (const rel of copyFiles) {
      const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      if (/\u2014|\\u2014|&mdash;|Not set/.test(src)) scanCopy(rel, src);
    }
    ok(dashes.length === 0, `no em dash in client copy (found ${dashes.length})`);
    ok(notSet.length === 0, `"Not set" is only a whole placeholder, never a separator (found ${notSet.length})`);
    for (const d of notSet.slice(0, 40)) console.error("    " + d);
    for (const d of dashes.slice(0, 40)) console.error("    " + d);
    // Proven able to fail: a planted em dash in copy is found, one in a comment is not.
    const before = dashes.length;
    scanCopy("planted.jsx", 'const a = <p>Saved \u2014 thank you</p>; // a comment \u2014 is fine\nconst b = "x &mdash;";\n');
    scanCopy("planted2.jsx", 'const c = `ok ${1} \\u2014 done`;');
    ok(dashes.length - before === 2, "the guard catches a planted em dash in JSX text and in a template, not in a comment",
       dashes.slice(before));
    dashes.length = before;
    const nsBefore = notSet.length;
    scanCopy("planted3.jsx", 'const d = <span>{a} Not set {b}</span>; const e = `x ${1} Not set ${2}`; const f = <i>Not set</i>; const g = "Not set";');
    ok(notSet.length - nsBefore === 2, "the separator guard catches a planted \"Not set\" between two values, not the bare placeholder",
       notSet.slice(nsBefore));
    notSet.length = nsBefore;
  }
}

// ── FIX-60 · NO REAL CUSTOMER NAMES IN THE REPO ───────────────────────────
// Earlier briefs quoted real people from a customer's file (Justin's Place);
// they were copied into tests, fixtures, comments and docs. Every example name
// is fake. This scans EVERY tracked text file, and the cells of every tracked
// spreadsheet, for those names. The guard holds no name: each is a salted
// sha256 prefix, so it cannot itself put the names back.
//   RARE  a surname nobody else uses here: any whole word, any case.
//   PAIR  two words together ("First Last", a two-word note).
//   CTX   a surname that is also an ordinary word or a common name: only in a
//         name's place, after a capitalised word ("Jo X", "Jo, Sam X",
//         "Jo and Sam X") or before Household/Family. One of them is also a
//         heading word, so it counts only after a known first name
//         (shared/givenNames.js).
// What makes it fail: one of those names typed into any tracked text file or
// spreadsheet cell, in that shape. Proven below by planting one of each.
{
  const crypto = require("crypto");
  const memo = new Map();
  const H = s => { let h = memo.get(s); if (h === undefined) { h = crypto.createHash("sha256").update("fix60:" + s).digest("hex").slice(0, 16); memo.set(s, h); } return h; };
  const RARE = new Set("57d8f393c1a02c9b a0a2136c234bf79e b0ee1c88b0f0629c 4452e4e25dc8d280 a1daa884c9512772 3b1d75dfa19da832 bb75d1823e2519c1 ca10d2f3401eb6a5 f6cf6bf2c02c4845 13f03c6c37657045".split(" "));
  const PAIR = new Set("2668151324be0362 78395dc0bae4f1fd".split(" "));
  const PAIR_LAST = new Set("668009e04346a54c 633778894b40f385".split(" "));   // the second word of each pair
  const CTX = new Set("f5191cacbb797c51 f290a447575d91c3 ffbf30eb9267a821 4fd6996674eceb9a c54df3e82adc8139".split(" "));
  const CTX_GIVEN_ONLY = new Set(["e626746a3ebe7165"]);
  const givenSrc = fs.readFileSync(path.join(repoRoot, "shared", "givenNames.js"), "utf8");
  const GIVEN = new Set(((givenSrc.match(/const LIST = `([\s\S]*?)`/) || [])[1] || "").split(/\s+/).filter(Boolean));
  ok(GIVEN.size > 200, "the real-name guard read the first-name list");
  const TITLE = /^[A-Z][a-z]+$/;
  const scanText = (where, text) => {
    const hits = [];
    const lines = text.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (line.length > 20000) continue;   // a base64 blob or a minified line is not prose
      const toks = [...line.matchAll(/[A-Za-z]+/g)];
      for (let i = 0; i < toks.length; i++) {
        const w = toks[i][0];
        if (w.length < 3 || w.length > 12) continue;
        const prev = i > 0 ? toks[i - 1] : null;
        const sep = prev ? line.slice(prev.index + prev[0].length, toks[i].index) : "";
        const next = toks[i + 1] ? toks[i + 1][0] : "";
        const nextSep = toks[i + 1] ? line.slice(toks[i].index + w.length, toks[i + 1].index) : "";
        const lw = w.toLowerCase();
        let hit = RARE.has(H(lw));
        if (!hit && prev && sep === " " && PAIR_LAST.has(H(lw)) && PAIR.has(H(prev[0].toLowerCase() + " " + lw))) hit = true;
        if (!hit && TITLE.test(w)) {
          const h = H(w);
          const named = prev && TITLE.test(prev[0]) && /^(?:,? | (?:and|or|&) )$/.test(sep);
          if (CTX.has(h) && (named || (nextSep === " " && /^(Household|Family)$/.test(next)))) hit = true;
          if (CTX_GIVEN_ONLY.has(h) && named && GIVEN.has(prev[0].toLowerCase())) hit = true;
        }
        if (hit) { hits.push(`${where}:${li + 1}  ${line.trim().slice(0, 100)}`); break; }
      }
    }
    return hits;
  };
  let XLSX = null;
  try { XLSX = require(path.join(repoRoot, "client", "node_modules", "xlsx")); } catch { /* reported below */ }
  ok(!!XLSX, "the spreadsheet reader for the real-name guard is installed (npm ci --prefix client)");
  const found = [];
  let scanned = 0, sheets = 0;
  for (const rel of tracked) {
    if (rel === "tests/no-emoji.test.js" || /\.(png|jpe?g|webp|gif|ico|pdf|webm|mp4|woff2?|ttf)$/i.test(rel)) continue;
    let buf;
    try { buf = fs.readFileSync(path.join(repoRoot, rel)); } catch { continue; }
    if (/\.(xlsx|xlsm|xls|ods)$/i.test(rel)) {
      if (!XLSX) continue;
      const cells = [];
      if (/\.(xlsx|xlsm)$/i.test(rel)) {
        // every text run in every part (shared strings, inline strings, comments,
        // properties) and every sheet name, straight from the zip: a full parse
        // of the 25k-row fixture alone takes seconds
        const zip = XLSX.CFB.read(buf, { type: "buffer" });
        const ent = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
        for (const p of zip.FullPaths.filter(x => /\.xml$/i.test(x))) {
          const xml = Buffer.from(XLSX.CFB.find(zip, p).content).toString("utf8");
          for (const m of xml.matchAll(/<(?:[a-z]+:)?(?:t|v|title|subject|creator|description|keywords)(?:\s[^>]*)?>(?=[^<]*[A-Za-z])([^<]+)</g)) cells.push(ent(m[1]));
          for (const m of xml.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)) cells.push(ent(m[1]));
        }
      } else {
        const wb = XLSX.read(buf, { type: "buffer" });
        for (const sn of wb.SheetNames) {
          cells.push(sn);
          const ws = wb.Sheets[sn];
          for (const k of Object.keys(ws)) if (k[0] !== "!" && ws[k].v != null) cells.push(String(ws[k].v));
        }
      }
      found.push(...scanText(rel, cells.join("\n")));
      sheets++;
      continue;
    }
    if (buf.length > 30 * 1024 * 1024 || buf.subarray(0, 8000).includes(0)) continue;   // binary: images, PDFs, video
    found.push(...scanText(rel, buf.toString("utf8")));
    scanned++;
  }
  ok(scanned > 1000 && (!XLSX || sheets > 10), `the real-name guard scanned the tracked files (${scanned} text, ${sheets} spreadsheets)`);
  ok(found.length === 0, `no real customer name in any tracked file (found ${found.length})`);
  for (const f of found.slice(0, 40)) console.error("    " + f);
  // Proven able to fail: each tier catches its planted name; ordinary words pass.
  const dec = s => Buffer.from(s, "base64").toString("utf8");
  const planted = ["Q2FyeSBIaW50eg==", "KipCcnlhbiBNYXk=", "MSBNZWRpY2FsIEdsdXRlbg==", "QWxsaWUgQmFybmV0dA==", "QmFybmV0dCBIb3VzZWhvbGQ=", "QmlsbCBDb3VudHM="].map(dec);
  const caught = planted.filter(p => scanText("planted", p).length === 1);
  ok(caught.length === planted.length, `the real-name guard catches every planted name (${caught.length} of ${planted.length})`);
  const plain = ["const counts = {}; // Counts only", "X-Steward-Export-Counts", "Export Counts toward", "the barnett test", "a dormant row", "Shared Counts"];
  const passed = plain.filter(p => scanText("plain", p).length === 0);
  ok(passed.length === plain.length, `the real-name guard passes ordinary words (${passed.length} of ${plain.length})`);
}

console.log(`\nno-emoji: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
