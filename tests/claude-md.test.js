// CHORE-1 — CLAUDE.md stays lean, and every decisions file it points at exists.
//
// Every session reads CLAUDE.md on every turn, so its length is a cost paid on
// every step. The cap is 200 lines. Area rules go to docs/decisions/<area>.md,
// and the story goes to docs/HISTORY.md (see "The two-strikes rule" in CLAUDE.md).
//
//   §1  the real CLAUDE.md is 200 lines or fewer
//   §2  every docs/decisions/*.md path it names exists
//   §3  proof this suite can fail: a 201-line plant and a link to a missing
//       decisions file must each be refused, and a 200-line file must pass,
//       so the cap is exactly 200 and not off by one
//
// CLAUDE_MD=<path> checks a different file in place of the real one, which is
// how the planted-file proof was run by hand.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const MAX_LINES = 200;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.error("  ✗ " + msg); } };

// A file's line count as an editor shows it: a trailing newline does not add a line.
const lineCount = text => (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length;
const decisionLinks = text => [...new Set(text.match(/docs\/decisions\/[A-Za-z0-9_.-]+\.md/g) || [])];

function problems(text, base) {
  const out = [];
  const n = lineCount(text);
  if (n > MAX_LINES) out.push(`CLAUDE.md is ${n} lines, over the ${MAX_LINES}-line cap`);
  for (const link of decisionLinks(text)) if (!fs.existsSync(path.join(base, link))) out.push(`links to ${link}, which does not exist`);
  return out;
}

const file = process.env.CLAUDE_MD ? path.resolve(process.env.CLAUDE_MD) : path.join(root, "CLAUDE.md");
const text = fs.readFileSync(file, "utf8");

console.log(`— §1 the cap (${path.relative(root, file) || file}) —`);
const n = lineCount(text);
ok(n <= MAX_LINES, `CLAUDE.md is ${n} lines (cap ${MAX_LINES})`);

console.log("— §2 every decisions file it names exists —");
const links = decisionLinks(text);
ok(links.length > 0, `CLAUDE.md names at least one decisions file (${links.length})`);
for (const link of links) ok(fs.existsSync(path.join(root, link)), `${link} exists`);

console.log("— §3 the guard refuses what it exists to refuse —");
const lines = k => Array.from({ length: k }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
ok(problems(lines(201), root).some(p => /201 lines/.test(p)), "a 201-line plant is refused");
ok(problems(lines(200), root).length === 0, "a 200-line file passes (the cap is exactly 200)");
ok(problems("see `docs/decisions/no-such-area.md`\n", root).some(p => /no-such-area\.md/.test(p)), "a link to a missing decisions file is refused");

console.log(`\nclaude-md: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
