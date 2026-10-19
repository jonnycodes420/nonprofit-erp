#!/usr/bin/env node
// FIX-45 Part 2.6 · THE EM DASH SWEEP.
//
// docs/MESSAGING.md says "No em dashes." This rewrites every long dash a person
// can read, exactly the ones tests/polish2/enGb.js scanEmDash() finds (strings
// in the app, server sentences, emails, PDFs, the demo seed, the HTML entry
// pages, What's new), and touches nothing else: comments, logs, regex literals
// and other systems' header aliases are never read.
//
// The rewrite, per dash:
//   · a string that is only a dash (an empty table cell)    → "Not set", the
//     word the client already uses for a blank
//   · a dash opening the text ("— Jonathan", a sign-off)     → removed
//   · a short label on the left (four words or fewer) in a
//     string with no full stop ("Office Rent — March")       → "Office Rent: March"
//   · anything else ("Works in tech — capacity likely")      → ", ", the rule
//     why.js and grantLibrary.js already apply to model text
//   · the same for the HTML entities &mdash; and &#8212;
//
// Re-runnable: run it after merging other work, then run the guard.
//   node scripts/fix45-no-em-dash.js           rewrite in place
//   node scripts/fix45-no-em-dash.js --dry     print each change, write nothing
// Local files only: no BASE, no DATABASE_URL, no network.
"use strict";
const fs = require("fs");
const path = require("path");
const { scanEmDash } = require("../tests/polish2/enGb");

const ROOT = path.join(__dirname, "..");
const DRY = process.argv.includes("--dry");
const DASH_G = /([ \t]*)(—|&mdash;|&#8212;)([ \t]*)/g;

// One piece of text (a string's source, one quasi of a template, a line),
// with the whole string it belongs to for context. `first`/`last` say whether
// the piece opens or closes the whole text: a template's middle quasi follows
// or precedes an interpolation, which is a word, not the edge of the text.
function rewrite(piece, whole, { first = true, last = true } = {}) {
  const wholeText = String(whole).replace(/\$\{[^}]*\}/g, "X").replace(/^\s*["'`]|["'`]\s*$/g, "");
  if (/^\s*(\u2014|&mdash;|&#8212;)\s*$/.test(wholeText)) return piece.replace(/\u2014|&mdash;|&#8212;/, "Not set");
  const sentence = /[.!?](\s|$)/.test(wholeText);
  return piece.replace(DASH_G, (m, pre, dash, post, off, str) => {
    let before = str.slice(0, off).replace(/^["'`}]/, "");
    let after = str.slice(off + m.length).replace(/["'`$]$/, "").replace(/\$\{$/, "");
    if (!first && !before.trim()) before = "X";
    if (!last && !after.trim()) after = "X";
    // Opening the text: a sign-off ("— Jonathan") or a list item's lead.
    if (!before.trim() || /[>(]\s*$/.test(before)) return pre;
    // Between two digits with no spaces, a range: "2019—2020" reads "2019-2020".
    if (!pre && !post && /\d$/.test(before) && /^\d/.test(after)) return "-";
    const lastClause = before.split(/[.!?:;,(>]/).pop().trim();
    const words = lastClause ? lastClause.split(/\s+/).length : 0;
    const label = !sentence && words > 0 && words <= 4;
    // Closing the text, the rest arriving in an interpolation: a title such
    // as "Verify your email — Harbor Music" reads "Verify your email · Harbor Music".
    if (!after.trim() || after.trim() === "X") return label ? " · " : ", ";
    return label ? ": " : ", ";
  });
}

function fixFile(rel, hits) {
  const abs = path.join(ROOT, rel);
  let src = fs.readFileSync(abs, "utf8");
  const edits = [];
  if (rel.endsWith(".js") || rel.endsWith(".jsx") || rel.endsWith(".mjs") || rel.endsWith(".cjs")) {
    for (const h of hits) {
      const whole = h.ranges.map(([a, b]) => src.slice(a, b)).join("X");
      h.ranges.forEach(([a, b], i) => {
        const old = src.slice(a, b);
        if (!/—|&mdash;|&#8212;/.test(old)) return;
        edits.push({ a, b, old, neu: rewrite(old, whole, { first: i === 0, last: i === h.ranges.length - 1 }) });
      });
    }
  } else {
    const lines = src.split("\n");
    let offset = 0;
    const lineStarts = lines.map(l => { const s = offset; offset += l.length + 1; return s; });
    for (const h of hits) {
      const i = h.line - 1;
      const line = lines[i];
      // An HTML title separator reads as a middle dot: "Your Giving · Steward".
      const neu = /<title>|og:title|twitter:title/.test(line)
        ? line.replace(/\s*(—|&mdash;|&#8212;)\s*/g, " · ")
        : rewrite(line, line);
      edits.push({ a: lineStarts[i], b: lineStarts[i] + line.length, old: line, neu });
    }
  }
  edits.sort((x, y) => y.a - x.a);
  const seen = new Set();
  for (const e of edits) {
    if (seen.has(e.a) || e.old === e.neu) continue;
    seen.add(e.a);
    if (DRY) console.log(`${rel}\n  - ${e.old.trim().slice(0, 200)}\n  + ${e.neu.trim().slice(0, 200)}`);
    src = src.slice(0, e.a) + e.neu + src.slice(e.b);
  }
  if (!DRY) fs.writeFileSync(abs, src);
  return seen.size;
}

const hits = scanEmDash(ROOT);
const byFile = new Map();
for (const h of hits) { if (!byFile.has(h.file)) byFile.set(h.file, []); byFile.get(h.file).push(h); }
let changed = 0;
for (const [rel, hs] of byFile) changed += fixFile(rel, hs);
const left = DRY ? hits.length : scanEmDash(ROOT).length;
console.log(`${DRY ? "would change" : "changed"} ${changed} string(s) in ${byFile.size} file(s); ${DRY ? "found" : "left"} ${left}`);
process.exit(!DRY && left ? 1 : 0);
