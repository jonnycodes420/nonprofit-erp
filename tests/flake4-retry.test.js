// tests/flake4-retry.test.js · FLAKE-4. A FLAKY SUITE RETRIES ONCE, INSIDE THE RUN.
// @no-retry: this suite guards the retry itself, so a second chance would hide its own failure.
//
// What would make it fail (each planted and seen red before this went green):
//   §1 a suite that fails then passes is not run again, or passes without being
//      named (no "FLAKY: <name> passed on retry", no try1 log, no flaky entry
//      in flaky.json, no PR comment body)
//   §2 a suite that fails twice comes out green, or is run a third time
//   §3 a suite tagged @no-retry, tenant-matrix, security, or any suite under
//      SHARD_RETRY=0 (the Repeat workflow) gets a second run
//   §4 the nightly counts a suite flaky in fewer than 3 runs, counts one run
//      twice, or counts a run older than 7 days
//   §5 the shard does not run its suites through run_suite, the `test` gate
//      stops writing flaky.json or commenting on the PR, or Repeat retries
//
// No server, no database, no network: fixture suites (tests/fixtures/flake4/,
// not suites themselves) run through the shard's own runner in a temp folder.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const helpers = require("./helpers");
const { summary } = helpers;
const ok = (cond, name) => helpers.ok(name, !!cond);

const ROOT = path.join(__dirname, "..");
const FIX = path.join(ROOT, "tests", "fixtures", "flake4");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "flake4-"));
const yaml = (() => { try { return require("js-yaml"); } catch { return require(path.join(ROOT, "client", "node_modules", "js-yaml")); } })();

// One suite through tests/lib/run-suite.sh, exactly as tests/shard.sh calls it.
function runSuite(name, fixture, env = {}) {
  const state = fs.mkdtempSync(path.join(TMP, name + "-"));
  const log = path.join(state, `${name}.log`);
  const r = spawnSync("bash", ["-c",
    '. tests/lib/run-suite.sh; run_suite "$1" "$2" "$3"; printf "\\nRC=%s TRIES=%s FLAKY=%s\\nNO=%s\\nFIRST=%s\\n" "$SUITE_RC" "$SUITE_TRIES" "$SUITE_FLAKY" "$SUITE_NO_RETRY" "$SUITE_FIRST_LAST"',
    "_", name, path.join(FIX, fixture), log],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, SHARD_N: "9", SHARD_RETRY: "1", ...env, FLAKE4_STATE: state } });
  const out = r.stdout || "";
  const m = /RC=(\d+) TRIES=(\d+) FLAKY=(\d+)\nNO=(.*)\nFIRST=(.*)/.exec(out) || [];
  const runs = Number(fs.readFileSync(path.join(state, fixture), "utf8"));
  return { out, rc: Number(m[1]), tries: Number(m[2]), flaky: m[3] === "1", no: m[4] || "", first: m[5] || "", runs, log, state };
}

(async () => {
  // §1 fails, then passes: green, and named
  const f = runSuite("fixture-flaky", "fails-then-passes.js");
  ok(f.rc === 0 && f.tries === 2 && f.runs === 2, `a suite that fails then passes runs twice and passes (rc ${f.rc}, tries ${f.tries}, runs ${f.runs})`);
  ok(f.flaky && /^FLAKY: fixture-flaky passed on retry$/m.test(f.out), "…and the run says \"FLAKY: fixture-flaky passed on retry\"");
  ok(fs.existsSync(path.join(f.state, "fixture-flaky.try1.log")) && /0 passed, 1 failed/.test(fs.readFileSync(path.join(f.state, "fixture-flaky.try1.log"), "utf8")),
    "…the red first run's log is kept as <name>.try1.log");
  ok(f.first === "0 passed, 1 failed" && /1 passed, 0 failed/.test(fs.readFileSync(f.log, "utf8")), "…its first run's last line is kept, and the log is the green run's");

  // …and flaky.json / the PR comment name it, from the shard's own result line
  const shards = path.join(TMP, "shards"); fs.mkdirSync(shards);
  fs.writeFileSync(path.join(shards, "shard-1.json"), JSON.stringify({ shard: 1, suites: [
    { name: "fixture-flaky", rc: 0, secs: 2, last: "1 passed, 0 failed", tries: 2, flaky: true, firstLast: f.first },
    { name: "fixture-red", rc: 1, secs: 2, last: "0 passed, 1 failed", tries: 2, flaky: false, firstLast: "0 passed, 1 failed" },
    { name: "tasks", rc: 0, secs: 9, last: "12 passed, 0 failed" },
  ] }));
  fs.writeFileSync(path.join(shards, "shard-2.json"), JSON.stringify({ shard: 2, suites: [] }));
  const out = path.join(TMP, "flaky", "flaky.json"), comment = path.join(TMP, "flaky", "comment.md");
  const fl = spawnSync("node", ["scripts/ci/flaky-list.js", "--in", shards, "--shards", "2", "--out", out, "--comment", comment],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, GITHUB_RUN_ID: "777", GITHUB_REPOSITORY: "o/r", GITHUB_STEP_SUMMARY: "" } });
  const j = JSON.parse(fs.readFileSync(out, "utf8"));
  ok(fl.status === 0 && j.run === "777" && j.suites.length === 1 && j.suites[0].name === "fixture-flaky" && j.suites[0].shard === 1,
    "flaky.json lists the suite that passed on its retry, and only that one (not the red one, not a clean pass)");
  ok(/^FLAKY: fixture-flaky passed on retry$/m.test(fl.stdout), "…and the gate's summary has the FLAKY line");
  ok(fs.existsSync(comment) && /`fixture-flaky` \(shard 1\)/.test(fs.readFileSync(comment, "utf8")) && /actions\/runs\/777/.test(fs.readFileSync(comment, "utf8")),
    "…and the PR comment body names it, with the run's logs");
  const clean = path.join(TMP, "clean"); fs.mkdirSync(clean);
  fs.writeFileSync(path.join(clean, "shard-1.json"), JSON.stringify({ shard: 1, suites: [{ name: "tasks", rc: 0, secs: 1, last: "1 passed, 0 failed" }] }));
  const c2 = path.join(clean, "comment.md");
  spawnSync("node", ["scripts/ci/flaky-list.js", "--in", clean, "--shards", "1", "--out", path.join(clean, "flaky.json"), "--comment", c2], { cwd: ROOT, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
  ok(!fs.existsSync(c2) && JSON.parse(fs.readFileSync(path.join(clean, "flaky.json"), "utf8")).suites.length === 0, "a run with no flake writes an empty flaky.json and no comment");

  // §2 fails twice: red, and no third run
  const r = runSuite("fixture-red", "fails-twice.js");
  ok(r.rc === 1 && r.tries === 2 && r.runs === 2 && !r.flaky && !/FLAKY: /.test(r.out), `a suite that fails twice fails, after exactly two runs (rc ${r.rc}, runs ${r.runs})`);

  // §3 never retried
  const n = runSuite("fixture-no-retry", "no-retry.js");
  ok(n.rc === 1 && n.tries === 1 && n.runs === 1 && /tagged @no-retry/.test(n.no), `a suite tagged @no-retry is not retried, though it would pass a second time (rc ${n.rc}, runs ${n.runs})`);
  for (const name of ["tenant-matrix", "security"]) {
    const t = runSuite(name, "fails-then-passes.js");
    ok(t.rc === 1 && t.runs === 1 && new RegExp(`${name} is never retried`).test(t.no), `${name} is never retried, by name`);
  }
  const off = runSuite("fixture-flaky", "fails-then-passes.js", { SHARD_RETRY: "0" });
  ok(off.rc === 1 && off.runs === 1, "under SHARD_RETRY=0 (Repeat) nothing is retried");
  const { mayRetry } = require("./lib/retryPolicy");
  ok(mayRetry("lag1", "// a browser suite").retry && !mayRetry("x", "// @no-retry: guards money").retry, "the policy: an ordinary suite may retry, a tagged one may not");
  ok(/@no-retry/.test(fs.readFileSync(__filename, "utf8").split("\n")[1]), "this suite is itself @no-retry");

  // §4 the nightly: 3+ runs in 7 days
  const { tally } = require("../scripts/ci/flaky-week");
  const now = Date.parse("2026-11-10T09:30:00Z"), day = 86400e3;
  const rep = (run, ago, ...names) => ({ run: String(run), at: new Date(now - ago * day).toISOString(), suites: names.map(name => ({ name, shard: 1, firstLast: "x" })) });
  const list = tally([
    rep(1, 1, "lag1", "integrity3"), rep(2, 2, "lag1"), rep(3, 3, "lag1", "integrity3"),
    rep(4, 6, "integrity3"),  rep(5, 9, "home6-layout"), rep(6, 10, "home6-layout"), rep(7, 1, "home6-layout"),
    { run: "8", at: new Date(now - day).toISOString(), suites: [{ name: "dates1", shard: 1 }, { name: "dates1", shard: 4 }] },
    rep(9, 2, "dates1"),
  ], { min: 3, days: 7, now });
  const by = Object.fromEntries(list.map(e => [e.name, e.times]));
  ok(by.lag1 === 3 && by.integrity3 === 3, "the nightly lists suites flaky in 3 runs in the last 7 days");
  ok(!("home6-layout" in by), "…not one whose runs are mostly older than 7 days");
  ok(!("dates1" in by), "…and one run that named a suite in two shards counts once");
  const nw = spawnSync("node", ["scripts/ci/flaky-week.js", "--in", path.join(TMP, "nothing"), "--now", "2026-11-10T09:30:00Z"], { cwd: ROOT, encoding: "utf8" });
  ok(nw.status === 0 && /No suite passed only on its retry 3\+ times/.test(nw.stdout), "with nothing to read, the nightly says so and exits 0");

  // §5 the wiring
  const sh = fs.readFileSync(path.join(ROOT, "tests", "shard.sh"), "utf8");
  ok(/^\. tests\/lib\/run-suite\.sh$/m.test(sh) && /run_suite "\$name" "\$file" "\$log"/.test(sh) && !/^\s*node "\$file"/m.test(sh),
    "the shard runs every suite through run_suite, never a bare node");
  ok(/"flaky\\":/.test(sh) && /"firstLast\\":/.test(sh), "…and its result line carries flaky and firstLast");
  const ci = yaml.load(fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8"));
  const gate = ci.jobs.combine, steps = gate.steps.map(s => (s.run || "") + " " + JSON.stringify(s.with || {}));
  ok(gate.name === "test" && gate.permissions["pull-requests"] === "write", "the `test` gate may comment on the PR");
  ok(steps.some(s => /flaky-list\.js .*--out \/tmp\/flaky\/flaky\.json/.test(s)) && steps.some(s => /"name":"flaky"/.test(s)) && steps.some(s => /gh pr comment/.test(s)),
    "…writes flaky.json, uploads it as the `flaky` artifact, and posts the list");
  const rp = yaml.load(fs.readFileSync(path.join(ROOT, ".github", "workflows", "repeat.yml"), "utf8"));
  ok(String(rp.jobs.repeat.env.SHARD_RETRY) === "0", "Repeat turns the retry off, so it counts every red run");
  const nf = yaml.load(fs.readFileSync(path.join(ROOT, ".github", "workflows", "flaky-nightly.yml"), "utf8"));
  ok(nf.on.schedule && JSON.stringify(nf).includes("flaky-week.js") && /--min \\?"\$MIN\\?"/.test(JSON.stringify(nf)), "the nightly runs on a schedule and lists suites flaky 3+ times");

  fs.rmSync(TMP, { recursive: true, force: true });
  summary();
})();
