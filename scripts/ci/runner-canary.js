#!/usr/bin/env node
// scripts/ci/runner-canary.js · PIPE-1. THE NEXT RUNNER IMAGE, TRIED BEFORE IT IS FORCED ON US.
//
// On 13 Nov GitHub moved ubuntu-latest to 26.04, Chromium crashed on launch,
// and nothing merged for 14 hours. Every job is pinned to ubuntu-24.04 now
// (CI-PIN-2404); runner-canary.yml runs the Playwright install and one browser
// suite on ubuntu-latest each week, so the next image change shows up as an
// issue days before it breaks the battery.
//
// The canary job runs ON the image being tried. This script runs beside it on
// ubuntu-24.04 and watches it, because an image that cannot run a job at all
// (a name GitHub has no runner for) leaves the job queued, which would read as
// nothing at all. So:
//   · the canary passed                        → green;
//   · it failed, was cancelled or was skipped  → red, and an issue;
//   · no runner picked it up within START_MIN  → red, and an issue ("no
//     runner took the job: the image name may not exist");
//   · it started but did not finish in RUN_MIN → red, and an issue.
// Never green on a canary that did not pass.
//
// usage: node scripts/ci/runner-canary.js
// env:   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, CANARY_IMAGE, CANARY_JOB (the
//        canary job's name), OPEN_ISSUE ("true"/"false"), START_MIN (20), RUN_MIN (60)
"use strict";
const fs = require("fs");
const { execFileSync } = require("child_process");

const ISSUE_TITLE = "Runner canary: the next ubuntu image fails our browser suite";

// The pure rule. `job` is the canary job as the API returns it (or null when the
// run has not listed it yet); `waitedMin` is how long the watch has waited.
function verdict({ job, image, waitedMin, startMin = 20, runMin = 60 }) {
  const img = String(image || "ubuntu-latest");
  if (job && job.status === "completed") {
    if (job.conclusion === "success") return { done: true, ok: true, line: `The canary passed on ${img}: Playwright installs and the browser suite is green.` };
    return { done: true, ok: false, line: `The canary ${job.conclusion || "ended without a result"} on ${img}: the Playwright install or the browser suite does not work there.` };
  }
  const started = !!(job && job.status === "in_progress");
  if (!started && waitedMin >= startMin) {
    return { done: true, ok: false, line: `No runner took the canary job on "${img}" in ${startMin} minutes: the image name may not exist, or GitHub has no runner for it.` };
  }
  if (started && waitedMin >= startMin + runMin) {
    return { done: true, ok: false, line: `The canary on ${img} started but did not finish in ${runMin} minutes.` };
  }
  return { done: false, ok: null, line: started ? `The canary on ${img} is running.` : `Waiting for a runner on ${img}.` };
}

const say = line => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); };
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });

async function main() {
  const repo = process.env.GITHUB_REPOSITORY, runId = process.env.GITHUB_RUN_ID;
  if (!repo || !runId) throw new Error("GITHUB_REPOSITORY and GITHUB_RUN_ID are required");
  const image = process.env.CANARY_IMAGE || "ubuntu-latest";
  const name = process.env.CANARY_JOB || "canary";
  const startMin = Number(process.env.START_MIN || 20), runMin = Number(process.env.RUN_MIN || 60);
  const t0 = Date.now();
  let v;
  for (;;) {
    let job = null;
    try {
      const jobs = JSON.parse(gh("api", `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`)).jobs || [];
      job = jobs.find(j => j.name === name) || null;
    } catch (e) { console.log(`could not read the run's jobs (${e.message.split("\n")[0]}); trying again`); }
    v = verdict({ job, image, waitedMin: (Date.now() - t0) / 60000, startMin, runMin });
    if (v.done) break;
    console.log(v.line);
    await new Promise(r => setTimeout(r, 30000));
  }
  say(v.line);
  if (v.ok) return;
  if (String(process.env.OPEN_ISSUE).toLowerCase() === "true") {
    const url = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repo}/actions/runs/${runId}`;
    const body = `${v.line}\n\nRun: ${url}\n\nEvery CI job is pinned to ubuntu-24.04 (CI-PIN-2404), so nothing is broken yet. ` +
      `Before GitHub forces the new image on the pinned label, make Playwright (scripts/ci/install-playwright.sh) work on it.`;
    const open = JSON.parse(gh("issue", "list", "-R", repo, "--state", "open", "--search", `"${ISSUE_TITLE}" in:title`, "--json", "number"));
    if (open.length) { gh("issue", "comment", String(open[0].number), "-R", repo, "--body", body); say(`Commented on issue #${open[0].number}.`); }
    else { say(gh("issue", "create", "-R", repo, "--title", ISSUE_TITLE, "--body", body).trim()); }
  } else {
    say("OPEN_ISSUE is not true (a run by hand): no issue opened.");
  }
  console.error(`::error::${v.line}`);
  process.exit(1);
}

if (require.main === module) main().catch(e => { console.error(`::error::runner-canary: ${e.message}`); process.exit(1); });
module.exports = { verdict, ISSUE_TITLE };
