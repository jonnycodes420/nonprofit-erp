#!/usr/bin/env node
// scripts/ci/shard-plan.js — CHORE-2. WHICH SUITES GO IN WHICH SHARD.
//
// Longest-processing-time first: sort the suites by their recorded seconds,
// descending, and drop each one into whichever shard is currently emptiest.
// CI's matrix (one job per shard) and `SHARDS=n bash tests/run-all.sh` both
// plan here, from the same timings, so they run the same shards (CI-2).
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

// ── THE BROWSER LEGS ───────────────────────────────────────────────────────
// A browser suite walks a built client (client/dist) made for ITS shard's API.
// Until CI-2 every browser suite was pinned to shard 1 because there was one
// dist; that shard carried 2,095 s of PR #294's 2,770 s. Now a browser suite
// is balanced like any other, and the plan names the shards that hold one
// (`browserShards`), so tests/run-all.sh builds a dist for each of them.
// Detected by reading the suite files (tests/lib/suites.js `needsDist`, which
// `npm run affected` shares), never a hand-kept list.
// `// battery: last` suites (the load-heavy ones) run after the rest of their shard.
const { MARK, needsDist } = require("../../tests/lib/suites");
function isLast(name) {
  try { const m = fs.readFileSync(path.join(__dirname, "..", "..", "tests", `${name}.test.js`), "utf8").match(MARK); return !!m && m[1] === "last"; }
  catch { return false; }
}

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf("--" + name); return i === -1 ? dflt : argv[i + 1]; };
const shards = Math.max(1, parseInt(flag("shards", "6"), 10) || 6);
const timingsPath = flag("timings", ".generated/suite-timings.json");
const outPath = flag("out", "");
const names = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));

if (!names.length) { console.error("shard-plan: no suites given"); process.exit(2); }

let timings = {};
try {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", timingsPath), "utf8"));
  timings = raw && raw.suites ? raw.suites : raw || {};
} catch { /* no timings yet: every suite weighs the same, which is a fine first run */ }

const known = names.map(n => timings[n]).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
const median = known.length ? known[Math.floor(known.length / 2)] : 1;
const weightOf = n => (Number.isFinite(timings[n]) ? timings[n] : median);

// --shuffle <seed>: a different, seeded, random plan: which suites share a
// shard and their order in it. CI-2 uses it to prove the suites do not lean
// on each other's leftovers (two batteries, two orders, the same results).
// Without it the plan is a pure function of the suites and the timings, so a
// run in CI and a run on a laptop with the same timings run the same shards.
const shuffleSeed = flag("shuffle", "");
let rand = null;
if (shuffleSeed) {
  let a = (parseInt(shuffleSeed, 10) || 1) >>> 0;
  rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = xs => { const out = [...xs]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };

const bins = Array.from({ length: shards }, () => ({ total: 0, suites: [] }));
const lightest = () => bins.reduce((a, b) => (b.total < a.total ? b : a));
const place = name => { const bin = lightest(); bin.suites.push({ name, secs: weightOf(name), ...(needsDist(name) ? { dist: true } : {}) }); bin.total += weightOf(name); };
const timed = names.filter(n => Number.isFinite(timings[n]));
const untimed = names.filter(n => !Number.isFinite(timings[n])).sort();
if (rand) {
  // A random order into the lightest shard: still balanced, different neighbours.
  for (const name of shuffle(timed)) place(name);
} else {
  // Longest first into the lightest shard (LPT). Ties broken by NAME, so the
  // same list always produces the same plan: a plan that shuffles between
  // runs makes a flake impossible to reproduce.
  for (const name of [...timed].sort((a, b) => (timings[b] - timings[a]) || a.localeCompare(b))) place(name);
}
// A suite with no timing yet (new, or renamed) goes to the lightest shard,
// weighed at the median so several new suites spread out.
for (const name of untimed) place(name);
// Within a shard: the `battery: last` suites at the end; otherwise in plan
// order (or a random one, with --shuffle).
for (const b of bins) {
  const order = rand ? shuffle(b.suites) : b.suites;
  b.suites = [...order.filter(s => !isLast(s.name)), ...order.filter(s => isLast(s.name))];
}
const browserShards = bins.map((b, i) => (b.suites.some(s => s.dist) ? i + 1 : 0)).filter(Boolean);

const plan = {
  shards: bins.map(b => b.suites),
  totals: bins.map(b => Math.round(b.total)),
  suiteCount: names.length,
  median,
  knownTimings: known.length,
  generatedFrom: timingsPath,
  browserShards,
  browserSuites: bins.reduce((n, b) => n + b.suites.filter(s => s.dist).length, 0),
  untimed,
  ...(shuffleSeed ? { shuffle: shuffleSeed } : {}),
};
if (outPath) fs.writeFileSync(outPath, JSON.stringify(plan, null, 1));
const spread = plan.totals.length > 1 ? Math.max(...plan.totals) - Math.min(...plan.totals) : 0;
console.log(`[shard-plan] ${names.length} suites → ${shards} shards · est ${plan.totals.join("s / ")}s · spread ${spread}s`
  + (known.length ? ` · ${known.length} timed, median ${median}s` : " · no timings yet, every suite weighed equally")
  + (untimed.length && known.length ? ` · ${untimed.length} with no timing yet, to the lightest shard` : "")
  + (plan.browserSuites ? ` · ${plan.browserSuites} browser legs in shards ${browserShards.join(",")}` : "")
  + (shuffleSeed ? ` · shuffled (seed ${shuffleSeed})` : ""));
