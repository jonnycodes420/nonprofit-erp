// tests/stage3-walk-window.test.js · STAGE-3. STAGING HOLDS STILL WHILE THE FLEET WALKS IT.
//
// Guards what reaches staging, and when: a deploy in the middle of the
// overnight walk wipes out whole areas of the fleet's run (11 and 12 Nov). Merges
// stay instant; only deploy-staging holds, and deploy-staging-release puts the
// LATEST held merge out after the window.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red before the green
// was trusted):
//   · inside the window deploying immediately (decideHold → hold:false)     → §1, §4
//   · the across-midnight wrap dropped (00:45 ET read as outside)           → §1
//   · the window read in UTC or a fixed offset (wrong side of a DST change) → §2
//   · two waiting merges releasing the OLDER one                            → §3, §5
//   · a release while a newer merge is deploying itself, or of a commit
//     staging already has                                                  → §3
//   · a cron line that never lands just after the window's end in EST or EDT → §6
//   · deploy-staging deploying without asking the hold, or the walk running
//     after a hold                                                          → §7
//   · (PIPE-1) the release waiting on GitHub's schedule: no workflow_run on
//     CI's push runs, so a 1 AM merge stays held after a 9 AM push         → §8
//
// No server, no database: the pure rules, then the two scripts run against a
// stub `gh` on PATH and a fake staging /health. Tests set their own clock.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync, spawn } = require("child_process");
const W = require("../scripts/lib/stagingWindow");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 400) : "")); }
}
const at = iso => new Date(iso);
const SHA = c => c.repeat(40);

(async () => {
  console.log("§1 · the window, across midnight (default 23:30-03:15 America/New_York; 12 Nov is EST, UTC-5)");
  const hold = iso => W.decideHold({ now: at(iso), window: undefined }).hold;
  ok("11:29 PM ET → deploys", !hold("2026-11-12T04:29:00Z"));
  ok("11:30 PM ET → holds", hold("2026-11-12T04:30:00Z"));
  ok("11:36 PM ET (SALES-2's deploy on 11 Nov) → holds", hold("2026-11-12T04:36:00Z"));
  ok("12:45 AM ET (ATLAS-7's deploy on 12 Nov) → holds", hold("2026-11-12T05:45:00Z"));
  ok("3:14 AM ET → holds", hold("2026-11-12T08:14:00Z"));
  ok("3:15 AM ET → deploys", !hold("2026-11-12T08:15:00Z"));
  ok("noon ET → deploys", !hold("2026-11-12T17:00:00Z"));
  const d = W.decideHold({ now: at("2026-11-12T05:45:00Z"), window: "" });
  ok("the hold says so in the summary's words", d.line === "Holding the staging deploy until 3:15 AM ET so the overnight walk isn't interrupted.", d.line);
  ok("a commit the release marked Released deploys inside the window (its re-run)", !W.decideHold({ now: at("2026-11-12T05:45:00Z"), released: true }).hold);
  ok("the repo variable moves the window (01:00-02:00 ET: 12:45 AM deploys)", !W.decideHold({ now: at("2026-11-12T05:45:00Z"), window: "01:00-02:00 America/New_York" }).hold);
  let threw = null; try { W.parseWindow("late night"); } catch (e) { threw = e.message; }
  ok("a window that does not parse stops the job rather than deploying", /is not like/.test(threw || ""), threw);

  console.log("\n§2 · DST: the window is wall-clock ET on both sides of a change");
  ok("summer (EDT, UTC-4): 3:10 AM is 07:10 UTC → holds", hold("2026-07-15T07:10:00Z"));
  ok("summer: 3:20 AM is 07:20 UTC → deploys", !hold("2026-07-15T07:20:00Z"));
  ok("winter: 07:20 UTC is 2:20 AM EST → holds", hold("2026-11-12T07:20:00Z"));
  ok("fall back, 1 Nov 2026: 1:45 AM EDT (05:45 UTC) holds", hold("2026-11-01T05:45:00Z"));
  ok("…and 1:45 AM EST, the hour again (06:45 UTC), holds", hold("2026-11-01T06:45:00Z"));
  ok("…3:20 AM EST (08:20 UTC) deploys", !hold("2026-11-01T08:20:00Z"));
  ok("spring forward, 8 Mar 2026: 1:59 AM EST (06:59 UTC) holds", hold("2026-03-08T06:59:00Z"));
  ok("…3:20 AM EDT (07:20 UTC) deploys", !hold("2026-03-08T07:20:00Z"));
  ok("an unknown time zone stops the job", (() => { try { W.parseWindow("23:30-03:15 Mars/Olympus"); return false; } catch { return true; } })());

  console.log("\n§3 · the release picks the LATEST held merge, and only one staging lacks");
  const live = SHA("a");
  const newer = new Set([SHA("b"), SHA("c"), SHA("d")]);
  const isNewer = s => newer.has(s);
  const run = (n, c, status = "completed", conclusion = "success") => ({ runNumber: n, sha: SHA(c), job: { id: 1000 + n, status, conclusion } });
  const two = W.pickRelease({ runs: [run(10, "b"), run(11, "c")], newerThanLive: isNewer });
  ok("two held merges → the newer one (run #11) goes out", two.pick && two.pick.runNumber === 11, two);
  ok("…and the older one is marked as released inside it", two.superseded.length === 1 && two.superseded[0].runNumber === 10, two.superseded);
  const order = W.pickRelease({ runs: [run(11, "c"), run(10, "b")], newerThanLive: isNewer });
  ok("the order the API lists them in does not matter", order.pick && order.pick.runNumber === 11);
  const failedLatest = W.pickRelease({ runs: [run(10, "b"), run(11, "c"), run(12, "d", "completed", "skipped")], newerThanLive: isNewer });
  ok("a newer merge whose tests failed (deploy-staging skipped) is never released", failedLatest.pick && failedLatest.pick.runNumber === 11, failedLatest);
  ok("staging already has the latest → nothing", W.pickRelease({ runs: [run(9, "a")], newerThanLive: isNewer }).pick === null);
  ok("a newer merge mid-deploy-staging → nothing (it deploys itself)", W.pickRelease({ runs: [run(10, "b"), run(11, "c", "in_progress", null)], newerThanLive: isNewer }).pick === null);
  ok("no runs → nothing", W.pickRelease({ runs: [], newerThanLive: isNewer }).pick === null);
  ok("inside the window a scheduled release waits", !W.decideRelease({ now: at("2026-11-12T07:20:00Z") }).go);
  ok("after the window it releases", W.decideRelease({ now: at("2026-11-12T08:20:00Z") }).go);
  ok("force: true releases inside the window", W.decideRelease({ now: at("2026-11-12T05:45:00Z"), force: true }).go);

  // ── the two scripts against a stub gh and a fake staging ──────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stage3-"));
  const bin = path.join(tmp, "bin"); fs.mkdirSync(bin);
  const fixture = path.join(tmp, "gh.json"), log = path.join(tmp, "gh.log");
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2).filter((a, i, all) => a !== "-H" && all[i - 1] !== "-H");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const fx = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, "utf8"));
const p = args.find(a => a.startsWith("repos/")) || "";
for (const [re, body] of fx) if (new RegExp(re).test(p)) { process.stdout.write(JSON.stringify(body)); process.exit(0); }
process.stdout.write("{}");
`, { mode: 0o755 });
  const env = extra => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "acme/steward", GH_TOKEN: "x",
    GITHUB_STEP_SUMMARY: path.join(tmp, "summary.md"), GITHUB_OUTPUT: path.join(tmp, "out.txt"), STAGING_WALK_WINDOW: "", ...extra });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []);
  const reset = fx => { fs.writeFileSync(fixture, JSON.stringify(fx)); for (const f of [log, path.join(tmp, "out.txt"), path.join(tmp, "summary.md")]) fs.rmSync(f, { force: true }); };
  const outTxt = () => (fs.existsSync(path.join(tmp, "out.txt")) ? fs.readFileSync(path.join(tmp, "out.txt"), "utf8") : "");
  const summaryTxt = () => (fs.existsSync(path.join(tmp, "summary.md")) ? fs.readFileSync(path.join(tmp, "summary.md"), "utf8") : "");

  console.log("\n§4 · staging-hold.js, as deploy-staging runs it");
  reset([["/statuses\\?", []]]);
  let r = spawnSync("node", ["scripts/ci/staging-hold.js"], { cwd: ROOT, env: env({ GITHUB_SHA: SHA("c"), STAGING_HOLD_NOW: "2026-11-12T05:45:00Z" }), encoding: "utf8" });
  ok("12:45 AM ET: deploy=false", r.status === 0 && /deploy=false/.test(outTxt()), r.stderr || outTxt());
  ok("the job summary says it is holding until 3:15 AM ET", /Holding the staging deploy until 3:15 AM ET so the overnight walk isn't interrupted\./.test(summaryTxt()));
  const marked = calls().find(a => a.includes(`repos/acme/steward/statuses/${SHA("c")}`));
  ok("the commit is marked staging/deploy pending \"Held until 3:15 AM ET (overnight walk)\"", marked && marked.includes("state=pending") && marked.includes("context=staging/deploy") && marked.includes("description=Held until 3:15 AM ET (overnight walk)"), marked);
  reset([["/statuses\\?", []]]);
  r = spawnSync("node", ["scripts/ci/staging-hold.js"], { cwd: ROOT, env: env({ GITHUB_SHA: SHA("c"), STAGING_HOLD_NOW: "2026-11-12T17:00:00Z" }), encoding: "utf8" });
  ok("noon ET: deploy=true and nothing marked", r.status === 0 && /deploy=true/.test(outTxt()) && !calls().some(a => a.includes("state=pending")), outTxt());
  reset([["/statuses\\?", [{ context: "staging/deploy", state: "success", description: "Released after the overnight walk" }]]]);
  r = spawnSync("node", ["scripts/ci/staging-hold.js"], { cwd: ROOT, env: env({ GITHUB_SHA: SHA("c"), STAGING_HOLD_NOW: "2026-11-12T05:45:00Z" }), encoding: "utf8" });
  ok("a released commit's re-run deploys inside the window", r.status === 0 && /deploy=true/.test(outTxt()), outTxt());

  console.log("\n§5 · staging-release.js re-runs the newer of two held merges");
  let healthEnv = "staging";
  const srv = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ buildSha: live, env: healthEnv })); });
  await new Promise(ok_ => srv.listen(0, "127.0.0.1", ok_));
  const api = `http://127.0.0.1:${srv.address().port}`;
  const runsFx = [
    ["/actions/workflows/ci.yml/runs", { workflow_runs: [
      { id: 501, run_number: 11, status: "completed", head_sha: SHA("c") },
      { id: 500, run_number: 10, status: "completed", head_sha: SHA("b") },
      { id: 499, run_number: 9, status: "completed", head_sha: live }] }],
    ["/runs/501/jobs", { jobs: [{ id: 9011, name: "deploy-staging", status: "completed", conclusion: "success" }] }],
    ["/runs/500/jobs", { jobs: [{ id: 9010, name: "deploy-staging", status: "completed", conclusion: "success" }] }],
    ["/runs/499/jobs", { jobs: [{ id: 9009, name: "deploy-staging", status: "completed", conclusion: "success" }] }],
    [`/compare/${live}\\.\\.\\.${live}`, { status: "identical" }],
    ["/compare/", { status: "ahead" }],
  ];
  const release = extra => new Promise(done => {
    const c = spawn("node", ["scripts/ci/staging-release.js"], { cwd: ROOT, env: env({ STAGING_API_URL: api, ...extra }) });
    let out = ""; c.stdout.on("data", b => (out += b)); c.stderr.on("data", b => (out += b));
    c.on("close", code => done({ code, out }));
  });
  reset(runsFx);
  let rr = await release({ STAGING_RELEASE_NOW: "2026-11-12T08:20:00Z" });
  const rerun = calls().filter(a => a.includes("POST") && a.some(x => /\/rerun$/.test(x)));
  ok("3:20 AM ET: exactly one re-run, of run #11's deploy-staging (job 9011)", rr.code === 0 && rerun.length === 1 && rerun[0].includes("repos/acme/steward/actions/jobs/9011/rerun"), { rerun, out: rr.out });
  const rel = calls().find(a => a.includes(`repos/acme/steward/statuses/${SHA("c")}`));
  ok("the newer commit is marked Released before the re-run (so its hold step deploys)", rel && rel.includes("state=success") && rel.some(x => /^description=Released after the overnight walk$/.test(x)), rel);
  const sup = calls().find(a => a.includes(`repos/acme/steward/statuses/${SHA("b")}`));
  ok("the older held commit is marked released with it, never re-run", sup && sup.some(x => x === `description=Released with ${SHA("c").slice(0, 7)}`) && !calls().some(a => a.some(x => /jobs\/9010\/rerun/.test(x))), sup);
  reset(runsFx);
  rr = await release({ STAGING_RELEASE_NOW: "2026-11-12T07:20:00Z" });
  ok("2:20 AM EST (the 07:20 UTC cron in winter): no re-run, no mark", rr.code === 0 && !calls().some(a => a.includes("POST") || a.some(x => /^state=/.test(x))), rr.out);
  reset(runsFx);
  rr = await release({ STAGING_RELEASE_NOW: "2026-11-12T05:45:00Z", FORCE: "true", GITHUB_ACTOR: "jonnycodes420" });
  ok("force: true at 12:45 AM ET re-runs run #11 now", rr.code === 0 && calls().some(a => a.includes("repos/acme/steward/actions/jobs/9011/rerun")), rr.out);
  reset(runsFx);
  healthEnv = "production";
  rr = await release({ STAGING_RELEASE_NOW: "2026-11-12T08:20:00Z" });
  ok("a STAGING_API_URL whose /health says production: stops, re-runs nothing", rr.code === 1 && !calls().some(a => a.includes("POST")), rr.out);
  healthEnv = "staging";

  // PIPE-1: on 13 Nov GitHub ran the 3:20 AM release at 10:24 AM. A merge held
  // at 1 AM ET, NO scheduled run all morning, and one push at 9 AM ET whose CI
  // went red (so its own deploy-staging never ran): CI finishing that run must
  // start the release (workflow_run), and the release must put the 1 AM merge out.
  console.log("\n§8 · PIPE-1: held at 1 AM, no scheduled run, a push at 9 AM releases it");
  const relWf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy-staging-release.yml"), "utf8");
  const onBlock = (/^on:\n((?:  .*\n|\n)+)/m.exec(relWf) || [])[1] || "";
  const wr = (/^  workflow_run:\n((?:    .*\n)+)/m.exec(onBlock) || [])[1] || "";
  ok("CI finishing a run on main starts the release (workflow_run: CI, completed, main)",
    /workflows: \[CI\]/.test(wr) && /types: \[completed\]/.test(wr) && /branches: \[main\]/.test(wr), onBlock);
  ok("…only CI's runs of a push to main count (not a PR's, not a merge-queue run's)",
    /github\.event_name != 'workflow_run' \|\| github\.event\.workflow_run\.event == 'push'/.test(relWf));
  const morningFx = [
    ["/actions/workflows/ci.yml/runs", { workflow_runs: [
      { id: 513, run_number: 13, status: "completed", head_sha: SHA("e"), event: "push" },   // 9:00 AM ET push, CI red
      { id: 512, run_number: 12, status: "completed", head_sha: SHA("d"), event: "push" },   // 1:00 AM ET merge, held
      { id: 499, run_number: 9, status: "completed", head_sha: live, event: "push" }] }],
    ["/runs/513/jobs", { jobs: [{ id: 9013, name: "deploy-staging", status: "completed", conclusion: "skipped" }] }],
    ["/runs/512/jobs", { jobs: [{ id: 9012, name: "deploy-staging", status: "completed", conclusion: "success" }] }],
    ["/runs/499/jobs", { jobs: [{ id: 9009, name: "deploy-staging", status: "completed", conclusion: "success" }] }],
    [`/compare/${live}\\.\\.\\.${live}`, { status: "identical" }],
    ["/compare/", { status: "ahead" }],
  ];
  reset(morningFx);
  rr = await release({ STAGING_RELEASE_NOW: "2026-11-12T06:00:00Z", GITHUB_EVENT_NAME: "workflow_run" });
  ok("1:00 AM ET, CI finishing the held merge's own run: still inside the window, nothing re-run", rr.code === 0 && !calls().some(a => a.includes("POST")), rr.out);
  reset(morningFx);
  rr = await release({ STAGING_RELEASE_NOW: "2026-11-12T14:30:00Z", GITHUB_EVENT_NAME: "workflow_run" });
  const morning = calls().filter(a => a.includes("POST") && a.some(x => /\/rerun$/.test(x)));
  ok("9:30 AM ET, CI finishing the 9 AM push: the 1 AM merge's deploy-staging (job 9012) is re-run, once",
    rr.code === 0 && morning.length === 1 && morning[0].includes("repos/acme/steward/actions/jobs/9012/rerun"), { morning, out: rr.out });
  srv.close();

  console.log("\n§6 · the release cron lands just after the window's end in EST and in EDT");
  const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy-staging-release.yml"), "utf8");
  const cron = (/cron: "([^"]+)"/.exec(wf) || [])[1] || "";
  const [mins, hours] = cron.split(" ");
  const times = hours && mins ? [].concat(...expand(hours).map(h => expand(mins).map(m => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`))) : [];
  ok("the workflow's cron is the module's RELEASE_CRON_UTC", JSON.stringify(times) === JSON.stringify(W.RELEASE_CRON_UTC), { cron, times });
  let worst = 0;
  for (let day = 0; day < 366; day++) {
    const date = new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString().slice(0, 10);
    const first = times.map(t => at(`${date}T${t}:00Z`)).find(t => !W.inWindow(t, W.parseWindow(W.DEFAULT_WINDOW)));
    const lateBy = first ? (W.wallMinutes(first, "America/New_York") - (3 * 60 + 15)) : 999;
    worst = Math.max(worst, lateBy);
  }
  ok("every night of 2026, a scheduled run lands outside the window within 10 minutes of 3:15 AM ET", worst >= 0 && worst <= 10, worst);
  ok("the release workflow cancels an earlier waiting run and only acts with STAGING_ENABLED", /group: deploy-staging-release/.test(wf) && /cancel-in-progress: true/.test(wf) && /vars\.STAGING_ENABLED == 'true'/.test(wf));
  ok("it can be dispatched by hand with force", /workflow_dispatch:/.test(wf) && /force:/.test(wf) && /FORCE: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.force \}\}/.test(wf));
  ok("it holds no deploy secret: it only re-runs ci.yml's job", !/secrets\./.test(wf));

  console.log("\n§7 · ci.yml's deploy-staging asks the hold before it deploys; the walk follows only a deploy");
  const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const a = yml.indexOf("\n  deploy-staging:\n"), b = yml.indexOf("\n  staging-walk:\n");
  const blk = yml.slice(a, b);
  const steps = blk.split("\n      - name: ").slice(1);
  const iHold = steps.findIndex(s => /node scripts\/ci\/staging-hold\.js/.test(s));
  const iTurn = steps.findIndex(s => /deploy-turnstile\.js/.test(s));
  ok("the hold step runs after the turnstile (the moment it would deploy)", iHold > iTurn && iTurn >= 0, { iHold, iTurn });
  const after = steps.slice(iHold + 1).filter(s => !/^A failed staging deploy/.test(s));
  ok("every step after it runs only when the hold said deploy", after.length >= 5 && after.every(s => /if: steps\.hold\.outputs\.deploy == 'true'/.test(s)), after.map(s => s.split("\n")[0]));
  ok("the window comes from the repo variable STAGING_WALK_WINDOW", /STAGING_WALK_WINDOW: \$\{\{ vars\.STAGING_WALK_WINDOW \}\}/.test(steps[iHold] || ""));
  ok("deployed is true only when the turnstile AND the hold said deploy (so staging-walk skips a hold)",
    /deployed: \$\{\{ steps\.turn\.outputs\.deploy == 'true' && steps\.hold\.outputs\.deploy == 'true' \}\}/.test(blk) && /needs\.deploy-staging\.outputs\.deployed == 'true'/.test(yml.slice(b)));
  ok("the hotfix lane's prod jobs never ask the hold", !/staging-hold/.test(yml.slice(yml.indexOf("\n  deploy-railway:\n"), yml.indexOf("\n  drift:\n"))));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// "20,50" → [20, 50]; "7-9" → [7, 8, 9]
function expand(field) {
  return [].concat(...field.split(",").map(p => { const m = /^(\d+)-(\d+)$/.exec(p); if (!m) return [Number(p)]; const out = []; for (let i = +m[1]; i <= +m[2]; i++) out.push(i); return out; }));
}
