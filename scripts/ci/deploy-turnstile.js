#!/usr/bin/env node
// FLAKE-1 · EVERY MERGE TO MAIN DEPLOYS, IN ORDER, AND THE LATEST ENDS UP LIVE.
//
// Until FLAKE-1 both deploy jobs sat in ONE concurrency group, `deploy-main`,
// with cancel-in-progress: false. GitHub keeps at most one RUNNING and one
// PENDING job per group, and a newer pending job CANCELS the older pending
// one. So when two merges landed close together, run A's deploy-railway ran,
// A's deploy-vercel waited, B's deploy-railway arrived and cancelled A's
// Vercel deploy, and B's deploy-vercel then cancelled B's Railway deploy: a
// merge's backend never shipped, and the two halves could end on different
// commits. A group cannot queue more than one job, at any setting.
//
// Now each deploy job has its own group per commit (nothing is ever cancelled
// by another merge), and this script is the queue. Before a deploy job deploys:
//   1. it waits until every OLDER push-to-main run of this workflow has
//      finished its job of the same name (or finished altogether), so deploys
//      go out one at a time in merge order;
//   2. it reads which commit is live, and if that commit is NEWER than this one
//      (a re-run of an old run, say) it does not deploy, so the latest merge
//      is always the one left live.
// It writes `deploy=true|false` to $GITHUB_OUTPUT and says why in the summary.
// Read-only: the GitHub Actions API, git, and the live site's public build
// stamp (/health's buildSha, or the build-sha meta tag). No secret, no app call.
//
// usage: node scripts/ci/deploy-turnstile.js --job deploy-railway --live-health <url>
//        node scripts/ci/deploy-turnstile.js --job deploy-vercel  --live-meta <url>
// env:   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const JOB = arg("--job");
const MAX_WAIT_MS = Number(arg("--max-wait-min", "50")) * 60000;
const POLL_MS = Number(arg("--poll-s", "20")) * 1000;
const { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: RUN_ID, GITHUB_SHA: SHA } = process.env;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = (line) => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); };
const output = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const gh = (path) => JSON.parse(execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path], { encoding: "utf8" }));

// The older push-to-main runs of this workflow whose `JOB` has not finished.
function olderUnfinished(me) {
  const runs = gh(`repos/${REPO}/actions/workflows/${me.workflow_id}/runs?branch=main&event=push&per_page=40`).workflow_runs || [];
  const older = runs.filter(r => r.run_number < me.run_number && r.status !== "completed");
  const blocking = [];
  for (const r of older) {
    const jobs = gh(`repos/${REPO}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`).jobs || [];
    const j = jobs.find(x => x.name === JOB);
    if (j && j.status === "completed") continue;   // its deploy is done; the rest of its run does not matter
    blocking.push({ run: r.run_number, id: r.id, sha: r.head_sha.slice(0, 7), job: j ? j.status : "not started" });
  }
  return blocking;
}

async function liveSha() {
  const health = arg("--live-health"), meta = arg("--live-meta");
  try {
    if (health) return (await (await fetch(health, { signal: AbortSignal.timeout(10000) })).json()).buildSha || null;
    if (meta) return ((await (await fetch(meta, { signal: AbortSignal.timeout(10000) })).text()).match(/name="build-sha" content="([0-9a-f]{40})"/) || [])[1] || null;
  } catch { /* unreachable: deploy, the verify step will say what it sees */ }
  return null;
}
const isAncestor = (a, b) => { try { execFileSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; } catch { return false; } };

(async () => {
  if (!JOB || !REPO || !RUN_ID || !SHA) { console.error("deploy-turnstile: --job, GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_SHA are required"); process.exit(2); }
  const t0 = Date.now();
  let me = null, last = "", waitedBehind = false;
  for (;;) {
    // A blip in the Actions API is waited out, never a failed deploy.
    let blocking;
    try { me = me || gh(`repos/${REPO}/actions/runs/${RUN_ID}`); blocking = olderUnfinished(me); }
    catch (e) {
      if (Date.now() - t0 > MAX_WAIT_MS) throw e;
      console.log(`the Actions API did not answer (${String(e.message).split("\n")[0].slice(0, 160)}); asking again in ${POLL_MS / 1000} s`);
      await sleep(POLL_MS); continue;
    }
    if (!blocking.length) break;
    const line = blocking.map(b => `run #${b.run} (${b.sha}, ${JOB} ${b.job})`).join(", ");
    waitedBehind = true;
    if (line !== last) { console.log(`${JOB} for run #${me.run_number} waits its turn behind ${line}`); last = line; }
    if (Date.now() - t0 > MAX_WAIT_MS) {
      say(`::error::${JOB} waited ${Math.round(MAX_WAIT_MS / 60000)} min behind ${line} and is NOT deployed. Re-run this job once those finish.`);
      process.exit(1);
    }
    await sleep(POLL_MS);
  }
  const waited = Math.round((Date.now() - t0) / 1000);
  const live = await liveSha();
  if (live && live !== SHA && isAncestor(SHA, live)) {
    say(`${JOB}: live is ${live.slice(0, 7)}, which is newer than ${SHA.slice(0, 7)} (this run is a re-run of an older merge). Not deploying, so the latest merge stays live.`);
    output("deploy", "false");
    return;
  }
  say(`${JOB}: run #${me.run_number} (${SHA.slice(0, 7)}) deploys${waitedBehind ? ` after waiting ${waited} s for the merges before it` : ""}; live was ${live ? live.slice(0, 7) : "unknown"}.`);
  output("deploy", "true");
})().catch(e => { console.error(`deploy-turnstile: ${e.message}`); process.exit(1); });
