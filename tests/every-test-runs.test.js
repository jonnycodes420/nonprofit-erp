// tests/every-test-runs.test.js: FIX-58 item 1. EVERY TEST RUNS.
// Pure source guard, no server. Run: node tests/every-test-runs.test.js
//
// IMPORT-5 merged tests/import5.test.js and nobody added it to run-all.sh, so
// the battery (and CI, which runs the same list) never ran it: twenty-eight
// assertions about donor money that guarded nothing. SEND-GATE-2 and FIX-55
// had done the same with their suites. A suite that is never run reads, in a
// PR, exactly like a suite that passed.
//
// So every tests/*.test.js and tests/*.spec.js is one of:
//   · a name in run-all.sh's CORE list (a .spec.js is run by its .test.js
//     wrapper of the same name, e.g. breaker.test.js requires breaker.spec.js)
//   · a line in tests/NOT-IN-BATTERY.md, "- `<file>` — <reason>", with a reason
// and a name in CORE must have its file, and a file listed as not in the
// battery must exist and must not also be in CORE.
//
// Proven able to fail: on main (before FIX-58) it was red for import5,
// send-gate-2, fix55-import-reads, brand-allowlist and scale1-load, and for
// the missing NOT-IN-BATTERY.md.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const testsDir = path.join(root, "tests");
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (extra ? "  " + extra : "")); }
};

// ── run-all.sh's CORE list, read the way run-all.sh reads it ──────────────
const runAll = fs.readFileSync(path.join(testsDir, "run-all.sh"), "utf8");
const block = runAll.match(/^CORE=\(\n([\s\S]*?)^\)/m);
ok("run-all.sh has a CORE=( … ) list", !!block);
const core = new Set(
  (block ? block[1] : "").split("\n").map(l => l.replace(/#.*/, "").trim()).filter(Boolean)
);
ok("the CORE list is not empty", core.size > 20, `${core.size} names`);

// ── the explicit list of what is deliberately not in the battery ──────────
const notPath = path.join(testsDir, "NOT-IN-BATTERY.md");
const notText = fs.existsSync(notPath) ? fs.readFileSync(notPath, "utf8") : null;
ok("tests/NOT-IN-BATTERY.md exists", notText !== null);
const notIn = new Map();
for (const line of (notText || "").split("\n")) {
  const m = line.match(/^\s*-\s+`([^`]+)`\s*[—–-]+\s*(.*)$/);
  if (m) notIn.set(m[1].trim(), m[2].trim());
}
for (const [file, reason] of notIn) {
  ok(`NOT-IN-BATTERY: ${file} gives a reason`, reason.length >= 15, `"${reason}"`);
  ok(`NOT-IN-BATTERY: ${file} exists`, fs.existsSync(path.join(testsDir, file)));
}

// ── every file is run, or says why not ────────────────────────────────────
const files = fs.readdirSync(testsDir).filter(f => /\.(test|spec)\.js$/.test(f)).sort();
ok("found the suites", files.length > 50, `${files.length} files`);
const unaccounted = [];
for (const f of files) {
  const name = f.replace(/\.(test|spec)\.js$/, "");
  const isSpec = f.endsWith(".spec.js");
  let runs = core.has(name);
  // A .spec.js runs only through its .test.js wrapper, which must require it.
  if (runs && isSpec) {
    const wrapper = path.join(testsDir, name + ".test.js");
    runs = fs.existsSync(wrapper) && fs.readFileSync(wrapper, "utf8").includes(`./${f}`);
  }
  const listed = notIn.has(f);
  if (runs && listed) ok(`${f} is in the battery OR the not-in list, not both`, false);
  if (!runs && !listed) unaccounted.push(f);
}
ok("every tests/*.test.js and *.spec.js is in run-all.sh or tests/NOT-IN-BATTERY.md",
  unaccounted.length === 0, unaccounted.join(", "));

// ── every name in CORE has its file (run-all.sh would print SKIP (missing)) ──
const missing = [...core].filter(n => !fs.existsSync(path.join(testsDir, n + ".test.js")));
ok("every name in CORE has its tests/<name>.test.js", missing.length === 0, missing.join(", "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
