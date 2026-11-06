#!/usr/bin/env node
// STAGE-1 · WHICH LANE A MERGE TAKES: STAGING (THE DEFAULT) OR HOTFIX.
//
// Once STAGING_ENABLED is set, every merge to main deploys to staging and is
// walked there, and prod moves only when a super-admin presses Ship on /ops.
// A hotfix skips that wait: its PR carries the `hotfix` label AND a line in its
// description that says why, `Hotfix reason: <at least ten characters>`. Then
// the merge also deploys straight to prod through the same deploy jobs as
// before staging existed. A label with no reason is NOT a hotfix: the merge
// goes through staging and the run says why in a warning.
//
// Writes `lane=staging|hotfix` (and `reason=`) to $GITHUB_OUTPUT.
// usage: node scripts/ci/deploy-lane.js     env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA
"use strict";
const fs = require("fs");
const { execFileSync } = require("child_process");

const REASON_RE = /^\s*hotfix reason\s*:\s*(.+?)\s*$/im;
const MIN_REASON = 10;

// Pure: the lane for the PRs a commit belongs to.
function laneFor(prs) {
  for (const pr of prs || []) {
    const labels = (pr.labels || []).map(l => String(l.name || l).toLowerCase());
    if (!labels.includes("hotfix")) continue;
    const m = REASON_RE.exec(pr.body || "");
    const reason = m ? m[1].trim() : "";
    if (reason.length >= MIN_REASON) return { lane: "hotfix", reason, pr: pr.number };
    return { lane: "staging", reason: "", pr: pr.number,
      warning: `PR #${pr.number} has the hotfix label but no "Hotfix reason: …" line of ${MIN_REASON}+ characters in its description, so it goes through staging.` };
  }
  return { lane: "staging", reason: "", pr: prs && prs[0] ? prs[0].number : null };
}

if (require.main === module) {
  const { GITHUB_REPOSITORY: REPO, GITHUB_SHA: SHA } = process.env;
  let prs = [];
  try {
    prs = JSON.parse(execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", `repos/${REPO}/commits/${SHA}/pulls`], { encoding: "utf8" }));
  } catch (e) { console.log(`could not read the PR for ${SHA} (${String(e.message).split("\n")[0]}); the merge goes through staging`); }
  const out = laneFor(prs);
  if (out.warning) console.log(`::warning::${out.warning}`);
  const line = out.lane === "hotfix" ? `Hotfix: PR #${out.pr} deploys straight to prod. Reason: ${out.reason}` : `Staging: ${SHA.slice(0, 7)} deploys to staging; prod moves when Ship is pressed on /ops.`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `lane=${out.lane}\nreason=${out.reason.replace(/[\r\n]+/g, " ").slice(0, 300)}\n`);
}
module.exports = { laneFor, REASON_RE, MIN_REASON };
