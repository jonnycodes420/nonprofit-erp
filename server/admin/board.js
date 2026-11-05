// DEVBOARD-1 · THE BOARD: the one place every finding lands.
//
// ops/board.json is a versioned file in the repo. Each item is one finding:
//   { id, source, check, words, build, state, customer, opened, fixedBy, history }
// source: walk | customer | build follow-up.
// state:  open → fixed (its build merged) → verified (passed the next walk),
//         or reopened (a fixed or verified check failed again).
// walks:  one row per imported walk report, { date, pass, fail, skip, file },
//         which the /ops walk trend draws.
// results: (DEVBOARD-2) the last verdict per check, { [key]: { check, verdict,
//         date, words } }, which the Map tab shows in the check's area.
//
// Pure functions only: the import script (scripts/ops/board-import-walk.js),
// the board script (scripts/ops/board.js) and the /ops route all read this,
// so the page and the scripts can never disagree about a state.
"use strict";

const fs = require("fs");
const path = require("path");

const BOARD_PATH = path.join(__dirname, "..", "..", "ops", "board.json");
const STATES = ["open", "fixed", "verified", "reopened"];
const SOURCES = ["walk", "customer", "build follow-up"];
const EMPTY = () => ({ version: 1, items: [], walks: [] });

function readBoard(file = BOARD_PATH) {
  let b;
  try { b = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return EMPTY(); throw e; }
  const problems = validate(b);
  if (problems.length) throw new Error(`${path.basename(file)} is not a board: ${problems.slice(0, 3).join("; ")}`);
  return b;
}
function writeBoard(board, file = BOARD_PATH) {
  board.items.sort((a, b) => a.id.localeCompare(b.id));
  board.walks.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(file, JSON.stringify(board, null, 2) + "\n");
}
function validate(b) {
  const out = [];
  if (!b || !Array.isArray(b.items) || !Array.isArray(b.walks)) return ["needs items[] and walks[]"];
  if (b.results != null && (typeof b.results !== "object" || Array.isArray(b.results))) return ["results must be an object of check → last verdict"];
  const seen = new Set();
  for (const it of b.items) {
    if (!it.id || seen.has(it.id)) out.push(`id ${it.id || "(none)"} missing or repeated`);
    seen.add(it.id);
    if (!STATES.includes(it.state)) out.push(`${it.id}: state "${it.state}" is not one of ${STATES.join(", ")}`);
    if (!SOURCES.includes(it.source)) out.push(`${it.id}: source "${it.source}" is not one of ${SOURCES.join(", ")}`);
  }
  return out;
}

// ── Reading a walk report (Muse's markdown) ──────────────────────────────────
// One verdict per line, in a table row or a list line, in any of the shapes a
// walk writes: "| Prof4 | FAIL | words |", "- FAIL Prof4: words",
// "- **Prof4** ❌ FAIL — words", "W-1105-Prof4 · PASS". The check's key is
// its id without the date (Prof4), so tomorrow's PASS finds today's FAIL.
const VERDICT_RE = /\b(PASS|FAIL|SKIP)(?:ED|PED)?\b/;
const CHECK_RE = /^(?:W-\d{4}-)?([A-Za-z][A-Za-z]*[-.]?\d+[a-z]?)$/;
const clean = s => String(s).replace(/[*_`]/g, "").replace(/[✅❌⏭️⚠️✔✗✘☑]/gu, " ").replace(/\s+/g, " ").trim();

function walkDate(text, fileName = "") {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(fileName) || /^(?:#|date|walk)[^\n]*?(\d{4}-\d{2}-\d{2})/im.exec(text);
  return m ? m[1] : null;
}
function parseWalk(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*\|?\s*:?-{3,}/.test(raw)) continue;                     // a table's rule line
    const line = clean(raw);
    const v = VERDICT_RE.exec(line);
    if (!v) continue;
    const verdict = v[1];
    const cells = raw.includes("|") ? raw.split("|").map(clean).filter(Boolean)
      : line.replace(/^[-+>\d.)\s]+/, "").split(/\s+/).map(t => t.replace(/^[(\[]|[:,;·)\]]+$/g, "")).filter(Boolean);
    const id = cells.map(c => CHECK_RE.exec(c)).find(Boolean);
    if (!id) continue;
    const check = id[1];
    let words = raw.includes("|")
      ? cells.filter(c => c !== id[0] && !VERDICT_RE.test(c) && c !== check).sort((a, b) => b.length - a.length)[0] || ""
      : line.replace(/^[-+>\d.)\s]+/, "").replace(id[0], "").replace(VERDICT_RE, "").replace(/^[\s:·—–-]+|[\s:·—–-]+$/g, "").replace(/\s+[:·—–]\s+/g, " — ").trim();
    rows.push({ check, verdict, words: words.replace(/^[\s:·—–-]+/, "") });
  }
  // One verdict per check: a later line (a re-check in the same walk) wins.
  const byCheck = new Map();
  for (const r of rows) byCheck.set(r.check.toLowerCase(), r);
  return [...byCheck.values()];
}

const mmdd = date => date.slice(5, 7) + date.slice(8, 10);
const note = (it, on, state, by) => { it.history = it.history || []; it.history.push({ on, state, by }); };

// Apply one walk to the board. Returns { board, changes } and never touches
// the board it was handed (the import is a dry run until --write).
function applyWalk(board, verdicts, { date, file = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("the walk needs a date (YYYY-MM-DD)");
  const next = JSON.parse(JSON.stringify(board));
  const changes = { added: [], verified: [], reopened: [], stillOpen: [] };
  const by = `walk ${date}`;
  const walkItems = new Map(next.items.filter(i => i.source === "walk" && i.check).map(i => [i.check.toLowerCase(), i]));
  for (const v of verdicts) {
    const it = walkItems.get(v.check.toLowerCase());
    if (v.verdict === "FAIL") {
      if (!it) {
        let id = `W-${mmdd(date)}-${v.check}`;
        while (next.items.some(i => i.id === id)) id += "x";
        const item = { id, source: "walk", check: v.check, words: v.words, build: null, state: "open", customer: null, opened: date, fixedBy: null, history: [] };
        note(item, date, "open", by);
        next.items.push(item); walkItems.set(v.check.toLowerCase(), item); changes.added.push(id);
      } else if (it.state === "fixed" || it.state === "verified") {
        it.state = "reopened"; it.words = v.words || it.words; note(it, date, "reopened", by); changes.reopened.push(it.id);
      } else changes.stillOpen.push(it.id);
    } else if (v.verdict === "PASS" && it && it.state !== "verified") {
      it.state = "verified"; note(it, date, "verified", by); changes.verified.push(it.id);
    }
  }
  // DEVBOARD-2: the last verdict per check, which the Map tab shows in its area.
  // An older walk imported after a newer one never overwrites the newer verdict.
  next.results = next.results || {};
  for (const v of verdicts) {
    const k = v.check.toLowerCase().replace(/[^a-z0-9]/g, "");
    const was = next.results[k];
    if (!was || was.date <= date) next.results[k] = { check: v.check, verdict: v.verdict, date, words: v.words || "" };
  }
  const count = k => verdicts.filter(v => v.verdict === k).length;
  next.walks = next.walks.filter(w => w.date !== date);
  next.walks.push({ date, pass: count("PASS"), fail: count("FAIL"), skip: count("SKIP"), file });
  return { board: next, changes };
}

// A build report names the items it closes on a line of its own:
//   "Closes: W-1105-Prof4, C-Allie-grant-payment"
const closesIn = text => {
  const ids = [];
  for (const m of String(text).matchAll(/^\W*closes(?: board)?\W*:?\s*(.+)$/gim))
    for (const id of m[1].split(/[\s,;]+/).map(clean).filter(Boolean)) if (/^[WCB]-/.test(id)) ids.push(id);
  return [...new Set(ids)];
};
function closeItems(board, ids, { build, date }) {
  const next = JSON.parse(JSON.stringify(board));
  const done = [], missing = [];
  for (const id of ids) {
    const it = next.items.find(i => i.id === id);
    if (!it) { missing.push(id); continue; }
    if (it.state === "fixed" && it.fixedBy === build) continue;
    it.state = "fixed"; it.fixedBy = build; if (!it.build) it.build = build;
    note(it, date, "fixed", `build ${build}`); done.push(id);
  }
  return { board: next, done, missing };
}

// What /ops shows: items grouped by owning build, counts per state.
function summarize(board) {
  const counts = Object.fromEntries(STATES.map(s => [s, 0]));
  for (const it of board.items) counts[it.state]++;
  const groups = new Map();
  for (const it of board.items) {
    const k = it.build || "";
    if (!groups.has(k)) groups.set(k, { build: it.build || null, counts: Object.fromEntries(STATES.map(s => [s, 0])), items: [] });
    const g = groups.get(k); g.counts[it.state]++;
    g.items.push({ id: it.id, source: it.source, words: it.words, state: it.state, customer: it.customer || null, opened: it.opened || null, fixedBy: it.fixedBy || null,
      check: it.check || null, area: it.area || null, shot: it.shot || null, verifiedBy: it.verifiedBy || null });   // DEVBOARD-2
  }
  const live = g => g.counts.open + g.counts.reopened;
  const builds = [...groups.values()].sort((a, b) => live(b) - live(a) || String(a.build || "~").localeCompare(String(b.build || "~")));
  return { counts, builds, walks: board.walks.slice(-30) };
}

module.exports = { BOARD_PATH, STATES, SOURCES, readBoard, writeBoard, validate, parseWalk, walkDate, applyWalk, closesIn, closeItems, summarize };
