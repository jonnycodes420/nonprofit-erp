// tests/ci-speed1-affected.test.js · CI-SPEED-1. THE TEN-MINUTE LOCAL LOOP AND
// THE CI THAT GATES IT.
//
// What would make it fail (each planted and seen red before this went green):
//   §1 `npm run affected` on a change to one server route does not pick that
//      route's suites, or runs tenant-matrix (heavy: CI's) for it
//   §2 a change to tenant-matrix's own file does not run tenant-matrix; the
//      plan goes past its ten-minute budget
//   §3 two `affected` runs from two worktrees do not both proceed at once; a
//      third waits longer than it was told to, or fails instead of skipping to
//      the push; a second run in the SAME worktree takes a slot alongside the
//      first (both would boot the same database)
//   §4 ci.yml does not parse, cancels a stale run on anything but a pull
//      request, or puts pushes to main in a shared group (where a queued
//      deploy run is cancelled by the next); the `test` gate stops requiring
//      the guards, semgrep, the plan and every shard
//   §5 FLAKE-3: a changed browser suite is started with no client build and
//      no preview (CI-SPEED-1 ran it with SHARD_BUILD_DIST=0 SHARD_PREVIEW=0,
//      and its leg could not connect), or is dropped silently when it cannot
//      run, instead of skipped with "CI will run it"
//
// No server, no database, no network: the plan reads files, and the slot runs
// hold a slot and run nothing (AFFECTED_HOLD_MS) in a temp slot folder.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const helpers = require("./helpers");
const { summary } = helpers;
const ok = (cond, name) => helpers.ok(name, !!cond);   // reads as the assertion, then its sentence

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "ci", "affected.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ci-speed1-"));
const yaml = (() => { try { return require("js-yaml"); } catch { return require(path.join(ROOT, "client", "node_modules", "js-yaml")); } })();

// Timings fixed by the test, so the plan does not move with CI's numbers:
// every suite 5 s, the heavy ones what they really take.
const { discover } = require("./lib/suites");
const SUITES = discover().run;
const TIMINGS = path.join(TMP, "timings.json");
fs.writeFileSync(TIMINGS, JSON.stringify({ suites: Object.fromEntries(SUITES.map(s => [s, s === "tenant-matrix" ? 276 : 5])) }));

function planFor(files, extra = []) {
  const out = execFileSync("node", [SCRIPT, "--dry-run", "--json", "--no-fetch", "--timings", TIMINGS, "--files", files, ...extra],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, AFFECTED_SLOT_DIR: path.join(TMP, "unused") } });
  return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
}

(async () => {
  console.log("\n§1 · one server route changed: its suites run, tenant-matrix is CI's");
  const route = planFor("routes/give.js");
  for (const s of ["give2-fee-footing", "clock-boundaries"]) ok(route.run.includes(s), `routes/give.js picks ${s} (it calls /give routes)`);
  ok(!route.run.includes("tenant-matrix"), "routes/give.js does not run tenant-matrix locally");
  ok(route.skipped.some(x => x.suite === "tenant-matrix" && /heavy.*CI runs it/.test(x.because)), "tenant-matrix is listed as skipped: heavy, CI runs it");
  ok(!route.run.includes("smoke-walk"), "smoke-walk never runs locally for a route change");
  const auctions = planFor("routes/auctions.js");
  ok(auctions.run.includes("parity2-auction") && auctions.run.includes("fix20-auction-double-checkout"), "routes/auctions.js picks the auction suites");
  ok(!auctions.run.includes("give2-fee-footing"), "…and not the giving-page suites");

  console.log("\n§2 · tenant-matrix's own file runs tenant-matrix; the budget holds");
  const own = planFor("tests/tenant-matrix.test.js");
  ok(own.run.includes("tenant-matrix"), "a change to tests/tenant-matrix.test.js runs tenant-matrix");
  const broad = planFor("db.js");
  ok(broad.estimate <= 600, `a shared-surface change plans within 600 s (got ${broad.estimate})`);
  ok(broad.run.length > 0 && broad.skipped.some(x => /past the budget/.test(x.because)), "a shared-surface change runs the fastest suites and leaves the rest to CI");
  const docs = planFor("docs/history/X.md");
  ok(docs.run.length === 0, "a docs-only change runs nothing");

  console.log("\n§3 · two runs at once both proceed; nobody waits past the limit");
  const SLOTS = path.join(TMP, "slots");
  const launch = (tag, env = {}) => new Promise(res => {
    const t0 = performance.now();
    let out = "";
    const p = spawn("node", [SCRIPT, "--dry-run", "--no-fetch", "--timings", TIMINGS, "--files", "docs/x.md"], {
      cwd: ROOT, env: { ...process.env, AFFECTED_SLOT_DIR: SLOTS, STEWARD_WT_TAG: tag, AFFECTED_HOLD_MS: "4000", ...env },
    });
    p.stdout.on("data", d => { out += d; if (!p.tookAt && /slot \d of 2/.test(out)) p.tookAt = performance.now() - t0; });
    p.on("exit", code => res({ code, out, tookAt: p.tookAt, secs: (performance.now() - t0) / 1000 }));
  });
  const a = launch("wt_a"), b = launch("wt_b");
  await new Promise(r => setTimeout(r, 1500));
  const c = launch("wt_c", { AFFECTED_WAIT_S: "1" });
  const same = launch("wt_a", { AFFECTED_WAIT_S: "1" });
  const [ra, rb, rc, rs] = await Promise.all([a, b, c, same]);
  ok(ra.code === 0 && rb.code === 0, "both runs exit 0");
  ok(ra.tookAt != null && rb.tookAt != null && ra.tookAt < 1500 && rb.tookAt < 1500, `both took a slot at once (${ra.tookAt} ms, ${rb.tookAt} ms), neither waited on the other`);
  ok(!/busy/.test(ra.out + rb.out), "neither said it was waiting");
  ok(rc.code === 0 && /no slot after \d+s\. Skipping to the push/.test(rc.out), "a third run, with both slots held, skips to the push and exits 0");
  ok(rc.secs < 5, `…after its wait limit, not longer (${rc.secs.toFixed(1)} s)`);
  ok(/this worktree's own run/.test(rs.out) && /Skipping to the push/.test(rs.out), "a second run in the same worktree waits on the first, never beside it");
  ok(fs.readdirSync(SLOTS).filter(f => f.endsWith(".lock")).length === 0, "every slot is released afterwards");
  const src = fs.readFileSync(SCRIPT, "utf8");
  ok(/AFFECTED_WAIT_S \|\| "120"/.test(src), "the wait limit is two minutes");
  ok(/BATTERY_LOCK: "0"/.test(src), "a run takes a slot, not the machine-wide battery lock");

  console.log("\n§4 · ci.yml: stale PR runs cancelled, main never cancelled, the gate as strict");
  let ci;
  try { ci = yaml.load(fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")); ok(true, "ci.yml parses"); }
  catch (e) { ok(false, "ci.yml parses: " + e.message); ci = { jobs: {} }; }
  const conc = ci.concurrency || {};
  const cancel = String(conc["cancel-in-progress"]);
  ok(cancel === "${{ github.event_name == 'pull_request' }}", `cancel-in-progress is true only for a pull request (${cancel})`);
  const group = String(conc.group || "");
  ok(/github\.event_name == 'pull_request' && format\('ci-\{0\}', github\.head_ref \|\| github\.ref\)/.test(group), "a pull request's group is ci-<its branch>");
  ok(/\|\| format\('ci-main-\{0\}', github\.run_id\)/.test(group), "a push's group is its own run id: no main run is ever cancelled or queued behind another");
  for (const [name, job] of Object.entries(ci.jobs || {})) ok(!job.concurrency || !/true/.test(String(job.concurrency["cancel-in-progress"])), `job ${name} cancels nothing of its own`);
  const test = Object.values(ci.jobs || {}).find(j => j.name === "test") || {};   // the job `combine`, named `test` (the required check)
  ok(["guards", "semgrep", "plan", "shard"].every(j => (test.needs || []).includes(j)), "the test gate still waits for guards, semgrep, the plan and every shard");
  const gate = (test.steps || []).map(s => s.run || "").join("\n");
  ok(/needs\.guards\.result \}\}" = "success"/.test(gate) && /needs\.semgrep\.result/.test(gate) && /needs\.plan\.result/.test(gate), "…and fails unless guards, semgrep and the plan succeeded");
  ok(/every-test-runs\.test\.js/.test(gate) && /shard-combine\.js/.test(gate), "…and still checks every suite ran once and no count dropped");

  console.log("\n§5 · a browser suite runs with its client built and served, or is skipped saying so");
  const A = require(SCRIPT);
  const fakePw = path.join(TMP, "pw");
  fs.mkdirSync(path.join(fakePw, "node_modules", "playwright"), { recursive: true });
  const withEnv = (vars, fn) => { const old = {}; for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
    try { return fn(); } finally { for (const k of Object.keys(old)) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k]; } } };
  const lagPlan = () => ({ ...planFor("tests/lag1.test.js"), run: [{ suite: "lag1", tier: "own", reason: "tests/lag1.test.js", secs: 5 }], skipped: [] });
  const ready = withEnv({ BASE: null, AFFECTED_NO_BROWSER: null, PLAYWRIGHT_DIR: fakePw }, () => { const p = lagPlan(); const leg = A.browserLeg(p); return { p, leg, env: A.runEnv(p, leg.browser, null) }; });
  if (fs.existsSync(path.join(ROOT, "client", "node_modules"))) {
    ok(ready.leg.browser.includes("lag1") && ready.p.run.some(r => r.suite === "lag1"), "a change to lag1 (a browser suite) runs lag1 when Playwright and the client's modules are there");
    ok(ready.env.SHARD_BUILD_DIST === "1" && ready.env.SHARD_PREVIEW === "1" && ready.env.SHARD_BROWSER_SUITES === "lag1",
      "…with the client built and a preview started for it, and the shard told which suites need it");
  } else ok(true, "(no client/node_modules here: the ready case is checked where the client is installed)");
  const none = withEnv({ BASE: null, AFFECTED_NO_BROWSER: "Playwright is not installed here" }, () => { const p = lagPlan(); const leg = A.browserLeg(p); return { p, leg, env: A.runEnv(p, leg.browser, null) }; });
  ok(!none.p.run.some(r => r.suite === "lag1") && none.p.skipped.some(r => r.suite === "lag1" && /a browser suite, and Playwright is not installed here\. CI will run it/.test(r.because)),
    "when it cannot run, lag1 is skipped with the reason and \"CI will run it\", never started half-ready");
  ok(none.leg.said.some(l => /skip lag1: a browser suite.*CI will run it\./.test(l)), "…and the run says so in one line");
  const plain = A.runEnv({ run: [{ suite: "tasks" }] }, [], null);
  ok(plain.SHARD_BUILD_DIST === "0" && plain.SHARD_PREVIEW === "0", "a run with no browser suite still builds no client");
  const sh = fs.readFileSync(path.join(ROOT, "tests", "shard.sh"), "utf8");
  ok(/browser_unready=/.test(sh) && /SHARD_BROWSER_SUITES/.test(sh) && /CI will run it/.test(sh), "the shard waits for its preview and skips a browser suite it could not serve, saying so");

  fs.rmSync(TMP, { recursive: true, force: true });
  summary();
})();
