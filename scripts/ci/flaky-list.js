#!/usr/bin/env node
// scripts/ci/flaky-list.js · FLAKE-4. WHICH SUITES PASSED ONLY ON THEIR RETRY.
//
// tests/shard.sh runs a failed suite once more (tests/lib/run-suite.sh); one
// that passes the second time keeps the job green and carries "flaky": true in
// its shard's result. This reads every shard's result (tests/lib/shardResults)
// and writes the list down, so a flake is named every time and never hidden:
//
//   --in <dir> --shards <n>   the shard results (CI's combine job: /tmp/steward-shards, 6)
//   --out <file>              flaky.json: { run, sha, pr, at, suites: [{ name, shard, firstLast }] }
//   --comment <file>          the PR comment's body, written only when the list is not empty
//
// Prints one line per flaky suite ("FLAKY: lag1 passed on retry") and adds the
// same lines to $GITHUB_STEP_SUMMARY. Never a gate: it always exits 0.
const fs = require("fs");
const path = require("path");
const { read } = require("../../tests/lib/shardResults");

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };

function flakyOf(results) {
  return results.filter(r => r.flaky === true && r.rc === 0)
    .map(r => ({ name: r.name, shard: r.shard, firstLast: r.firstLast || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function commentBody(list, env = process.env) {
  const run = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
    ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : "";
  return [
    `**${list.length} suite${list.length === 1 ? "" : "s"} passed only on the retry** (FLAKE-4).`,
    "Each failed once, then passed when run again in the same shard. The build is green; the flake is not fixed.",
    "",
    ...list.map(f => `- \`${f.name}\` (shard ${f.shard}). First run's last line: ${f.firstLast ? "`" + f.firstLast.replace(/`/g, "'") + "`" : "(none)"}`),
    "",
    run ? `Logs: ${run} (artifact \`shard-<n>\`, \`<suite>.try1.log\` is the red run).` : "",
  ].join("\n").trim() + "\n";
}

if (require.main === module) {
  const IN = flag("in", "/tmp/shards");
  const SHARDS = Number(flag("shards", "6"));
  const OUT = flag("out", "");
  const COMMENT = flag("comment", "");
  const list = flakyOf(read(IN, SHARDS).results);
  const lines = list.map(f => `FLAKY: ${f.name} passed on retry`);
  if (lines.length) console.log(lines.join("\n"));
  else console.log("No suite needed its retry.");
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({
      run: process.env.GITHUB_RUN_ID || null,
      sha: process.env.GITHUB_SHA || null,
      pr: process.env.PR_NUMBER || null,
      at: new Date().toISOString(),
      suites: list,
    }, null, 1) + "\n");
  }
  if (COMMENT && list.length) fs.writeFileSync(COMMENT, commentBody(list));
  if (process.env.GITHUB_STEP_SUMMARY && lines.length)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "\n" + lines.map(l => `- ${l}`).join("\n") + "\n");
}

module.exports = { flakyOf, commentBody };
