#!/usr/bin/env node
// BUILD-75 B.6 — the npm-audit FAILING gate, with NAMED exceptions.
//
// `npm audit --audit-level=high` alone can't be a gate here: two highs have
// no upstream fix (image-size, xlsx) and a permanently-red gate is a gate
// nobody reads. Instead: every HIGH or CRITICAL advisory must either be
// absent or listed in audit/npm-audit-allowlist.json with a reason and a
// review date. A NEW high/critical fails CI the day it appears; an allowed
// one keeps its justification in a reviewed, committed file.
//
// Runs against the package in CWD. Usage: node scripts/audit-gate.js [dir]
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const allowPath = path.join(__dirname, "..", "audit", "npm-audit-allowlist.json");
const allow = JSON.parse(fs.readFileSync(allowPath, "utf8"));
const allowedIds = new Set(allow.exceptions.map(e => e.ghsa));

let out;
try {
  out = execSync("npm audit --omit=dev --json", { cwd: dir, maxBuffer: 32 * 1024 * 1024 }).toString();
} catch (e) {
  out = (e.stdout || "").toString(); // npm audit exits non-zero when vulns exist — the JSON is still on stdout
  if (!out) { console.error("npm audit produced no output:", e.message); process.exit(2); }
}
const report = JSON.parse(out);
const bad = [];
for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
  if (!["high", "critical"].includes(v.severity)) continue;
  const ids = (v.via || []).filter(x => typeof x === "object").map(x => (x.url || "").split("/").pop()).filter(Boolean);
  const unlisted = ids.filter(id => !allowedIds.has(id));
  if (ids.length === 0 || unlisted.length) bad.push({ name, severity: v.severity, unlisted: unlisted.length ? unlisted : ["(no advisory id — transitive)"] });
}
if (bad.length) {
  console.error(`AUDIT GATE FAILED (${path.basename(dir)}): ${bad.length} high/critical advisories not in audit/npm-audit-allowlist.json`);
  for (const b of bad) console.error(`  ${b.severity.toUpperCase()}  ${b.name}: ${b.unlisted.join(", ")}`);
  console.error("Fix the dependency, or add the GHSA id to the allowlist WITH a reason and review date.");
  process.exit(1);
}
console.log(`audit gate clean (${path.basename(dir)}): no unlisted high/critical advisories`);
