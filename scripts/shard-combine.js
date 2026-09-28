#!/usr/bin/env node
// scripts/shard-combine.js — CHORE-2. THE ONE PLACE THAT SAYS THE BATTERY PASSED.
//
// CI runs the battery as six parallel shards. A green shard means a sixth of
// the battery passed; nothing should deploy on that. This job reads every
// shard's result and refuses the run when:
//
//   1. any suite failed;
//   2. any shard produced NO result — a shard whose server never started
//      writes nothing, and without this check the run would read green with a
//      sixth of the battery silently missing. This is the failure mode that
//      makes sharding dangerous, and it is the reason this file exists;
//   3. any suite's PASS COUNT dropped against audit/suite-counts.json. A
//      suite can go green by asserting less. The FIX leads compared counts by
//      eye at the end of every build; this does it every run.
//
// The baseline RATCHETS: a run whose counts are all >= the baseline rewrites
// it upward, so today's numbers are tomorrow's floor. A count that must come
// down (an assertion a brief deliberately removed) is an edit to
// audit/suite-counts.json in the same commit, with the reason in the message
// — the same contract as the number census and the palette census.
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };
const IN = flag("in", "/tmp/shards");
const SHARDS = Number(flag("shards", "6"));
const BASELINE = flag("baseline", "audit/suite-counts.json");
const ROOT = path.join(__dirname, "..");
const R = "\x1b[31m", G = "\x1b[32m", Y = "\x1b[33m", Z = "\x1b[0m";

const problems = [];
const suites = [];
let seen = 0;
for (let i = 1; i <= SHARDS; i++) {
  const f = path.join(IN, `shard-${i}.json`);
  if (!fs.existsSync(f)) { problems.push(`shard ${i} produced no result at all`); continue; }
  let j;
  try { j = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { problems.push(`shard ${i}'s result is unreadable (${e.message})`); continue; }
  if (j.error) { problems.push(`shard ${i} did not run: ${j.error}`); continue; }
  seen++;
  for (const s of j.suites) suites.push({ ...s, shard: i });
}
if (!seen) problems.push("no shard produced a result — the battery did not run");

const failed = suites.filter(s => s.rc !== 0);
const countOf = last => { const m = /(\d+)\s+passed/.exec(last || ""); return m ? Number(m[1]) : null; };
const counts = {};
for (const s of suites) { const c = countOf(s.last); if (c !== null) counts[s.name] = c; }

// ── the count ratchet ──────────────────────────────────────────────────────
const basePath = path.join(ROOT, BASELINE);
let base = {};
try { base = (JSON.parse(fs.readFileSync(basePath, "utf8")) || {}).suites || {}; }
catch { console.log(`${Y}no ${BASELINE} yet — this run writes the first one${Z}`); }

// A suite that SKIPPED part of itself is not comparable and is not a drop.
// CI has no Playwright, so every browser leg skips there: `smoke-walk` runs
// 104 assertions on a laptop and 0 in CI, and `hotfix1-profile` runs 49 and
// 38. Reading that as "asserting less" would fail every CI run for ever,
// and would train people to ignore the one guard that catches a suite
// quietly doing less. The ratchet compares like with like; a full local run
// has no skips and is ratcheted completely.
const skipped = new Set(suites.filter(s => (s.skips || 0) > 0).map(s => s.name));
const dropped = [];
const notCompared = [];
for (const [name, was] of Object.entries(base)) {
  if (!(name in counts)) continue;               // a retired suite is not a drop
  if (skipped.has(name)) { notCompared.push(`${name} (${was} → ${counts[name]}, a leg skipped here)`); continue; }
  if (counts[name] < was) dropped.push(`${name}: ${was} → ${counts[name]}`);
}
if (notCompared.length) console.log(`  ${Y}not compared, a leg skipped in this environment:${Z} ${notCompared.join(" · ")}`);
if (dropped.length) problems.push(`a suite is asserting LESS than it did:\n    ` + dropped.join("\n    "));

console.log("");
console.log(`  shards reporting: ${seen}/${SHARDS}`);
console.log(`  suites: ${suites.length} · passed ${suites.length - failed.length} · failed ${failed.length}`);
const withSkips = suites.filter(s => (s.skips || 0) > 0);
if (withSkips.length) console.log(`  ${Y}suites containing a SKIP:${Z} ${withSkips.map(s => `${s.name}(${s.skips})`).join(" · ")}`);
const slowest = [...suites].sort((a, b) => b.secs - a.secs).slice(0, 10);
console.log(`  slowest 10: ${slowest.map(s => `${s.name} ${s.secs}s`).join(" · ")}`);
for (const f of failed) console.log(`  ${R}FAIL${Z}  [${f.shard}] ${f.name} — ${f.last}`);

if (failed.length) problems.unshift(`${failed.length} suite(s) failed: ${failed.map(f => f.name).join(" ")}`);

if (problems.length) {
  console.log(`\n${R}The battery did not pass.${Z}`);
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(1);
}

// Green: ratchet the baseline up to what this run actually asserted.
const next = { ...base };
let raised = 0;
for (const [name, n] of Object.entries(counts)) {
  if (skipped.has(name)) continue;               // an incomplete run sets no floor
  if (!(name in next) || n > next[name]) { next[name] = n; raised++; }
}
try {
  fs.mkdirSync(path.dirname(basePath), { recursive: true });
  fs.writeFileSync(basePath, JSON.stringify({
    note: "The floor for every suite's pass count. A suite may assert MORE at any time; asserting less fails the combine job. Lowering a number here is a deliberate edit, in the commit that removes the assertion, with the reason in the message.",
    updated: new Date().toISOString().slice(0, 10),
    suites: Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))),
  }, null, 1) + "\n");
  if (raised) console.log(`  (the floor rose for ${raised} suite(s) — commit audit/suite-counts.json to keep it)`);
} catch (e) { console.log(`  (could not write ${BASELINE}: ${e.message})`); }

console.log(`\n${G}The full battery passed, across ${seen} shards.${Z}`);
