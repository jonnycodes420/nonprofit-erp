#!/usr/bin/env node
// HARDEN-1 item 4 · opens ONE GitHub issue from the nightly run's summary.
//
//   node scripts/nightly-ai/issue.js <summary.json> [--dry-run]
//
// Lists every failing question with the reasons its checker gave, and the
// spend against the cap. Uses the `gh` CLI with the workflow's GITHUB_TOKEN
// (GH_TOKEN); --dry-run prints the title and body instead. A summary with no
// failure and no cap reached opens nothing.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const file = process.argv[2];
const dry = process.argv.includes("--dry-run");
const runUrl = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY || "jonnycodes420/nonprofit-erp"}/actions/runs/${process.env.GITHUB_RUN_ID || "(local)"}`;
function open(title, body) {
  if (dry) { console.log(title + "\n\n" + body); return; }
  const tmp = path.join(os.tmpdir(), `nightly-ai-issue-${process.pid}.md`);
  fs.writeFileSync(tmp, body);
  execFileSync("gh", ["issue", "create", "--title", title, "--body-file", tmp], { stdio: "inherit" });
}
if (!file || !fs.existsSync(file)) {
  // The run broke before it could judge anything (the server never booted, the
  // seed failed): that is still a failed night, and it still gets its issue.
  open(`Nightly AI run ${new Date().toISOString().slice(0, 10)}: the run could not finish`,
    `The nightly real-AI run stopped before it wrote a summary, so no question was judged. The step log says where it stopped: ${runUrl}.`);
  process.exit(0);
}
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const failed = s.results.filter(r => !r.pass);
if (!failed.length && !s.capReached) { console.log("Every question passed and the cap was not reached: no issue."); process.exit(0); }

const money = v => (v == null ? "unknown" : "$" + Number(v).toFixed(2));
const title = `Nightly AI run ${s.today}: ${failed.length} of ${s.total} questions failed${s.capReached ? ", spend cap reached" : ""}`;
const lines = [
  `The nightly real-AI run on ${s.today} asked ${s.total} fixed questions of a freshly seeded demo org and ${s.passed} passed.`,
  "",
  `Spend: ${money(s.usd)} of the ${money(s.cap)} cap${s.capReached ? ". **The cap was reached, so later calls were refused and those questions fail for that reason.**" : "."}`,
  "",
  "| Question | Route | What went wrong |",
  "|---|---|---|",
  ...failed.map(r => `| ${r.id} · ${r.text.replace(/\|/g, "/")} | ${r.route === "agent" ? "POST /agent/instructions" : r.route === "all" ? "every AI call (ai_fallbacks)" : "POST /ask"} | ${r.why.map(w => w.replace(/\|/g, "/").replace(/\n/g, " ")).join("<br>")} |`),
  "",
  "Each question is judged COMPLETE (a 2xx answer of the expected kind, no plan_failed or plan_truncated, no raw error text, no sentence cut off) and IN SCOPE (every person is a record of the org, and the people match a truth set computed straight from SQL).",
  "",
  `The full JSON summary, with every response, is the \`nightly-ai-summary\` artifact on run ${runUrl}.`,
  "Re-judge it offline, without a model call: `node scripts/nightly-ai/run.js --recheck nightly-ai-summary.json`.",
];
open(title, lines.join("\n"));
