#!/usr/bin/env node
// NUMBERS-6 · ONE FUNCTION WRITES THE TOTALS KEPT ON A PERSON.
//
// donors.total_giving, gift_count, first_gift_date, last_gift_date and
// last_gift_amount are written by shared/numbers/donorTotals.js (the statement
// is donorSummary.js's) and nowhere else. This scan reads every server and
// script file and names any SQL that writes one of those columns on `donors`
// in its own UPDATE, or that runs the recompute statement around the one
// writer. tests/numbers6-stored.test.js runs it; so can you:
//
//   node scripts/ci/stored-totals-guard.js        exit 1 and the lines, or "none"
//
// Not scanned: tests and their fixtures, the seeds (scripts/seed, scripts/load,
// scripts/ci/seed-demo.js, server/db/seed.js's boot fixture) and scripts/once,
// which ran once and are history. A new row that INSERTs a person with a
// stated total is not a write this scan can read; the after-battery check
// (scripts/ci/after-battery-numbers.js) catches that by its result instead.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const COLS = ["total_giving", "gift_count", "first_gift_date", "last_gift_date", "last_gift_amount"];
// The one writer, and the statement it runs.
const ALLOWED = new Set(["donorSummary.js", "shared/numbers/donorTotals.js", "scripts/ci/stored-totals-guard.js"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".generated", "client", "tests", "dist", "coverage", "_briefs", ".claude", "docs"]);
const SKIP_PREFIX = ["scripts/seed/", "scripts/load/", "scripts/once/"];
const SKIP_FILES = new Set(["scripts/ci/seed-demo.js", "server/db/seed.js",
  // Frozen, each with its reason: a one-off repair that ran (BUILD-88a), and a
  // drill that zeroes its own fixture person before it starts (BUILD-76).
  "scripts/ci/build88a-dedupe-gifts.js", "scripts/ops/build76-drift-drill.js"]);

function files(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".") { if (SKIP_DIRS.has(e.name)) continue; }
    const p = path.join(dir, e.name);
    const rel = path.relative(ROOT, p).split(path.sep).join("/");
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !SKIP_PREFIX.some(x => (rel + "/").startsWith(x))) files(p, out); continue; }
    if (/\.(c|m)?js$/.test(e.name) && !SKIP_FILES.has(rel) && !ALLOWED.has(rel)) out.push(rel);
  }
  return out;
}

// An assignment: the column at the start of the SET list or after a comma (a
// read inside a CASE, `WHEN total_giving = 0`, is not one).
const WRITE = new RegExp(`(?:^|,)\\s*(?:[a-z]{1,3}\\.)?(${COLS.join("|")})\\s*=(?!=)`, "i");
const TUPLE = new RegExp(`\\(\\s*(${COLS.join("|")})\\b[^)]*\\)\\s*=`, "i");
const RECOMPUTE = /\b(DONOR_SUMMARY_UPDATE|recomputeSummaries)\s*\(/;

// Every place in `text` that writes a stored total itself: [{ line, what }].
function scanText(text) {
  const hits = [];
  const lineOf = i => text.slice(0, i).split("\n").length;
  const re = /\bUPDATE\s+donors\b(\s+(AS\s+)?[a-z]{1,3}\b)?\s+SET\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 2000);
    const end = rest.search(/\bWHERE\b|\bFROM\b|`/i);
    const set = end >= 0 ? rest.slice(0, end) : rest;
    const w = set.match(WRITE) || set.match(TUPLE);
    if (w) hits.push({ line: lineOf(m.index), what: `UPDATE donors SET ${w[1]} …` });
  }
  text.split("\n").forEach((l, i) => {
    if (RECOMPUTE.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/\bif\s*\("DONOR_SUMMARY_UPDATE" in c\)/.test(l))
      hits.push({ line: i + 1, what: "runs the recompute statement itself, around shared/numbers/donorTotals.js" });
  });
  return hits;
}

function scan() {
  const out = [];
  for (const f of files()) for (const h of scanText(fs.readFileSync(path.join(ROOT, f), "utf8"))) out.push({ file: f, ...h });
  return out;
}

if (require.main === module) {
  const hits = scan();
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.what}`);
  console.log(hits.length ? `\n${hits.length} write(s) of a stored total outside shared/numbers/donorTotals.js` : "none: every stored total is written by shared/numbers/donorTotals.js");
  process.exit(hits.length ? 1 : 0);
}
module.exports = { scan, scanText, COLS };
