#!/usr/bin/env node
// scripts/tree-already-passed.js — CHORE-2. HAS THIS EXACT TREE ALREADY PASSED?
//
// A push to main is nearly always the merge of a PR whose head already ran the
// full battery on the same files. Running it again buys nothing and costs the
// whole of the path between "merged" and "deployed".
//
// The key is the TREE hash (`git rev-parse HEAD^{tree}`), not the commit: it
// ignores the message, the author and the parents. A squash, a rebase, or a
// merge commit that resolved no conflicts all hash to the tree that was
// tested. A merge that DID resolve a conflict produces a tree that has never
// existed anywhere, so it is tested in full — which is exactly the case where
// re-testing earns its keep.
//
// Trust is narrow on purpose:
//   · only on a push to main (a PR always runs);
//   · only a SUCCESSFUL run of this same workflow;
//   · only a run whose head commit has the identical tree;
//   · only when the API answers — any error, any doubt, and it runs the
//     battery. A skip that is wrong is a deploy of untested code, so every
//     failure mode here falls the safe way.
//
// It writes `tree`, `skip` and `trusted` to $GITHUB_OUTPUT, and one line to
// $GITHUB_STEP_SUMMARY saying which run it trusted or why it did not.
const { execSync } = require("child_process");
const fs = require("fs");

const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const summary = line => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n"); };
const sh = c => execSync(c, { encoding: "utf8" }).trim();

const tree = sh("git rev-parse HEAD^{tree}");
out("tree", tree);

const runFull = why => {
  out("skip", "false"); out("trusted", "");
  console.log(`Running the full battery: ${why}`);
  summary(`Full battery: ${why}`);
  process.exit(0);
};

if (process.env.GITHUB_EVENT_NAME !== "push") runFull("this is not a push (a pull request always runs)");
if (process.env.GITHUB_REF !== "refs/heads/main") runFull("this is not main");

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const wf = (process.env.GITHUB_WORKFLOW_REF || "").split("@")[0].split("/").pop() || "ci.yml";
if (!repo || !token) runFull("no API credentials to check previous runs with");

(async () => {
  const api = async path => {
    const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  };

  let runs;
  try { runs = await api(`/actions/workflows/${wf}/runs?status=success&per_page=40`); }
  catch (e) { runFull(`could not list previous runs (${e.message})`); return; }

  const mine = Number(process.env.GITHUB_RUN_ID || 0);
  for (const run of runs.workflow_runs || []) {
    if (run.id === mine) continue;
    const sha = run.head_sha;
    if (!sha) continue;
    // The run's head commit, and the tree it pointed at. A commit we do not
    // have locally is fetched from the API rather than guessed at.
    let theirTree = null;
    try { theirTree = sh(`git rev-parse ${sha}^{tree}`); }
    catch {
      try { theirTree = (await api(`/git/commits/${sha}`)).tree.sha; } catch { continue; }
    }
    if (theirTree !== tree) continue;
    out("skip", "true"); out("trusted", String(run.id));
    console.log(`Tree ${tree} already passed in run ${run.id} (${sha.slice(0, 12)}, ${run.head_branch}).`);
    summary(`Battery skipped: tree \`${tree.slice(0, 12)}\` already passed in run ${run.id} (commit \`${sha.slice(0, 12)}\` on \`${run.head_branch}\`).`);
    return;
  }
  runFull(`no successful run has tested tree ${tree.slice(0, 12)}`);
})().catch(e => runFull(`the check itself failed (${e.message})`));
