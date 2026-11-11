#!/usr/bin/env node
// scripts/ci/shard-report.js — CHORE-2. ONE SUMMARY OUT OF N SHARDS.
//
// A sharded run must read like a serial one, or nobody will trust it. This
// prints exactly one summary: pass/fail/skip per suite, the slowest ten, and
// the wall time — and it EXITS NON-ZERO if any shard failed, if any shard
// never wrote its result, or if any suite in the plan never ran. The last two
// matter more than they look: a shard whose server did not start would
// otherwise vanish and the run would read green with a third of the battery
// missing.
//
// It also refreshes .generated/suite-timings.json (git-ignored, ARCH-1) from the run, so the next plan is
// balanced by what actually happened.
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };
const OUT = flag("out", "");
const PLAN = flag("plan", "");
const STARTED = Number(flag("started", "0"));
const TIMINGS = flag("timings", ".generated/suite-timings.json");
// CI-2: --only <n> reports shard n alone (a CI matrix job runs one shard; the
// combine job reports them all). Without it, every planned shard must report.
const ONLY = Number(flag("only", "0")) || 0;
const ROOT = path.join(__dirname, "..", "..");
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", Z = "\x1b[0m";

const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));
const planned = new Set(plan.shards.filter((_, i) => !ONLY || i + 1 === ONLY).flat().map(s => s.name));

const results = [];
const missingShards = [];
for (let i = 1; i <= plan.shards.length; i++) {
  if (!plan.shards[i - 1] || !plan.shards[i - 1].length) continue;
  if (ONLY && i !== ONLY) continue;
  const f = path.join(OUT, `shard-${i}.json`);
  if (!fs.existsSync(f)) { missingShards.push(i); continue; }
  let j;
  try { j = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { missingShards.push(i); continue; }
  if (j.error) { missingShards.push(i); console.log(`  ${R}SHARD ${i} DID NOT RUN${Z}  ${j.error} (see ${OUT}/server-${i}.log)`); continue; }
  for (const s of j.suites) results.push({ ...s, shard: i });
}

const ran = new Set(results.map(r => r.name));
const neverRan = [...planned].filter(n => !ran.has(n));
const failed = results.filter(r => r.rc !== 0);
const skipped = results.filter(r => (r.skips || 0) > 0);
const missingFiles = results.filter(r => r.missing);

console.log("");
for (const r of [...results].sort((a, b) => a.name.localeCompare(b.name))) {
  const mark = r.rc === 0 ? `${G}PASS${Z}` : `${R}FAIL${Z}`;
  console.log(`  ${mark}  [${r.shard}] ${r.name.padEnd(28)} ${String(r.secs).padStart(4)}s  ${r.last}`);
}

// A failing suite's whole log, inline, exactly as the serial runner does it.
for (const r of failed) {
  const log = path.join(process.env.SUITE_LOG_DIR || "/tmp/steward-suite-logs", `shard-${r.shard}`, `${r.name}.log`);
  console.log(`  ──── ${r.name}: full output (${log}) ────`);
  try { console.log(fs.readFileSync(log, "utf8")); } catch { console.log("  (no log)"); }
  console.log(`  ──── end ${r.name} output ────`);
}

// ── THE PASS COUNT PER SUITE ───────────────────────────────────────────────
// A suite can go green by asserting less. The FIX leads compared per-suite
// counts by eye at the end of every build; this writes them down so the
// combine job can do it. The count comes from the suite's own last line
// ("N passed, M failed"), which every suite in this repo prints.
const countOf = last => { const m = /(\d+)\s+passed/.exec(last || ""); return m ? Number(m[1]) : null; };
const counts = {};
for (const r of results) { const c = countOf(r.last); if (c !== null) counts[r.name] = c; }
if (OUT) fs.writeFileSync(path.join(OUT, "counts.json"), JSON.stringify(counts, null, 1));

const slowest = [...results].sort((a, b) => b.secs - a.secs).slice(0, 10);
console.log(`\n  slowest 10: ${slowest.map(s => `${s.name} ${s.secs}s`).join(" · ")}`);
if (skipped.length) console.log(`  ${Y}suites containing a SKIP${Z}: ${skipped.map(s => `${s.name}(${s.skips})`).join(" · ")}`);

const wall = STARTED ? Math.round(Date.now() / 1000) - STARTED : null;
const perShard = plan.shards.map((list, i) => {
  const mine = results.filter(r => r.shard === i + 1);
  return mine.length ? `${i + 1}:${mine.reduce((a, b) => a + b.secs, 0)}s/${mine.length}` : `${i + 1}:—`;
});
console.log(`\nSuites: ${results.length - failed.length} passed, ${failed.length} failed`
  + (wall !== null ? `  (wall ${wall}s, ` : "  (")
  + `${plan.shards.filter(s => s.length).length} shards · ${perShard.join(" ")})`);

// Refresh the timings from this run so the next plan is balanced by fact.
try {
  const file = path.resolve(ROOT, TIMINGS);   // FIX-15: an absolute path (a test's copy) stays absolute
  let prev = {};
  try { prev = (JSON.parse(fs.readFileSync(file, "utf8")) || {}).suites || {}; } catch { /* first time */ }
  // CI-SPEED-1: half the old figure and half this run's, not this run alone.
  // A suite's time moves by up to 15% between runs (numbers1-foot: 510 s, then
  // 582 s), and planning from one run's noise put a shard 14% over the mean.
  // Replayed over the seven PR runs of 10 Nov, the blend kept the slowest
  // shard within 6% of the mean on the last four. A new suite takes its
  // first time as it is.
  for (const r of results) {
    if (r.missing) continue;
    prev[r.name] = Number.isFinite(prev[r.name]) ? Math.round((prev[r.name] + r.secs) / 2) : r.secs;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    note: "Seconds per suite: half the previous figure plus half the last sharded run's (CI-SPEED-1). Data for scripts/ci/shard-plan.js, never a gate: a stale entry costs seconds, never correctness.",
    updated: new Date().toISOString().slice(0, 10),
    suites: Object.fromEntries(Object.entries(prev).sort(([a], [b]) => a.localeCompare(b))),
  }, null, 1) + "\n");
} catch (e) { console.log("  (could not refresh the timings: " + e.message + ")"); }

let bad = failed.length;
if (missingShards.length) { console.log(`${R}Shards that produced no result: ${missingShards.join(", ")}${Z}`); bad += missingShards.length; }
if (neverRan.length) { console.log(`${R}Planned suites that never ran: ${neverRan.join(", ")}${Z}`); bad += neverRan.length; }
if (missingFiles.length) console.log(`${Y}Suites with no file: ${missingFiles.map(r => r.name).join(", ")}${Z}`);
if (bad) { console.log(`Failed: ${failed.map(f => f.name).join(" ")}`); process.exit(1); }
console.log("All consistency + core suites green.");
