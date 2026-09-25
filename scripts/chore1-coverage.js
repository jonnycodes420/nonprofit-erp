// CHORE-1 — proves the CLAUDE.md split moved everything and dropped nothing.
//
// Every non-blank line of the old CLAUDE.md must appear, byte for byte, in the
// new set: CLAUDE.md + docs/HISTORY.md + docs/decisions/*.md. Lines are counted,
// so a line the old file had three times must appear at least three times.
// Exit 1 on any missing line.
//
//   node scripts/chore1-coverage.js            # old file = CLAUDE.md at the merge base with origin/main
//   node scripts/chore1-coverage.js OLD.md     # or an explicit copy of the old file
//
// One-shot: run it, commit its output (docs/chore1-coverage.txt), delete it.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const old = process.argv[2]
  ? fs.readFileSync(process.argv[2], "utf8")
  : execSync("git show $(git merge-base HEAD origin/main):CLAUDE.md", { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });

const newFiles = ["CLAUDE.md", "docs/HISTORY.md",
  ...fs.readdirSync(path.join(root, "docs/decisions")).filter(f => f.endsWith(".md")).sort().map(f => "docs/decisions/" + f)];

const count = lines => { const m = new Map(); for (const l of lines) if (l.trim()) m.set(l, (m.get(l) || 0) + 1); return m; };
const oldLines = old.split("\n");
const want = count(oldLines);
const have = new Map();
const where = new Map();
for (const f of newFiles) {
  for (const [l, n] of count(fs.readFileSync(path.join(root, f), "utf8").split("\n"))) {
    have.set(l, (have.get(l) || 0) + n);
    if (want.has(l)) where.set(l, [...(where.get(l) || []), f]);
  }
}

const missing = [];
for (const [l, n] of want) if ((have.get(l) || 0) < n) missing.push({ line: oldLines.indexOf(l) + 1, short: n - (have.get(l) || 0), text: l });
missing.sort((a, b) => a.line - b.line);

const nonBlank = oldLines.filter(l => l.trim()).length;
const bytes = f => fs.statSync(path.join(root, f)).size;
const lc = f => fs.readFileSync(path.join(root, f), "utf8").split("\n").length - 1;
console.log(`old CLAUDE.md: ${oldLines.length - 1} lines, ${old.length} bytes, ${nonBlank} non-blank lines (${want.size} distinct)`);
console.log(`new files (${newFiles.length}):`);
for (const f of newFiles) console.log(`  ${f.padEnd(44)} ${String(lc(f)).padStart(5)} lines ${String(bytes(f)).padStart(8)} bytes`);
const dup = [...where].filter(([l, fs_]) => new Set(fs_).size > 1 && want.get(l) < fs_.length);
console.log(`old lines present in more than one new file: ${dup.length}${dup.length ? " — " + dup.map(([l, f]) => JSON.stringify(l.slice(0, 50)) + " in " + [...new Set(f)].join(", ")).join("; ") : ""}`);
if (missing.length) {
  console.log(`\nFAIL: ${missing.length} old line(s) missing from the new files:`);
  for (const m of missing) console.log(`  old line ${m.line}${m.short > 1 ? ` (x${m.short})` : ""}: ${m.text.slice(0, 160)}`);
  process.exit(1);
}
console.log(`\nPASS: every non-blank line of the old CLAUDE.md is present in the new files.`);
