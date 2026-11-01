#!/usr/bin/env node
// scripts/ci/history-index.js: ARCH-1. The index of docs/history/, generated on
// demand and never committed (a committed index is one more file every build
// would edit). Newest first, by the first date in each file's first heading.
//   node scripts/ci/history-index.js            print the index
//   node scripts/ci/history-index.js --check    fail if a file has no "## " heading
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "docs", "history");
const rows = [];
let bad = 0;
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".md") && f !== "README.md")) {
  const head = (fs.readFileSync(path.join(DIR, f), "utf8").match(/^##? (.+)$/m) || [])[1];
  if (!head) { bad++; console.error(`no heading: docs/history/${f}`); continue; }
  const date = (head.match(/\d{4}-\d{2}-\d{2}/) || ["0000-00-00"])[0];
  rows.push({ f, head, date });
}
rows.sort((a, b) => b.date.localeCompare(a.date) || a.f.localeCompare(b.f));
if (!process.argv.includes("--check")) for (const r of rows) console.log(`${r.date}  ${r.f.padEnd(44)}  ${r.head.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "")}`);
process.exit(bad ? 1 : 0);
