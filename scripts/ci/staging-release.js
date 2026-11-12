#!/usr/bin/env node
// STAGE-3 · AFTER THE OVERNIGHT WALK, STAGING CATCHES UP TO MAIN.
//
// deploy-staging-release.yml runs this on a cron just after the walk window
// ends, and by hand (force: true releases now, inside the window too). It:
//   1. asks decideRelease whether it may act now;
//   2. reads staging's commit from its public /health and the push-to-main CI
//      runs' deploy-staging jobs, and picks the LATEST passed one staging lacks
//      (pickRelease: an older held merge is inside it and is never deployed);
//   3. marks that commit `staging/deploy` "Released …" (and older held commits
//      "Released with <sha>"), then re-runs its deploy-staging job, which
//      deploys and walks it exactly as a merge outside the window does.
// Nothing sleeps: a run takes seconds. Reads GitHub and staging's /health;
// writes only commit statuses and the job re-run. No DB, no app call.
//
// usage: node scripts/ci/staging-release.js [--dry-run]
// env:   GH_TOKEN, GITHUB_REPOSITORY, STAGING_API_URL, STAGING_WALK_WINDOW (optional),
//        FORCE ("true" from the dispatch), GITHUB_ACTOR; STAGING_RELEASE_NOW (ISO, tests only)
"use strict";
const fs = require("fs");
const { execFileSync } = require("child_process");
const W = require("../lib/stagingWindow");

const REPO = process.env.GITHUB_REPOSITORY;
const DRY = process.argv.includes("--dry-run");
const say = line => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); };
const gh = (...args) => execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", ...args], { encoding: "utf8" });
const ghJson = path => JSON.parse(gh(path));

async function liveSha() {
  const api = String(process.env.STAGING_API_URL || "").replace(/\/+$/, "");
  if (!api) throw new Error("the repo variable STAGING_API_URL is not set");
  const h = await (await fetch(`${api}/health`, { signal: AbortSignal.timeout(10000) })).json();
  if (h.env !== "staging") throw new Error(`${api}/health does not say env "staging"`);
  return h.buildSha || null;
}

async function main() {
  if (!REPO) throw new Error("GITHUB_REPOSITORY is required");
  const force = String(process.env.FORCE || "").toLowerCase() === "true";
  const now = process.env.STAGING_RELEASE_NOW ? new Date(process.env.STAGING_RELEASE_NOW) : new Date();
  const d = W.decideRelease({ now, window: process.env.STAGING_WALK_WINDOW, force });
  say(d.line);
  if (!d.go) return;

  const live = await liveSha();
  const ahead = new Map();
  const newerThanLive = sha => {
    if (!live) return true;
    if (sha === live) return false;
    if (!ahead.has(sha)) {
      let c = null;
      try { c = ghJson(`repos/${REPO}/compare/${live}...${sha}`); } catch { /* unknown: treat as not newer */ }
      ahead.set(sha, !!(c && c.status === "ahead"));
    }
    return ahead.get(sha);
  };
  const runs = [];
  for (const r of ghJson(`repos/${REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=15`).workflow_runs || []) {
    const jobs = ghJson(`repos/${REPO}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`).jobs || [];
    const j = jobs.find(x => x.name === "deploy-staging");
    runs.push({ runNumber: r.run_number, runId: r.id, runStatus: r.status, sha: r.head_sha, job: j ? { id: j.id, status: j.status, conclusion: j.conclusion } : null });
  }
  const p = W.pickRelease({ runs, newerThanLive });
  say(`Staging serves ${live ? live.slice(0, 7) : "an unknown commit"}. ${p.line}`);
  if (!p.pick) return;
  if (p.pick.runStatus !== "completed") { say(`Run #${p.pick.runNumber} has not finished its other jobs, so its deploy-staging cannot be re-run yet; the next scheduled run tries again.`); return; }
  if (DRY) { say("--dry-run: nothing marked, nothing re-run."); return; }

  const why = force ? `forced by ${String(process.env.GITHUB_ACTOR || "hand").slice(0, 40)}` : "after the overnight walk";
  const mark = (sha, description) => gh(`repos/${REPO}/statuses/${sha}`, "-f", "state=success", "-f", `context=${W.HELD_CONTEXT}`, "-f", `description=${description}`);
  mark(p.pick.sha, `${W.RELEASED_PREFIX} ${why}`);
  for (const r of p.superseded || []) { try { mark(r.sha, `${W.RELEASED_PREFIX} with ${p.pick.sha.slice(0, 7)}`); } catch { /* a label only */ } }
  gh("-X", "POST", `repos/${REPO}/actions/jobs/${p.pick.job.id}/rerun`);
  say(`Re-ran deploy-staging for ${p.pick.sha.slice(0, 7)} (run #${p.pick.runNumber}); its staging-walk follows. ${(p.superseded || []).length} older held merge(s) go out inside it.`);
}

if (require.main === module) main().catch(e => { console.error(`::error::staging-release: ${e.message}`); process.exit(1); });
