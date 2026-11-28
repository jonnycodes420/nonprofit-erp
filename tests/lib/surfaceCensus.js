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

// ── FRESH-5 item 2 · A SCREEN READS THROUGH liveRead, NEVER A COPY LOADED ONCE ──────────────────
// A component that reads the server (an apiFetch GET) and holds the answer with no live subscription
// (useLive / useLiveRead / useLiveRev, useChanged / useChangeRev, the profile's useProfileRefresh or
// useWriteStamp, api.js onWrite, useStewardTold) shows what it read the moment it opened, whatever is
// saved after. Each such file under components/ is listed; it fails unless it is on READS_ALLOWED with
// its reason, or on the baseline (tests/lib/readsOutsideLive.json, the files that read that way when
// the rule came in: it only shrinks, a file that starts listening comes off it).
const LIVE_HOOK = /\buseLive(?:Read|Rev)?\(|\buseChang(?:ed|eRev)\(|\buseProfileRefresh\(|\buseWriteStamp\(|\bonWrite\(|\buseStewardTold\(|\bonAnyChange\(/;
const READS_ALLOWED = {
  "components/admin/OrdersToSign.jsx": "Steward's own admin console (super admin): no org screen, it re-reads after its own writes",
  "components/admin/StartLinkPanel.jsx": "Steward's own admin console (super admin): no org screen, it re-reads after its own writes",
  "components/IdleGuard.jsx": "reads the session's idle limit once; it shows no org data",
};
function argsAt(text, at) {
  let depth = 0;
  for (let i = at; i < Math.min(text.length, at + 1500); i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(at, i + 1);
  }
  return text.slice(at, at + 1500);
}
// [file] under components/ that read with apiFetch GET and listen for nothing. `src` replaces a file's text.
function readsOutsideLive(src = {}) {
  const files = walk(path.join(SRC, "components")).map(f => path.relative(SRC, f).split(path.sep).join("/"));
  for (const extra of Object.keys(src)) if (!files.includes(extra)) files.push(extra);
  const out = [];
  for (const rel of files.sort()) {
    const text = rel in src ? src[rel] : fs.readFileSync(path.join(SRC, rel), "utf8");
    if (LIVE_HOOK.test(text)) continue;
    let reads = false;
    for (const m of text.matchAll(/\bapiFetch\(/g)) {
      const call = argsAt(text, m.index + m[0].length - 1);
      if (!/method\s*:/.test(call) || /method\s*:\s*["'`]GET["'`]/.test(call)) { reads = true; break; }
    }
    if (reads) out.push(rel);
  }
  return out;
}
const READS_BASELINE = path.join(__dirname, "readsOutsideLive.json");
function readsProblems(src = {}, { baseline = null } = {}) {
  const base = new Set(baseline || JSON.parse(fs.readFileSync(READS_BASELINE, "utf8")).files);
  const found = readsOutsideLive(src);
  const problems = found.filter(f => !READS_ALLOWED[f] && !base.has(f))
    .map(f => `${f} reads the server with apiFetch and listens for no change (no useLive, useChanged, …): what it shows stays as it was when it opened, whatever is saved after. Read it through lib/liveRead.js`);
  const now = new Set(found);
  for (const f of base) if (!now.has(f)) problems.push(`${f} is on tests/lib/readsOutsideLive.json but now listens (or is gone): take it off (the baseline only shrinks)`);
  return problems;
}

module.exports = { census, listening, readsOutsideLive, readsProblems, READS_ALLOWED };
