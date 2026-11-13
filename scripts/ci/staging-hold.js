#!/usr/bin/env node
// STAGE-3 · deploy-staging, right before it deploys: inside the overnight walk
// window, hold instead (scripts/lib/stagingWindow.js says why and how).
//
// Writes `deploy=true|false` to $GITHUB_OUTPUT and one line to the job summary.
// On a hold it marks the commit `staging/deploy` pending "Held until 3:15 AM ET",
// which /ops's Ship card lists. A commit that deploy-staging-release has marked
// `staging/deploy` "Released …" deploys whatever the clock says (that is its
// re-run). Reads and writes only this commit's statuses on GitHub. No BASE, no
// DB, no app call, no secret beyond the job's own GH_TOKEN.
//
// usage: node scripts/ci/staging-hold.js
// env:   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, STAGING_WALK_WINDOW (optional),
//        GITHUB_SERVER_URL, GITHUB_RUN_ID; STAGING_HOLD_NOW (ISO, tests only)
"use strict";
const fs = require("fs");
const { execFileSync } = require("child_process");
const W = require("../lib/stagingWindow");

const { GITHUB_REPOSITORY: REPO, GITHUB_SHA: SHA } = process.env;
const say = line => { console.log(line); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); };
const output = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const gh = (...args) => execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", ...args], { encoding: "utf8" });

function released() {
  // The newest staging/deploy status on this commit says Released.
  try {
    const list = JSON.parse(gh(`repos/${REPO}/commits/${SHA}/statuses?per_page=100`));
    const st = list.find(s => s.context === W.HELD_CONTEXT);
    return !!(st && st.state === "success" && String(st.description || "").startsWith(W.RELEASED_PREFIX));
  } catch (e) { console.log(`could not read this commit's statuses (${String(e.message).split("\n")[0]}); treated as not released`); return false; }
}

if (require.main === module) {
  if (!REPO || !SHA) { console.error("staging-hold: GITHUB_REPOSITORY and GITHUB_SHA are required"); process.exit(2); }
  const now = process.env.STAGING_HOLD_NOW ? new Date(process.env.STAGING_HOLD_NOW) : new Date();
  let d;
  try { d = W.decideHold({ now, window: process.env.STAGING_WALK_WINDOW, released: released() }); }
  catch (e) { console.error(`::error::${e.message}`); process.exit(1); }
  say(d.line);
  if (d.hold) {
    const url = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID || ""}`;
    try { gh(`repos/${REPO}/statuses/${SHA}`, "-f", "state=pending", "-f", `context=${W.HELD_CONTEXT}`,
      "-f", `description=Held until ${d.until} (overnight walk)`, "-f", `target_url=${url}`); }
    catch (e) { console.log(`could not mark the commit held (${String(e.message).split("\n")[0]}); the release still finds it`); }
  }
  output("deploy", d.hold ? "false" : "true");
}
