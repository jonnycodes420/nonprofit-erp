#!/usr/bin/env node
// scripts/ci/needs-jonathan.js: ARCH-1. Everything waiting on Jonathan, read
// from docs/needs-jonathan/ (one file per brief) and printed newest first.
// Generated on demand, never committed: a committed index is one more file
// every build would edit.
//   node scripts/ci/needs-jonathan.js            the whole open list
//   node scripts/ci/needs-jonathan.js --titles   one line per section
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "docs", "needs-jonathan");
const sections = [];
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".md"))) {
  const text = fs.readFileSync(path.join(DIR, f), "utf8");
  for (const part of text.split(/^(?=## )/m).filter(p => p.startsWith("## "))) {
    const title = part.split("\n")[0].slice(3);
    const date = (title.match(/\d{4}-\d{2}-\d{2}/) || ["0000-00-00"])[0];
    sections.push({ f, title, date, part: part.trim() });
  }
}
sections.sort((a, b) => b.date.localeCompare(a.date) || a.f.localeCompare(b.f));
if (process.argv.includes("--titles")) for (const s of sections) console.log(`${s.date}  ${s.title}  (docs/needs-jonathan/${s.f})`);
else console.log(`# Needs Jonathan: ${sections.length} sections, newest first\n\n` + sections.map(s => `${s.part}\n\n_(docs/needs-jonathan/${s.f})_`).join("\n\n"));
