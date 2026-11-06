// DEVBOARD-3 · THE HOW-IT-WORKS TAB: how a gift flows through Steward.
//
// ops/flow.json draws it: each box names its stage, the modules it lives in
// (paths from the repo root), the queue jobs it runs on and its Map area.
// tests/devboard3-journey.test.js fails when a named module stops existing,
// so the diagram cannot go stale silently; the page also marks a missing one.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const FLOW_PATH = path.join(ROOT, "ops", "flow.json");

function validateFlow(f, root = ROOT) {
  const out = [];
  if (!f || !Array.isArray(f.boxes) || !Array.isArray(f.stages)) return ["needs stages[] and boxes[]"];
  const ids = new Set();
  for (const b of f.boxes) {
    if (!b.id || ids.has(b.id)) out.push(`box id ${b.id || "(none)"} missing or repeated`);
    ids.add(b.id);
    if (!b.title) out.push(`${b.id}: no title`);
    if (!(Number.isInteger(b.stage) && b.stage >= 0 && b.stage < f.stages.length)) out.push(`${b.id}: stage ${b.stage} is not a stage`);
    if (!Array.isArray(b.modules) || !b.modules.length) out.push(`${b.id}: names no module`);
    for (const m of b.modules || []) {
      if (typeof m !== "string" || m.startsWith("/") || m.includes("..")) { out.push(`${b.id}: ${m} is not a repo path`); continue; }
      if (!fs.existsSync(path.join(root, m))) out.push(`${b.id}: ${m} does not exist`);
    }
  }
  for (const e of f.edges || []) if (!Array.isArray(e) || !ids.has(e[0]) || !ids.has(e[1])) out.push(`edge ${JSON.stringify(e)} names an unknown box`);
  return out;
}

function readFlow(file = FLOW_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// The one answer of GET /ops/flow. `jobs`: { [name]: { lastDone, waiting, running, dead } };
// `health`: the Machine tab's worker and queue reports; `areas`: GET /ops/map's areas.
function buildFlow(f, { jobs = {}, health = {}, areas = [] } = {}, root = ROOT) {
  const areaOf = new Map(areas.map(a => [a.id, a]));
  const boxes = f.boxes.map(b => {
    const a = areaOf.get(b.area);
    const checks = a ? a.checks : [];
    return {
      id: b.id, stage: b.stage, title: b.title, says: b.says || "",
      modules: b.modules.map(m => ({ path: m, exists: fs.existsSync(path.join(root, m)) })),
      jobs: (b.jobs || []).map(n => ({ name: n, ...(jobs[n] || { lastDone: null, waiting: 0, running: 0, dead: 0 }) })),
      area: a ? { id: a.id, name: a.name, checks: checks.length,
        passed: checks.filter(c => c.walk && c.walk.verdict === "PASS").length,
        failed: checks.filter(c => c.walk && c.walk.verdict === "FAIL").length,
        open: (a.items || []).length } : null,
    };
  });
  return { ok: true, stages: f.stages, boxes, edges: f.edges || [], health, problems: validateFlow(f, root) };
}

module.exports = { FLOW_PATH, readFlow, validateFlow, buildFlow };
