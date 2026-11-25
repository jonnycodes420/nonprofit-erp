// tests/lib/surfaceCensus.js · FRESH-2 item 3. THE SCREEN HALF OF THE CENSUS (static).
//
// Reads every useLive / useLiveRead / useLiveRev("name", ["topic", ...]) call in
// client/src, and checks it against client/src/lib/surfaces.js (what each
// surface shows, by table) and shared/changeTopics.cjs (what a write to that
// table announces in X-Steward-Changed). Returns the problems, [] when clean.
// `src` (optional) replaces a file's text, so a suite can plant a defect: a
// surface that stops listening must make this fail.
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "client/src");
const CALL = /\buseLive(?:Read|Rev)?\(\s*"([a-z0-9.-]+)"\s*,\s*\[([^\]]*)\]/g;

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__") walk(p, out); }
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

// { name: { file, topics: Set } } from the source.
function listening(src = {}) {
  const found = {};
  for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    if (rel === "lib/liveRead.js") continue;   // the helper's own doc comment
    const text = rel in src ? src[rel] : fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(CALL)) {
      const topics = [...m[2].matchAll(/"([a-z]+)"/g)].map(x => x[1]);
      const was = found[m[1]];
      if (was && was.file !== rel) { found[m[1]] = { ...was, dupe: rel }; continue; }
      found[m[1]] = { file: rel, topics: new Set([...(was ? was.topics : []), ...topics]) };
    }
  }
  return found;
}

async function census({ src = {} } = {}) {
  const { SURFACES } = await import(pathToFileURL(path.join(SRC, "lib/surfaces.js")).href);
  const { KINDS } = await import(pathToFileURL(path.join(SRC, "lib/changes.js")).href);
  const CT = require(path.join(ROOT, "shared/changeTopics.cjs"));
  const heard = listening(src);
  const problems = [];
  const named = new Set(SURFACES.map(s => s.name));
  for (const [name, h] of Object.entries(heard)) {
    if (!named.has(name)) problems.push(`${name} (${h.file}) listens but is not in lib/surfaces.js: say what it shows`);
    if (h.dupe) problems.push(`${name} is used in ${h.file} and ${h.dupe}: one name, one surface`);
    for (const t of h.topics) if (!KINDS.includes(t)) problems.push(`${name} listens for "${t}", which is no topic (lib/changes.js KINDS)`);
  }
  for (const s of SURFACES) {
    const h = heard[s.name];
    if (!h) { problems.push(`${s.name} (${s.read}) no longer listens: no useLive("${s.name}", …) in client/src`); continue; }
    if (h.file !== s.file) problems.push(`${s.name} listens in ${h.file}, lib/surfaces.js says ${s.file}`);
    for (const table of s.shows) {
      const said = CT.topicsOfTable(table).filter(t => t !== "other");
      if (!said.length) { problems.push(`${s.name} shows ${table}, and a write to ${table} announces nothing (shared/changeTopics.cjs), so it never re-reads`); continue; }
      if (!said.some(t => h.topics.has(t))) problems.push(`${s.name} shows ${table}, a write to it says ${said.join(",")}, and ${s.name} listens only for ${[...h.topics].join(",") || "nothing"}`);
    }
  }
  return problems;
}

module.exports = { census, listening };
