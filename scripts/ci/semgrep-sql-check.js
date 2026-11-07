#!/usr/bin/env node
// scripts/ci/semgrep-sql-check.js — REDTEAM-2: reads the SQL gate's Semgrep JSON
// against the open list. Exit 1 on a new hit, a listed hit that has gone, or a
// Semgrep error (a file not read is not a file that passed).
//
// The open list (scripts/ci/semgrep-sql-open.txt): one hit per line,
//   <path> | <the flagged line's code, trimmed> | <why it is still open>
// Matched by path and code, not line number, so an edit above it doesn't move it.
// Usage: node scripts/ci/semgrep-sql-check.js <semgrep.json> <open-list>
const fs = require("fs");
const path = require("path");

const norm = s => String(s || "").replace(/\s+/g, " ").trim();

function readOpen(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => { const [p, code, why] = l.split(" | "); return { path: norm(p), code: norm(code), why: norm(why) }; });
}

function check(results, errors, open, readLine) {
  const problems = [];
  for (const e of errors) problems.push(`semgrep error: ${norm(e.message || e.type).slice(0, 200)}`);
  const seen = new Set();
  for (const r of results) {
    const code = norm(readLine(r.path, r.start.line));
    const hit = open.findIndex(o => o.path === r.path && o.code === code);
    if (hit >= 0) { seen.add(hit); continue; }
    problems.push(`NEW SQL finding ${r.check_id.split(".").pop()} at ${r.path}:${r.start.line}\n      ${code.slice(0, 160)}\n      fix it with the sql\`\` tag (server/db/sql.js); never a nosemgrep comment`);
  }
  open.forEach((o, i) => { if (!seen.has(i)) problems.push(`listed hit no longer found, remove it from the open list: ${o.path} | ${o.code.slice(0, 120)}`); });
  return { problems, open: open.length, found: results.length };
}

if (require.main === module) {
  const [json, list] = process.argv.slice(2);
  const d = JSON.parse(fs.readFileSync(json, "utf8"));
  const cache = new Map();
  const readLine = (p, n) => {
    if (!cache.has(p)) cache.set(p, fs.readFileSync(path.resolve(p), "utf8").split("\n"));
    return cache.get(p)[n - 1];
  };
  const r = check(d.results || [], d.errors || [], readOpen(list), readLine);
  console.log(`[semgrep-sql] ${r.found} SQL finding(s); ${r.open} on the open list`);
  if (r.problems.length) { for (const p of r.problems) console.log("  ✗ " + p); process.exit(1); }
  console.log("[semgrep-sql] ok: no SQL finding outside the open list");
}

module.exports = { check, readOpen, norm };
