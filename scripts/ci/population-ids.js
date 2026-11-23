#!/usr/bin/env node
// scripts/ci/population-ids.js · DEFINE-1 item 2. A SCREEN NEVER SHOWS A POPULATION COUNT THE REGISTRY DOES NOT NAME.
//
// "Lapsed" was five populations on five screens (Atlas 173, Re-engage 295, a
// Communications audience 342, Fundraising 519 households, Groups 520 people),
// and only one pair was defined. The registry (shared/populationWords.js) names
// each one; this check keeps screens on it. It fails when:
//   1. code names a population id the registry does not have (<PopulationCount id=…>,
//      data-population=…, population("…"), unitWords("…"), describe("…"), population: "…");
//   2. one of the surfaces that count a registry population stops reading it
//      (SURFACES below: each file must still carry its marker);
//   3. a client line shows a population word (LYBUNT, SYBUNT, Lapsed, Lapsing,
//      Re-engage, Lost) beside a count without naming its population
//      (data-population / population(…) / <PopulationCount>), unless the line is in
//      the baseline (scripts/ci/population-ids.baseline.json), which may only shrink.
// usage: node scripts/ci/population-ids.js [--write-baseline]
// Planted: remove data-population="lybunt" from the Fundraising tile → 2 red;
// <PopulationCount id="lapsd"> → 1 red; a new `Lapsed: {n.toLocaleString()}` line → 3 red.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const BASELINE = path.join(__dirname, "population-ids.baseline.json");

async function main() {
  const { POPULATION_IDS } = await import(path.join(ROOT, "shared", "populationWords.js"));
  const ids = new Set(POPULATION_IDS);
  const bad = [];

  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = [...walk(path.join(ROOT, "client", "src")), ...walk(path.join(ROOT, "server")), ...walk(path.join(ROOT, "routes")),
    path.join(ROOT, "groups.js"), path.join(ROOT, "shared", "audiences.js")];

  // 1 · every id named is a registry id
  const NAMED = [
    /<PopulationCount\b[^>]*\bid=(?:"|'|\{")([a-z_]+)/g,
    /data-population=(?:"|'|\{")([a-z_]+)["']/g,
    /\bpopulation\(\s*["']([a-z_]+)["']\s*\)/g,
    /\bunitWords\(\s*["']([a-z_]+)["']/g,
    /\bdescribe\(\s*["']([a-z_]+)["']/g,
    /\bpopulation:\s*["']([a-z_]+)["']/g,
    /\bsaid\(\s*["']([a-z_]+)["']\s*\)/g,
  ];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const re of NAMED) for (const m of text.matchAll(re)) {
      if (!ids.has(m[1])) bad.push(`${path.relative(ROOT, f)}: "${m[1]}" is not a population in shared/populationWords.js`);
    }
  }

  // 2 · the surfaces that count a registry population still read it
  const SURFACES = [
    ["server/atlas/populations.js", /said\("lybunt"\)[\s\S]*said\("sybunt"\)[\s\S]*said\("lapsed"\)/, "Atlas names LYBUNT, SYBUNT and Lapsed from the registry"],
    ["client/src/components/Donors.jsx", /<PopulationCount id="reengage"/, "Re-engage shows its population under its count"],
    ["client/src/components/fundraising/OverviewPeriodBar.jsx", /data-population="lybunt"[\s\S]*data-population="lybunt_households"/, "Fundraising's LYBUNT names people and households"],
    ["client/src/components/Groups.jsx", /data-population=\{st\.population\}[\s\S]*data-population=\{g\.population\}/, "Groups' starters and rule groups name their population"],
    ["client/src/components/Communications.jsx", /data-population=\{a\.population\}/, "Communications' audiences name their population"],
    ["shared/audiences.js", /population: "donors"[\s\S]*population: "volunteers"/, "the built-in audiences are registry populations"],
  ];
  for (const [rel, re, what] of SURFACES) {
    const t = fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), "utf8") : "";
    if (!re.test(t)) bad.push(`${rel}: ${what}, and it no longer does`);
  }

  // 3 · a population word beside a count names its population (ratchet)
  const WORD = /\b(LYBUNT|SYBUNT|Lapsed|Lapsing|Re-engage|Lost)\b/;
  const COUNT = /toLocaleString|\.length\b|\bcount\b|Count\b/;
  const NAMES = /data-population|population\(|PopulationCount|populationLine/;
  const hits = [];
  for (const f of files.filter(x => x.includes(`${path.sep}client${path.sep}src${path.sep}`) && /\.jsx$/.test(x))) {
    fs.readFileSync(f, "utf8").split("\n").forEach(line => {
      const t = line.trim();
      if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) return;
      if (WORD.test(t) && COUNT.test(t) && !NAMES.test(t)) hits.push(`${path.relative(ROOT, f)} :: ${t.slice(0, 200)}`);
    });
  }
  if (process.argv.includes("--write-baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify({ note: "DEFINE-1: lines that show a population word beside a count without naming the population. This list may only shrink.", lines: hits.sort() }, null, 2) + "\n");
    console.log(`population-ids: baseline written, ${hits.length} lines`);
    return;
  }
  const base = new Set(fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")).lines : []);
  for (const h of hits) if (!base.has(h)) bad.push(`${h.split(" :: ")[0]}: a population word beside a count without its registry population (<PopulationCount id=…> or data-population): ${h.split(" :: ")[1]}`);

  if (bad.length) {
    console.error(`population-ids: ${bad.length} problem${bad.length === 1 ? "" : "s"}\n  ` + bad.join("\n  "));
    process.exit(1);
  }
  console.log(`population-ids: ok (${ids.size} populations, ${SURFACES.length} surfaces, ${hits.length} baselined lines)`);
}
main().catch(e => { console.error(e); process.exit(1); });
