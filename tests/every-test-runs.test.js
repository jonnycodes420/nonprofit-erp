// tests/every-test-runs.test.js: FIX-58 item 1, rebuilt by ARCH-1. EVERY TEST RUNS.
// Pure source guard, no server. Run: node tests/every-test-runs.test.js
//
// IMPORT-5 merged tests/import5.test.js and nobody added it to run-all.sh, so
// the battery (and CI, which runs the same list) never ran it: twenty-eight
// assertions about donor money that guarded nothing. A suite that is never run
// reads, in a PR, exactly like a suite that passed.
//
// ARCH-1 took the hand-kept list away: run-all.sh finds every tests/*.test.js
// itself (tests/lib/suites.js). This guard holds that to account:
//   · run-all.sh keeps no list of names, and `run-all.sh --list` prints exactly
//     the files on disk, minus the ones that say `// battery: skip — <reason>`;
//   · every skip gives a reason, and every .spec.js has a .test.js that runs it;
//   · the plants below (a skip with no reason, a spec with no wrapper, a list
//     that drops a file) each go red, so the checks are proven able to fail.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { discover } = require("./lib/suites");

const root = path.join(__dirname, "..");
const testsDir = path.join(root, "tests");
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.error("  ✗ " + name + (extra ? "  " + extra : "")); }
};

// The rules, as a function of a tests folder and the list a runner printed.
function problems(dir, listed) {
  const out = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".test.js")).map(f => f.replace(/\.test\.js$/, ""));
  const { skipped } = discover(dir);
  const skip = new Set(skipped.map(s => s.file.replace(/\.test\.js$/, "")));
  for (const s of skipped) if (s.reason.length < 15) out.push(`${s.file} skips the battery without a reason`);
  const want = files.filter(n => !skip.has(n)).sort(), got = [...listed].sort();
  for (const n of want) if (!got.includes(n)) out.push(`${n}.test.js is not run`);
  for (const n of got) if (!want.includes(n)) out.push(`${n} is run but has no tests/${n}.test.js (or is skipped)`);
  for (const spec of fs.readdirSync(dir).filter(f => f.endsWith(".spec.js"))) {
    const name = spec.replace(/\.spec\.js$/, ""), wrapper = path.join(dir, name + ".test.js");
    const runs = fs.existsSync(wrapper) && fs.readFileSync(wrapper, "utf8").includes(`./${spec}`) && got.includes(name);
    if (!runs) out.push(`${spec} has no ${name}.test.js in the battery that requires it`);
  }
  return out;
}

// ── the real tree ──────────────────────────────────────────────────────────
const runAll = fs.readFileSync(path.join(testsDir, "run-all.sh"), "utf8");
ok("run-all.sh keeps no hand list of suite names (CORE comes from tests/lib/suites.js)",
  !/^CORE=\(\n\s*[a-z]/m.test(runAll) && /node tests\/lib\/suites\.js/.test(runAll));
ok("tests/NOT-IN-BATTERY.md is gone (a skip is said in the suite's own file)", !fs.existsSync(path.join(testsDir, "NOT-IN-BATTERY.md")));
const listed = execFileSync("bash", [path.join(testsDir, "run-all.sh"), "--list"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
ok("run-all.sh --list finds the suites", listed.length > 150, `${listed.length} suites`);
const real = problems(testsDir, listed);
ok("every tests/*.test.js is run by the battery or says why not, and every .spec.js is run", real.length === 0, real.join("; "));
const { skipped } = discover();
console.log(`  · ${listed.length} suites run; skipped: ${skipped.map(s => s.file).join(", ") || "none"}`);

// ── proven able to fail ────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "every-test-runs-"));
try {
  fs.writeFileSync(path.join(tmp, "alpha.test.js"), "// a suite\n");
  fs.writeFileSync(path.join(tmp, "beta.test.js"), "// a suite\n");
  ok("plant: a clean folder passes", problems(tmp, ["alpha", "beta"]).length === 0);
  ok("plant: a list that drops a file goes red", problems(tmp, ["alpha"]).some(p => /beta\.test\.js is not run/.test(p)));
  fs.writeFileSync(path.join(tmp, "gamma.test.js"), "// battery: skip — no\n");
  ok("plant: a skip with no real reason goes red", problems(tmp, ["alpha", "beta"]).some(p => /without a reason/.test(p)));
  fs.unlinkSync(path.join(tmp, "gamma.test.js"));
  fs.writeFileSync(path.join(tmp, "delta.spec.js"), "// a spec\n");
  ok("plant: a .spec.js with no wrapper goes red", problems(tmp, ["alpha", "beta"]).some(p => /delta\.spec\.js/.test(p)));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
