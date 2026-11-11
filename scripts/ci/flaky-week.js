#!/usr/bin/env node
// scripts/ci/flaky-week.js · FLAKE-4. THE NEXT FLAKE BUILD'S INPUT.
//
// The nightly (.github/workflows/flaky-nightly.yml) downloads every CI run's
// flaky.json from the last seven days into <dir>/<run id>/flaky.json; this
// counts, per suite, the RUNS in which it passed only on its retry, and lists
// every suite at --min or more (default 3). One run counts once, however many
// shards named it.
//
//   node scripts/ci/flaky-week.js --in <dir> [--min 3] [--days 7] [--now <ISO>] [--out <file.md>]
//
// Prints the list (markdown). Never a gate: it always exits 0.
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf("--" + n); return i === -1 ? d : argv[i + 1]; };

function filesUnder(dir) {
  const out = [];
  const walk = d => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name === "flaky.json") out.push(p);
    }
  };
  walk(dir);
  return out;
}

function tally(reports, { min = 3, days = 7, now = Date.now() } = {}) {
  const since = now - days * 86400e3;
  const by = new Map();
  for (const r of reports) {
    const at = Date.parse(r.at || "");
    if (!Number.isFinite(at) || at < since || at > now + 3600e3) continue;
    const runKey = r.run || r.__file || at;
    for (const s of new Set((r.suites || []).map(x => x.name))) {
      const e = by.get(s) || { name: s, runs: new Set(), lastLines: [] };
      e.runs.add(String(runKey));
      const one = (r.suites || []).find(x => x.name === s);
      if (one && one.firstLast) e.lastLines.push(one.firstLast);
      by.set(s, e);
    }
  }
  return [...by.values()]
    .map(e => ({ name: e.name, times: e.runs.size, runs: [...e.runs].sort(), lastLines: [...new Set(e.lastLines)].slice(0, 3) }))
    .filter(e => e.times >= min)
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name));
}

function markdown(list, { min, days }) {
  if (!list.length) return `No suite passed only on its retry ${min}+ times in the last ${days} days.\n`;
  return [
    `**Suites flaky ${min}+ times in ${days} days** (FLAKE-4): the next FLAKE build's input.`,
    "Each count is CI runs in which the suite failed once and passed on its retry.",
    "",
    ...list.map(e => `- \`${e.name}\`: ${e.times} runs (${e.runs.join(", ")})` + (e.lastLines.length ? `. First-run last lines: ${e.lastLines.map(l => "`" + l.replace(/`/g, "'") + "`").join(" · ")}` : "")),
  ].join("\n") + "\n";
}

if (require.main === module) {
  const IN = flag("in", "/tmp/flaky-week");
  const min = Number(flag("min", "3"));
  const days = Number(flag("days", "7"));
  const now = flag("now", "") ? Date.parse(flag("now")) : Date.now();
  const reports = [];
  for (const f of filesUnder(IN)) {
    try { reports.push({ ...JSON.parse(fs.readFileSync(f, "utf8")), __file: f }); } catch { /* a torn download is skipped */ }
  }
  const md = markdown(tally(reports, { min, days, now }), { min, days });
  process.stdout.write(md);
  const OUT = flag("out", "");
  if (OUT) fs.writeFileSync(OUT, md);
}

module.exports = { tally, markdown, filesUnder };
