// tests/lib/shardResults.js: CI-2. WHAT THE SHARDS SAY THEY RAN.
//
// CI runs the battery as a matrix: one job per shard, each uploading its
// shard-<n>.json, and one combine job reading them all. This is the one reader
// of those files, for scripts/ci/shard-combine.js (the gate) and
// tests/every-test-runs.test.js (every discovered suite ran exactly once).
//
//   read(dir, shards)   → { results: [{...suite, shard}], problems: [why a shard said nothing] }
//   ranOnce(want, results) → the problems: a suite that never ran, one that ran
//                            twice, one that ran but is not a suite here
const fs = require("fs");
const path = require("path");

function read(dir, shards) {
  const results = [], problems = [];
  for (let i = 1; i <= shards; i++) {
    const f = path.join(dir, `shard-${i}.json`);
    if (!fs.existsSync(f)) { problems.push(`shard ${i} produced no result at all`); continue; }
    let j;
    try { j = JSON.parse(fs.readFileSync(f, "utf8")); }
    catch (e) { problems.push(`shard ${i}'s result is unreadable (${e.message})`); continue; }
    if (j.error) { problems.push(`shard ${i} did not run: ${j.error}`); continue; }
    for (const s of j.suites || []) results.push({ ...s, shard: i });
  }
  return { results, problems };
}

function ranOnce(want, results) {
  const out = [], seen = new Map();
  for (const r of results) { if (!r.missing) seen.set(r.name, [...(seen.get(r.name) || []), r.shard]); }
  for (const n of want) if (!seen.has(n)) out.push(`${n} never ran`);
  for (const [n, where] of seen) if (where.length > 1) out.push(`${n} ran ${where.length} times (shards ${where.join(", ")})`);
  const wanted = new Set(want);
  for (const n of seen.keys()) if (!wanted.has(n)) out.push(`${n} ran but is not a suite in this tree`);
  return out;
}

module.exports = { read, ranOnce };
