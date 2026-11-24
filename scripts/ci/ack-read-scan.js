#!/usr/bin/env node
// scripts/ci/ack-read-scan.js · THANKS-1 item 1. NO SCREEN READS THE RECEIPT'S MARK AS "THANKED".
//
// One column carried two meanings: `gifts.acknowledgement_sent` is the IRS fact
// ("a written acknowledgment exists"), set by the receipt writer the moment the
// PDF is made, and every screen read it as "this donor was thanked". So making a
// receipt printed "Thanked" while the thank-you task and draft stayed open.
// Now "thanked" is shared/numbers/thanks.js (THANKED / AWAITING, `thanked_at`),
// and this scan fails on a READ of `acknowledgement_sent` (or `_at`) anywhere
// outside the receipt code.
//
// A read is any qualified reference (`g.acknowledgement_sent`, a JS property or
// SQL column), or a bare one not being assigned (`acknowledgement_sent IS NOT
// TRUE`, `COALESCE(acknowledgement_sent, …)`, a SELECT list). A bare
// `acknowledgement_sent=` / `acknowledgement_sent_at =` is a SET in a write and
// passes, as do comment lines. The files below own the column; any other line
// that must read it says why with `ACK-READ-OK` on the line.
//
// Proven able to fail: `--self-test` plants `if (g.acknowledgement_sent) …` and
// a `COALESCE(acknowledgement_sent,false)=false` filter and watches both caught,
// and a plain SET pass. Run against main before THANKS-1 it named 46 lines.
//
// Usage: node scripts/ci/ack-read-scan.js [--self-test]. Exits 1 and prints file:line.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["server", "routes", "shared", "middleware", "lib", "client/src", "scripts/nightly-ai"];
// The receipt code and the one rule: these own the column.
const OWNERS = new Set([
  "shared/numbers/thanks.js",          // the one rule (THANKED's legacy branch reads the mark)
  "server/boot/helpers-3.js",          // the receipt writer: sets the IRS mark
  "server/donors/giftThankedBox.js",   // the form's Thanked box keeps the mark in step with the receipts
  "server/donors/giftShape.js",        // reads the old request-body spelling of the Thanked box
]);
const SKIP_DIR = /(^|\/)(node_modules|dist|ddl)(\/|$)/;
const WORD = /([A-Za-z_][A-Za-z0-9_]*\.)?\backnowledgement_sent(_at)?\b(\s*=(?!=))?/g;

function readsIn(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t.includes("acknowledgement_sent")) return;
    if (/^(\/\/|\*|\/\*|--|#)/.test(t)) return;
    if (line.includes("ACK-READ-OK")) return;
    const code = line.replace(/\/\/.*$/, "").replace(/--\s.*$/, "")
      .replace(/acknowledgement_sent_at\s*=\s*COALESCE\(\s*acknowledgement_sent_at\s*,/g, "SET(");   // a write keeping its own stamp
    let m; WORD.lastIndex = 0;
    while ((m = WORD.exec(code))) {
      const qualified = !!m[1], assigned = !!m[3];
      if (qualified || !assigned) { out.push(i + 1); break; }
    }
  });
  return out;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(ROOT, p);
    if (SKIP_DIR.test(rel)) continue;
    if (e.isDirectory()) walk(p, files);
    else if (/\.(js|jsx|mjs|cjs)$/.test(e.name)) files.push(p);
  }
  return files;
}

if (process.argv.includes("--self-test")) {
  const planted = readsIn('if (g.acknowledgement_sent) x();\nconst r = await query("SELECT id FROM gifts WHERE COALESCE(acknowledgement_sent,false)=false");');
  const fine = readsIn('await run("UPDATE gifts SET acknowledgement_sent=true, acknowledgement_sent_at = NOW() WHERE id=?");\n// acknowledgement_sent is the IRS mark');
  if (planted.length !== 2 || fine.length !== 0) {
    console.error("ack-read-scan self-test FAILED", { planted, fine });
    process.exit(1);
  }
  console.log("ack-read-scan self-test: two planted reads of the receipt's mark are caught; a SET and a comment pass.");
  process.exit(0);
}

const files = [...DIRS.flatMap(d => walk(path.join(ROOT, d))),
  ...fs.readdirSync(ROOT).filter(f => /\.js$/.test(f)).map(f => path.join(ROOT, f))];
const bad = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  if (OWNERS.has(rel)) continue;
  for (const n of readsIn(fs.readFileSync(f, "utf8"))) bad.push(`${rel}:${n}`);
}
if (bad.length) {
  console.error(`ack-read-scan: ${bad.length} read(s) of gifts.acknowledgement_sent outside the receipt code:\n  ` + bad.join("\n  ")
    + "\n\"Thanked\" is shared/numbers/thanks.js (THANKED, AWAITING) on the server and `g.thanked` on a screen; the mark"
    + "\nmeans a receipt exists. If a line truly needs the IRS mark, say why with ACK-READ-OK on it.");
  process.exit(1);
}
console.log(`ack-read-scan: no read of the receipt's mark as "thanked" in ${files.length} files.`);
