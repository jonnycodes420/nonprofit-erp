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

// ── CI-2 · a browser suite walks its own shard's dist ──────────────────────
// Each shard holding a browser suite has a dist built for its own API, named
// in STEWARD_DIST and read through tests/lib/dist.js. A suite (or a helper it
// requires) that joins "client", "dist" itself reads shard 1's build from any
// other shard and quietly skips its browser leg (five did, in CI-2's first
// shuffled battery).
const OWN_DIST = /["']client["']\s*,\s*["']dist["']|["']client\/dist["']/;
function ownDist(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!["node_modules", "fixtures", "lib"].includes(e.name)) walk(p); continue; }
      if (!/\.js$/.test(e.name) || p === __filename) continue;
      const code = fs.readFileSync(p, "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
      if (OWN_DIST.test(code)) out.push(path.relative(dir, p));
    }
  })(dir);
  return out;
}
const own = ownDist(testsDir);
ok("no suite builds its own client/dist path (tests/lib/dist.js gives this shard's)", own.length === 0, own.join(", "));

// ── CI-2 · the shards ran every suite exactly once ─────────────────────────
// CI's combine job runs this with SHARD_RESULTS (the folder of every matrix
// job's shard-<n>.json) and SHARD_COUNT: every suite discovered in this tree
// ran exactly once across the shards, by name. In the battery itself there are
// no shard results to read, and only the plants below run.
const { read, ranOnce } = require("./lib/shardResults");
if (process.env.SHARD_RESULTS) {
  const got = read(process.env.SHARD_RESULTS, Number(process.env.SHARD_COUNT || 0));
  ok(`every shard reported (${process.env.SHARD_COUNT} shards)`, Number(process.env.SHARD_COUNT) > 0 && got.problems.length === 0, got.problems.join("; "));
  const once = ranOnce(listed, got.results);
  ok(`every one of the ${listed.length} suites ran exactly once across the shards`, once.length === 0, once.slice(0, 10).join("; "));
}

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
  fs.writeFileSync(path.join(tmp, "epsilon.test.js"), 'const DIST = path.join(ROOT, "client", "dist");\n');
  ok("plant: a suite that joins its own client/dist goes red", ownDist(tmp).includes("epsilon.test.js"));
  fs.unlinkSync(path.join(tmp, "epsilon.test.js"));
  // CI-2: the shard results. Two shards, alpha in one and beta in the other.
  const shardDir = path.join(tmp, "shards"); fs.mkdirSync(shardDir);
  const put = (n, suites) => fs.writeFileSync(path.join(shardDir, `shard-${n}.json`), JSON.stringify({ shard: n, suites }));
  put(1, [{ name: "alpha", rc: 0 }]); put(2, [{ name: "beta", rc: 1 }]);
  let r = read(shardDir, 2);
  ok("plant: two shards that ran alpha and beta once each pass (a red suite still ran)", r.problems.length === 0 && ranOnce(["alpha", "beta"], r.results).length === 0);
  put(2, [{ name: "beta", rc: 0 }, { name: "alpha", rc: 0 }]);
  ok("plant: a suite that ran in two shards goes red", ranOnce(["alpha", "beta"], read(shardDir, 2).results).some(p => /alpha ran 2 times/.test(p)));
  fs.unlinkSync(path.join(shardDir, "shard-2.json"));
  r = read(shardDir, 2);
  ok("plant: a shard that crashed before reporting goes red, and its suites never ran", r.problems.some(p => /shard 2 produced no result/.test(p)) && ranOnce(["alpha", "beta"], r.results).some(p => /beta never ran/.test(p)));
  fs.writeFileSync(path.join(shardDir, "shard-2.json"), JSON.stringify({ shard: 2, error: "server did not start", suites: [] }));
  ok("plant: a shard whose server never started goes red", read(shardDir, 2).problems.some(p => /shard 2 did not run/.test(p)));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
