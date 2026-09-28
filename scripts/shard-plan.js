#!/usr/bin/env node
// scripts/shard-plan.js — CHORE-2. WHICH SUITES GO IN WHICH SHARD.
//
// Longest-processing-time first: sort the suites by their recorded seconds,
// descending, and drop each one into whichever shard is currently emptiest.
// LPT is within 4/3 of optimal for this shape of problem and it is four lines;
// anything cleverer would be harder to read than the thing it schedules.
//
// A suite with no recorded time is assumed to be the MEDIAN of the ones that
// do have times, so a brand-new suite is never the thing that unbalances a
// run, and a missing timings file simply makes every suite equal.
//
// The plan is WRITTEN DOWN (--out), so a red shard can be re-run with the
// exact list it was given.
//
// Reads nothing but its arguments and the timings file. Writes one JSON file.
// Loopback-irrelevant: it touches no database and no network.
const fs = require("fs");
const path = require("path");

// ── THE BROWSER LEGS SHARE ONE SHARD, BECAUSE THEY SHARE ONE BUILD ─────────
// A browser suite checks that `client/dist` was built against ITS $BASE, and
// SKIPS (cleanly, quietly) when it was not. Six shards have six different
// API ports and there is one dist, so five shards' worth of browser legs
// would skip and the run would be green with the browser coverage missing —
// the exact silent-skip failure this battery has been bitten by before.
//
// So every suite that drives a browser goes in ONE shard, and run-all.sh
// builds the dist against that shard's API. That shard is ~62% of the
// battery, which CAPS what sharding can buy locally; splitting it needs a
// dist per shard, which needs the browser suites to resolve their dist path
// from an env var rather than the fixed client/dist. That is the next step
// and it is written up in docs/chore-2-NOTES.md. Detected by reading the suite
// files rather than by a hand-kept list, because a hand-kept list of which
// suites touch the browser is a list that goes stale the first time somebody
// adds one.
// ANY suite that launches a browser, not just one that names client/dist.
// The first cut of this matched `client/dist` only, and five suites that
// drive Playwright through $APP_URL without ever naming the directory
// (fix3-d-lock-flash, giving-page-builder, build102-embed…) were scattered
// across the other shards, served a dist built for shard 1's API, and failed
// as "the widgets she built are drawn" — which reads as a product bug and is
// an environment one. The net is wide on purpose: a browser suite in the
// wrong shard is a false failure, and a non-browser suite in this one costs
// only balance.
const NEEDS_DIST = /playwright|client\/dist|"client",\s*"dist"/;
function needsDist(name) {
  try { return NEEDS_DIST.test(fs.readFileSync(path.join(__dirname, "..", "tests", `${name}.test.js`), "utf8")); }
  catch { return false; }
}

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf("--" + name); return i === -1 ? dflt : argv[i + 1]; };
const shards = Math.max(1, parseInt(flag("shards", "6"), 10) || 6);
const timingsPath = flag("timings", "audit/suite-timings.json");
const outPath = flag("out", "");
const names = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

if (!names.length) { console.error("shard-plan: no suites given"); process.exit(2); }

let timings = {};
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", timingsPath), "utf8"));
  timings = raw && raw.suites ? raw.suites : raw || {};
} catch { /* no timings yet: every suite weighs the same, which is a fine first run */ }

const known = names.map(n => timings[n]).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
const median = known.length ? known[Math.floor(known.length / 2)] : 1;
const weightOf = n => (Number.isFinite(timings[n]) ? timings[n] : median);

// Ties broken by NAME, so the same list always produces the same plan — a
// plan that shuffles between runs makes a flake impossible to reproduce.
const sorted = [...names].sort((a, b) => (weightOf(b) - weightOf(a)) || a.localeCompare(b));

const bins = Array.from({ length: shards }, () => ({ total: 0, suites: [] }));
const browser = sorted.filter(needsDist);
const rest = sorted.filter(n => !needsDist(n));

// The browser group is placed FIRST, as one unit, into shard 1 — a fixed
// shard rather than the emptiest one, so `run-all.sh` and CI can both know
// which API port to build the dist against without reading the plan twice.
const BROWSER_SHARD = 1;
for (const name of browser) {
  bins[BROWSER_SHARD - 1].suites.push({ name, secs: weightOf(name), dist: true });
  bins[BROWSER_SHARD - 1].total += weightOf(name);
}
// Then everything else, longest first into the emptiest shard. The browser
// shard is usually the heaviest already, so this fills around it.
for (const name of rest) {
  const bin = bins.reduce((a, b) => (b.total < a.total ? b : a));
  bin.suites.push({ name, secs: weightOf(name) });
  bin.total += weightOf(name);
}

const plan = {
  shards: bins.map(b => b.suites),
  totals: bins.map(b => Math.round(b.total)),
  suiteCount: names.length,
  median,
  knownTimings: known.length,
  generatedFrom: timingsPath,
  browserShard: browser.length ? BROWSER_SHARD : null,
  browserSuites: browser.length,
};
if (outPath) fs.writeFileSync(outPath, JSON.stringify(plan, null, 1));
const spread = plan.totals.length > 1 ? Math.max(...plan.totals) - Math.min(...plan.totals) : 0;
console.log(`[shard-plan] ${names.length} suites → ${shards} shards · est ${plan.totals.join("s / ")}s · spread ${spread}s`
  + (known.length ? ` · ${known.length} timed, median ${median}s` : " · no timings yet, every suite weighed equally")
  + (browser.length ? ` · ${browser.length} browser legs pinned to shard ${BROWSER_SHARD}` : ""));
