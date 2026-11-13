// tests/pipe1-pipeline.test.js · PIPE-1. MERGES LINE UP, AND MAIN FIXES ITSELF.
// The build's one new test. It guards money (the truth check that holds Home's
// figures to the ledger) and the gate every change to money, donors and mail
// goes through (CI, the merge queue, the runner).
//
// 12 to 13 Nov: GitHub moved ubuntu-latest to 26.04 and Chromium crashed, so
// nothing merged for 14 hours; then polish4-units went red on main's own code
// because the day's dollar gap landed on exactly $x.50 and the truth check
// rounded differently from Home; then every merge rebased every open PR and
// restarted its 25-minute CI.
//
//   §1 CI runs on the merge queue's merge_group events, with the same required
//      check (`test`) and nothing deploying from it; automerge enqueues a green
//      PR when main requires the queue, and keep-current stops rebasing then.
//   §2 the truth check rounds Home's whole dollars with the app's own function
//      (shared/numbers/wholeDollars.js): fixed gaps, then the whole stack at
//      three fixed calendar dates, each with a gap of exactly -$10,149.50.
//   §3 the runner canary: a canary that did not pass is never green, and an
//      image name with no runner is red in minutes, not a quiet pass.
//   §4 every job but the canary stays on ubuntu-24.04.
//
// WHAT MAKES IT FAIL (each planted and watched go red): CI without
// `merge_group:` (§1); Math.round back in surfacesAgree's door check (§2, the
// half-dollar rows and dates); the canary pointed at an image that does not
// exist passing (§3); a job back on ubuntu-latest (§4). The release that waits
// on GitHub's schedule is guarded beside its siblings in
// tests/stage3-walk-window.test.js §8.
//
// §2's stacks need the scratch Postgres (DATABASE_URL); the rest needs nothing.
// Sends nothing. Made-up names. Tests set their own clock.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const WF = f => fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail !== undefined ? " — " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 600) : ""}`); }
};
// The top-level `on:` block, and one job's block, of a workflow file.
const onBlock = yml => (/^on:\n((?:  .*\n|\n)+)/m.exec(yml) || [])[1] || "";
const jobBlock = (yml, name) => {
  const a = yml.indexOf(`\n  ${name}:\n`);
  if (a < 0) return "";
  const rest = yml.slice(a + 1);
  const b = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return b < 0 ? rest : rest.slice(0, b + 1);
};
const jobIf = blk => { const m = /^    if: (.*(?:\n      .*)*)/m.exec(blk); return m ? m[1] : ""; };

(async () => {
  console.log("\n§1 · CI runs on the merge queue, and nothing deploys from it");
  const ci = WF("ci.yml");
  ok("ci.yml runs on merge_group (checks_requested)", /^  merge_group:\n    types: \[checks_requested\]/m.test(onBlock(ci)), onBlock(ci));
  ok("…and still on push to main and pull_request", /^  push:\n    branches: \[main\]/m.test(onBlock(ci)) && /^  pull_request:\n    branches: \[main\]/m.test(onBlock(ci)));
  const battery = ["tree-check", "guards", "semgrep", "plan", "shard", "combine"];
  for (const j of battery) {
    const cond = jobIf(jobBlock(ci, j));
    ok(`the battery's ${j} job is not limited to push or pull_request`, jobBlock(ci, j) && !/github\.event_name ==/.test(cond), cond);
  }
  ok("the required check is still named test", /\n  combine:\n    name: test\n/.test(ci));
  ok("a merge-queue run is never cancelled by another (only a PR's run is)", /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/.test(ci));
  for (const j of ["lane", "deploy-railway", "deploy-vercel", "deploy-staging", "drift", "playwright-cache"]) {
    ok(`${j} runs only on a push to main (never from the queue)`, /github\.event_name == 'push'/.test(jobIf(jobBlock(ci, j))), jobIf(jobBlock(ci, j)));
  }
  ok("a docs-only PR's queue run skips the battery too (base from merge_group)",
    /github\.event_name == 'merge_group'/.test(jobBlock(ci, "tree-check")) && /github\.event\.merge_group\.base_sha/.test(jobBlock(ci, "tree-check")));
  const am = WF("automerge.yml"), kc = WF("keep-current.yml");
  ok("automerge: with a merge_queue rule on main, a green PR joins the queue (no method flag)",
    /select\(\.type == "merge_queue"\)/.test(am) && /gh pr merge --auto "\$PR_URL"/.test(am));
  ok("automerge: without the rule, the old squash auto-merge", /gh pr merge --auto --squash --delete-branch "\$PR_URL"/.test(am));
  const kcRun = kc.slice(kc.indexOf("run: |"));
  const iRule = kcRun.indexOf('select(.type == "merge_queue")'), iUpdate = kcRun.indexOf("gh pr update-branch");
  ok("keep-current: with a merge_queue rule it exits before it rebases anything", iRule > 0 && iUpdate > iRule && /exit 0/.test(kcRun.slice(iRule, iUpdate)), { iRule, iUpdate });

  console.log("\n§2 · the truth check rounds Home's dollars with the app's own function");
  const { wholeDollars, wholeDollarCents, dollarsLabel } = require("../shared/numbers/wholeDollars");
  const { doorKeyCents } = require("./lib/surfacesAgree");
  const HL = await import("../shared/homeLead.js");
  // [gap in cents, what Home says, to the dollar]
  const rows = [[-1014950, -1015000], [1014950, 1015000], [-1014949, -1014900], [-1014951, -1015000], [-50, -100], [50, 100], [-49, 0], [6398400, 6398400]];
  for (const [gap, want] of rows) {
    ok(`a gap of ${(gap / 100).toFixed(2)} is held to ${(want / 100).toFixed(0)} (half away from zero)`, doorKeyCents(gap) === want && wholeDollarCents(gap) === want, doorKeyCents(gap));
  }
  ok("a door that shows cents is held to the cent", doorKeyCents(-1014950, "10,149.50") === -1014950);
  ok("wholeDollars: 2.675 → 3, -0.5 → -1, 0.49 → 0, -0.49 → 0", wholeDollars(2.675) === 3 && wholeDollars(-0.5) === -1 && wholeDollars(0.49) === 0 && Object.is(wholeDollars(-0.49), 0));
  ok("dollarsLabel: $10,150 and -$10,150", dollarsLabel(10149.5) === "$10,150" && dollarsLabel(-10149.5) === "-$10,150");
  const d = HL.doors({ compare: { label: "Giving this year", thisYear: 20000, lastYear: 30149.5 } });
  ok("Home's door for a gap of -$10,149.50 says $10,150 behind", d.why && d.why.line === "Giving this year is $10,150 behind last year at this point.", d);
  const shown = /is \$([\d,.]+) (behind|ahead of)/.exec((d.why && d.why.line) || "");
  ok("…and the truth check holds that sentence equal to the ledger's gap", shown && -Number(shown[1].replace(/,/g, "")) * 100 === doorKeyCents(-1014950), shown);
  ok("Home's money is shared/numbers/wholeDollars.js, not a rounding of its own", HL.money(10149.5) === dollarsLabel(10149.5) && /wholeDollarsMod\.dollarsLabel/.test(fs.readFileSync(path.join(ROOT, "shared", "homeLead.js"), "utf8")));

  if (!process.env.DATABASE_URL) {
    console.log("  SKIP  the full stack at fixed dates: no DATABASE_URL (CI's shards have one)");
    if (process.env.CI) ok("CI has a database for §2's stacks", false);
  } else {
    const { runAt, nextCalendarNoon } = require("./lib/pinnedStack");
    // Three fixed calendar dates (noon in New York, never in the past): early
    // spring, the last day of June, mid-September. None is in Home's year-end
    // season, so the door speaks; the fixture puts the gap on exactly -$10,149.50.
    for (const mmdd of ["03-02", "06-30", "09-15"]) {
      const at = nextCalendarNoon(mmdd);
      const code = await runAt(path.join(__dirname, "pipe1", "halfDollar.js"), at);
      ok(`at noon on ${new Date(at).toISOString().slice(0, 10)}, Home says $10,150 behind and every surface agrees`, code === 0, `exit ${code} (its PASS/FAIL lines are above)`);
    }
  }

  console.log("\n§3 · the runner canary is never green on a canary that did not pass");
  const { verdict } = require("../scripts/ci/runner-canary");
  const v = (job, waitedMin) => verdict({ job, image: "ubuntu-99.04", waitedMin, startMin: 20, runMin: 60 });
  ok("passed → green", v({ status: "completed", conclusion: "success" }, 5).ok === true);
  for (const c of ["failure", "cancelled", "skipped", "timed_out", null]) ok(`${c || "no conclusion"} → red`, v({ status: "completed", conclusion: c }, 5).ok === false && v({ status: "completed", conclusion: c }, 5).done);
  ok("still queued at 5 minutes → keep watching", v({ status: "queued" }, 5).done === false);
  const none = v({ status: "queued" }, 21);
  ok("an image with no runner (still queued at 21 minutes) → red, and says the name may not exist", none.done && none.ok === false && /may not exist/.test(none.line), none);
  ok("the job not listed at all after 21 minutes → red", v(null, 21).ok === false);
  ok("started and still running after 81 minutes → red", v({ status: "in_progress" }, 81).ok === false);
  // The watch script itself, against a stub gh: the canary job stuck queued.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pipe1-canary-"));
  const bin = path.join(tmp, "bin"); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env node
const a = process.argv.slice(2);
require("fs").appendFileSync(${JSON.stringify(path.join(tmp, "calls.log"))}, JSON.stringify(a) + "\\n");
if (a[0] === "api") process.stdout.write(JSON.stringify({ jobs: [{ name: "canary", status: "queued" }, { name: "watch", status: "in_progress" }] }));
else if (a[0] === "issue" && a[1] === "list") process.stdout.write("[]");
else process.stdout.write("https://github.com/acme/steward/issues/1\\n");
`, { mode: 0o755 });
  const r = spawnSync("node", ["scripts/ci/runner-canary.js"], { cwd: ROOT, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: "acme/steward", GITHUB_RUN_ID: "77", GH_TOKEN: "x",
      CANARY_IMAGE: "ubuntu-99.04", START_MIN: "0", OPEN_ISSUE: "true", GITHUB_STEP_SUMMARY: path.join(tmp, "summary.md") } });
  const calls = fs.existsSync(path.join(tmp, "calls.log")) ? fs.readFileSync(path.join(tmp, "calls.log"), "utf8") : "";
  ok("the canary on an image that does not exist: the watch exits 1 with an ::error::", r.status === 1 && /::error::No runner took the canary job on "ubuntu-99\.04"/.test(r.stderr), { status: r.status, err: r.stderr.slice(-300) });
  ok("…and opens an issue saying so", /"issue","create"/.test(calls) && /may not exist/.test(calls), calls.slice(-400));
  fs.rmSync(tmp, { recursive: true, force: true });
  const canary = WF("runner-canary.yml");
  ok("the canary runs weekly on ubuntu-latest (or the image asked for)", /^  schedule:\n    - cron: "[^"]+"/m.test(onBlock(canary)) && /runs-on: \$\{\{ inputs\.image \|\| 'ubuntu-latest' \}\}/.test(jobBlock(canary, "canary")));
  ok("it runs the Playwright install and a browser suite on that image", /install-playwright\.sh 1\.61\.1/.test(jobBlock(canary, "canary")) && /node tests\/screens1-parts\.test\.js/.test(jobBlock(canary, "canary")) && /REQUIRE_BROWSER: "1"/.test(canary));
  ok("the verdict runs on the pinned image and opens an issue on a scheduled run", /runs-on: ubuntu-24\.04/.test(jobBlock(canary, "watch")) && /issues: write/.test(jobBlock(canary, "watch")) && /OPEN_ISSUE: \$\{\{ github\.event_name == 'schedule'/.test(canary));

  console.log("\n§4 · every other job stays on ubuntu-24.04");
  const loose = [];
  for (const f of fs.readdirSync(path.join(ROOT, ".github", "workflows")).filter(f => /\.ya?ml$/.test(f) && f !== "runner-canary.yml")) {
    for (const m of WF(f).matchAll(/^\s+runs-on:\s*(.+)$/gm)) if (!/ubuntu-24\.04/.test(m[1])) loose.push(`${f}: ${m[1].trim()}`);
  }
  ok("no workflow but the canary runs on a moving image", loose.length === 0, loose);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
