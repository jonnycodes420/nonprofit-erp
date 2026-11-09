// AUTOMERGE-1 — GREEN PRs MERGE THEMSELVES, ONE AT A TIME, WITHOUT --admin.
//
// Guards what reaches main, and so what deploys: .github/workflows/automerge.yml
// and .github/workflows/keep-current.yml. It parses both, then runs each `run:`
// block in bash against a stub `gh` that applies the workflow's own --jq filters
// to fake API answers and records every call.
//
// WHAT WOULD MAKE THIS FAIL (each planted and watched go red before the green
// was trusted):
//   · `--admin` anywhere in either file                                 → §1
//   · GH_TOKEN from GITHUB_TOKEN / github.token instead of AUTOMERGE_TOKEN → §1
//   · the draft, `no-automerge` or same-repo condition dropped            → §2
//   · the missing-secret path failing the job or still calling gh        → §3
//   · auto-merge turned on while main requires no check (it would merge
//     the PR at once, before CI)                                          → §3
//   · keep-current with no concurrency group, or one that cancels         → §4
//   · keep-current updating a draft, a `no-automerge` PR, a PR without
//     auto-merge, or newest first; one failed update stopping the rest     → §5
//
//   §1  both files parse; the token is AUTOMERGE_TOKEN; no --admin
//   §2  automerge.yml: the triggers, and the job skips drafts, no-automerge and forks
//   §3  automerge.yml's script: no token passes; no required check, no merge; else merge --auto
//   §4  keep-current.yml: push to main, one at a time, never cancelled
//   §5  keep-current.yml's script: oldest first, only auto-merge PRs, a failure does not stop it
//
// No server and no database. Needs bash and jq (both on the CI runner).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const yaml = (() => {
  try { return require("js-yaml"); } catch { return require(path.join(ROOT, "client", "node_modules", "js-yaml")); }
})();

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.log(`  ✗ ${msg}`); } };

const read = (f) => fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8");
const srcA = read("automerge.yml");
const srcK = read("keep-current.yml");
// js-yaml throws on a duplicate key or bad indentation: this is the YAML lint.
const A = yaml.load(srcA);
const K = yaml.load(srcK);

// ── a stub gh ───────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "automerge1-"));
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "gh"), `#!/bin/bash
printf '%s|TOKEN=%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" "$GH_TOKEN" >> "$GH_LOG"
jqf=""; prev=""
for a in "$@"; do [ "$prev" = "--jq" ] && jqf="$a"; prev="$a"; done
case "$1 $2" in
  "api "*)            printf '%s' "$RULES_JSON" | jq -r "$jqf" ;;
  "pr list")          printf '%s' "$PRS_JSON" | jq -r "$jqf" ;;
  "pr update-branch") for f in $FAIL_PRS; do [ "$3" = "$f" ] && exit 1; done; exit 0 ;;
  "pr merge")         exit 0 ;;
  *)                  echo "stub gh: unexpected $*" >&2; exit 9 ;;
esac
`, { mode: 0o755 });

function runStep(script, env) {
  const log = path.join(tmp, `log-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(log, "");
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    env: { PATH: `${bin}:${process.env.PATH}`, GH_LOG: log, ...env }, encoding: "utf8",
  });
  const calls = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), calls };
}

// ── §1 ──────────────────────────────────────────────────────────────────────
console.log("§1 both files parse; the token is AUTOMERGE_TOKEN; no --admin");
ok(A && K, "automerge.yml and keep-current.yml parse as YAML");
const stepA = A.jobs.enable.steps[0];
const stepK = K.jobs.update.steps[0];
ok(stepA.env.GH_TOKEN === "${{ secrets.AUTOMERGE_TOKEN }}", "automerge.yml: GH_TOKEN is secrets.AUTOMERGE_TOKEN");
ok(stepK.env.GH_TOKEN === "${{ secrets.AUTOMERGE_TOKEN }}", "keep-current.yml: GH_TOKEN is secrets.AUTOMERGE_TOKEN");
for (const [f, src] of [["automerge.yml", srcA], ["keep-current.yml", srcK]]) {
  const code = src.split("\n").filter(l => !/^\s*#/.test(l)).join("\n"); // comments may say the word
  ok(!/--admin\b/.test(code), `${f}: never --admin`);
  ok(!/GH_TOKEN:\s*\$\{\{\s*(secrets\.GITHUB_TOKEN|github\.token)/.test(src), `${f}: GH_TOKEN never comes from GITHUB_TOKEN`);
}

// ── §2 ──────────────────────────────────────────────────────────────────────
console.log("§2 automerge.yml: triggers and skips");
const prOn = A.on.pull_request;
ok(["opened", "reopened", "ready_for_review", "synchronize"].every(t => prOn.types.includes(t)), "runs on opened, reopened, ready_for_review, synchronize");
const cond = A.jobs.enable.if.replace(/\s+/g, " ");
ok(/github\.event\.pull_request\.draft == false/.test(cond), "the job skips drafts");
ok(/!contains\(github\.event\.pull_request\.labels\.\*\.name, 'no-automerge'\)/.test(cond), "the job skips PRs labelled no-automerge");
ok(/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/.test(cond), "the job runs only for PRs from this repo");

// ── §3 ──────────────────────────────────────────────────────────────────────
console.log("§3 automerge.yml's script");
const PR_URL = "https://github.com/example/repo/pull/7";
const RULE_ON = JSON.stringify([{ type: "deletion" }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "test" }] } }]);
const RULE_OFF = JSON.stringify([{ type: "deletion" }, { type: "non_fast_forward" }]);
let r = runStep(stepA.run, { GH_TOKEN: "", READ_TOKEN: "read-fake", REPO: "example/repo", PR_URL, RULES_JSON: RULE_ON });
ok(r.code === 0, "no AUTOMERGE_TOKEN: the job passes");
ok(r.out.includes("AUTOMERGE_TOKEN not set; merge by hand"), "no AUTOMERGE_TOKEN: it prints \"AUTOMERGE_TOKEN not set; merge by hand\"");
ok(r.calls.length === 0, "no AUTOMERGE_TOKEN: gh is never called");

r = runStep(stepA.run, { GH_TOKEN: "pat-fake", READ_TOKEN: "read-fake", REPO: "example/repo", PR_URL, RULES_JSON: RULE_OFF });
ok(r.code === 0 && !r.calls.some(c => c.startsWith("pr merge")), "main requires no check: auto-merge is not turned on (it would merge before CI)");

r = runStep(stepA.run, { GH_TOKEN: "pat-fake", READ_TOKEN: "read-fake", REPO: "example/repo", PR_URL, RULES_JSON: RULE_ON });
const merge = r.calls.filter(c => c.startsWith("pr merge"));
ok(r.code === 0 && merge.length === 1, "main requires a check: gh pr merge is called once");
ok(merge[0] === `pr merge --auto --squash --delete-branch ${PR_URL}|TOKEN=pat-fake`, "…as --auto --squash --delete-branch on the PR, with the personal token");
ok(r.calls.some(c => c.startsWith("api repos/example/repo/rules/branches/main") && c.endsWith("TOKEN=read-fake")), "the rule check reads with the workflow's own read-only token");

// ── §4 ──────────────────────────────────────────────────────────────────────
console.log("§4 keep-current.yml: push to main, one at a time");
ok(Array.isArray(K.on.push.branches) && K.on.push.branches.includes("main") && !K.on.pull_request, "runs on push to main only");
const conc = K.concurrency || K.jobs.update.concurrency;
ok(conc && typeof conc.group === "string" && conc.group.length > 0 && !/\$\{\{/.test(conc.group), "has one fixed concurrency group");
ok(conc && conc["cancel-in-progress"] === false, "a running update is never cancelled");

// ── §5 ──────────────────────────────────────────────────────────────────────
console.log("§5 keep-current.yml's script");
const am = { enabledAt: "2026-11-08T10:00:00Z" };
const PRS = JSON.stringify([
  { number: 40, createdAt: "2026-11-08T12:00:00Z", isDraft: false, autoMergeRequest: am, labels: [] },
  { number: 31, createdAt: "2026-11-08T09:00:00Z", isDraft: false, autoMergeRequest: am, labels: [] },
  { number: 35, createdAt: "2026-11-08T10:00:00Z", isDraft: false, autoMergeRequest: am, labels: [] },
  { number: 33, createdAt: "2026-11-08T09:30:00Z", isDraft: false, autoMergeRequest: null, labels: [] },
  { number: 34, createdAt: "2026-11-08T09:40:00Z", isDraft: true, autoMergeRequest: am, labels: [] },
  { number: 36, createdAt: "2026-11-08T09:50:00Z", isDraft: false, autoMergeRequest: am, labels: [{ name: "no-automerge" }] },
]);
r = runStep(stepK.run, { GH_TOKEN: "", REPO: "example/repo", PRS_JSON: PRS });
ok(r.code === 0 && r.out.includes("AUTOMERGE_TOKEN not set; merge by hand") && r.calls.length === 0, "no AUTOMERGE_TOKEN: it says so, passes, and calls nothing");

r = runStep(stepK.run, { GH_TOKEN: "pat-fake", REPO: "example/repo", PRS_JSON: PRS });
const updated = r.calls.filter(c => c.startsWith("pr update-branch")).map(c => Number(c.split(" ")[2]));
ok(r.code === 0, "the job passes");
ok(JSON.stringify(updated) === JSON.stringify([31, 35, 40]), `updates only the auto-merge PRs, oldest first (got ${JSON.stringify(updated)})`);
ok(r.calls.every(c => c.endsWith("TOKEN=pat-fake")), "every call uses the personal token");

r = runStep(stepK.run, { GH_TOKEN: "pat-fake", REPO: "example/repo", PRS_JSON: PRS, FAIL_PRS: "31" });
const after = r.calls.filter(c => c.startsWith("pr update-branch")).map(c => Number(c.split(" ")[2]));
ok(r.code === 0 && JSON.stringify(after) === JSON.stringify([31, 35, 40]), "a PR that cannot update does not stop the others");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nautomerge-workflows: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
