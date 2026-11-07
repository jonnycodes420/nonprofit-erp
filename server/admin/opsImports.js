// LEAD-IMPORT-1 · REPORTS UPLOADED ON /ops, AND THE BOARD THEY MAKE.
//
// A walk report or a lead summary uploaded on /ops is one row of ops_imports:
// its text, its file name, its date and a hash of its text. The table is
// append-only to this code, and the hash is unique, so the same file uploaded
// again adds nothing. The board is never stored: it is ops/board.json (the
// repo's, as before) with every uploaded report applied in date order, and the
// build closes recorded in board.json's `closed` (an item that exists only in
// an upload is closed there by scripts/ops/board.js close). So the page, the
// preview and a re-import all read one answer, worked out the same way.
"use strict";
const crypto = require("crypto");
const BOARD = require("./board");
const LEAD = require("./leadImport");

const TEXT_MAX = 500_000;     // characters: a morning's summary is a few KB

function ensureTable(run) {
  if (!ensureTable.p) ensureTable.p = run(`CREATE TABLE IF NOT EXISTS ops_imports (
      id TEXT PRIMARY KEY, seq BIGSERIAL, shape TEXT NOT NULL CHECK (shape IN ('walk','lead')),
      report_date TEXT NOT NULL, file_name TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE, body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL, created_by TEXT NOT NULL, created_by_name TEXT NOT NULL)`, [])
    .catch(e => { ensureTable.p = null; throw e; });
  return ensureTable.p;
}
// A read never makes the table: before the first boot has, there are no uploads.
async function readImports(query) {
  return query(`SELECT id, seq, shape, report_date, file_name, sha256, body, created_at, created_by_name FROM ops_imports ORDER BY seq`, [])
    .catch(e => { if (e && (e.code === "42P01" || /ops_imports.*does not exist/.test(e.message))) return []; throw e; });
}

const normText = t => String(t).replace(/\r\n?/g, "\n").replace(/\s+$/, "") + "\n";
const shaOf = t => crypto.createHash("sha256").update(normText(t)).digest("hex");

// The board: board.json, then each upload (and each recorded close) in date order.
function deriveBoard(base, imports) {
  let board = JSON.parse(JSON.stringify(base));
  const closed = board.closed || [];
  const events = [
    ...imports.map(i => ({ on: i.report_date, order: 0, seq: Number(i.seq) || 0, i })),
    ...closed.map((c, n) => ({ on: c.on, order: 1, seq: n, c })),
  ].sort((a, b) => a.on.localeCompare(b.on) || a.order - b.order || a.seq - b.seq);
  const problems = [];
  for (const e of events) {
    if (e.i) {
      try { board = LEAD.readReport(e.i.body, e.i.file_name).apply(board, e.i.report_date).board; }
      catch (err) { problems.push(`${e.i.file_name}: ${err.message}`); }
    } else {
      const it = board.items.find(x => x.id === e.c.id);
      if (it && !(it.state === "fixed" && it.fixedBy === e.c.build)) {
        it.state = "fixed"; it.fixedBy = e.c.build; if (!it.build) it.build = e.c.build;
        (it.history = it.history || []).push({ on: e.c.on, state: "fixed", by: `build ${e.c.build}` });
      }
    }
  }
  if (problems.length) board.importProblems = problems;
  return board;
}

// What adding one report would do: the board before and after, item by item.
function diffBoards(before, after, report) {
  const was = new Map(before.items.map(i => [i.id, i]));
  const changes = { added: [], verified: [], reopened: [], stillOpen: [] };
  for (const it of after.items) {
    const b = was.get(it.id);
    if (!b) changes.added.push(it.id);
    else if (b.state !== it.state && it.state === "verified") changes.verified.push(it.id);
    else if (b.state !== it.state && it.state === "reopened") changes.reopened.push(it.id);
  }
  const named = new Set((report.shape === "lead" ? report.lead.items.map(i => i.check) : report.verdicts.filter(v => v.verdict === "FAIL").map(v => v.check)).map(c => c.toLowerCase()));
  for (const it of after.items) if (named.has(String(it.check || "").toLowerCase()) && was.has(it.id) && ["open", "reopened"].includes(was.get(it.id).state) && !changes.reopened.includes(it.id)) changes.stillOpen.push(it.id);
  return changes;
}

// Read an uploaded file: refuses what is not a report, says what it would do.
function preview(base, imports, { text, fileName }) {
  if (typeof text !== "string" || !text.trim()) return { error: "empty", message: "The file is empty." };
  if (text.length > TEXT_MAX) return { error: "too_big", message: "That file is too big to be a walk report." };
  const name = String(fileName || "").split(/[\\/]/).pop().slice(0, 120);
  if (!/\.md$/i.test(name)) return { error: "not_md", message: "Upload the report as a .md file." };
  const report = LEAD.readReport(text, name);
  if (!report.date) return { error: "no_date", message: "No date in the file name or its first heading (YYYY-MM-DD)." };
  if (!report.count) return { error: "no_lines", message: "No result lines were found in that file.", shape: report.shape, unread: report.unread };
  const sha = shaOf(text);
  const duplicate = imports.find(i => i.sha256 === sha) || null;
  const before = deriveBoard(base, imports);
  const after = duplicate ? before : deriveBoard(base, [...imports, { seq: Number.MAX_SAFE_INTEGER, shape: report.shape, report_date: report.date, file_name: name, body: text }]);
  const items = report.shape === "lead"
    ? [...report.lead.items].sort(LEAD.leadOrder).map(i => ({ id: i.id, tier: i.tier, area: i.area, fleetArea: i.fleetArea, check: i.check, seen: i.seen, words: i.words, evidence: i.evidence, verdict: "FAIL" }))
      .concat(report.lead.passes.map(p => ({ id: p.id, area: p.area, check: p.check, verdict: "PASS" })))
    : report.verdicts.map(v => ({ check: v.check, verdict: v.verdict, words: v.words }));
  // What each line does, by the board item it lands on (a REPEAT keeps the first day's ID).
  const changes = duplicate ? { added: [], verified: [], reopened: [], stillOpen: [] } : diffBoards(before, after, report);
  const onBoard = new Map(after.items.filter(i => i.source === "walk" && i.check).map(i => [i.check.toLowerCase(), i.id]));
  for (const it of items) {
    const id = onBoard.get(String(it.check).toLowerCase()) || null;
    it.itemId = id;
    it.effect = !id || duplicate ? null : changes.added.includes(id) ? "new item" : changes.reopened.includes(id) ? `reopens ${id}`
      : changes.verified.includes(id) ? `verifies ${id}` : changes.stillOpen.includes(id) ? `already open as ${id}` : null;
  }
  return { shape: report.shape, date: report.date, file: name, sha, items, unread: report.unread,
    duplicate: duplicate ? { file: duplicate.file_name, at: new Date(duplicate.created_at).toISOString(), by: duplicate.created_by_name } : null,
    changes };
}

// "This morning": the latest upload, its counts by tier, its top five in the
// lead's order with each item's state now, and the items verified on its day or
// the day before (a walk's PASS, a lead's "passing again", or a Pass on the Map).
function morning(board, imports) {
  if (!imports.length) return null;
  const last = [...imports].sort((a, b) => a.report_date.localeCompare(b.report_date) || Number(a.seq) - Number(b.seq)).pop();
  const report = LEAD.readReport(last.body, last.file_name);
  const d = new Date(last.report_date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  const byCheck = new Map(board.items.filter(i => i.check).map(i => [i.check.toLowerCase(), i]));
  const fails = report.shape === "lead"
    ? [...report.lead.items].sort(LEAD.leadOrder).map(i => ({ id: i.id, tier: i.tier, seen: i.seen, area: i.area, fleetArea: i.fleetArea, words: i.words, evidence: i.evidence, check: i.check }))
    : report.verdicts.filter(v => v.verdict === "FAIL").map(v => ({ id: null, tier: null, seen: null, words: v.words, check: v.check }));
  const top = fails.slice(0, 5).map(f => { const it = byCheck.get(f.check.toLowerCase()); return { ...f, id: (it && it.id) || f.id, state: it ? it.state : "open" }; });
  const tiers = Object.fromEntries(Object.keys(LEAD.TIERS).map(k => [k, fails.filter(f => f.tier === Number(k)).length]));
  const verifiedOn = it => {
    if (it.state !== "verified") return null;
    if (it.verifiedAt) return String(it.verifiedAt).slice(0, 10);
    const h = (it.history || []).filter(x => x.state === "verified").pop();
    return h ? h.on : null;
  };
  const verified = board.items.filter(it => { const on = verifiedOn(it); return on && on >= yesterday; }).map(it => it.id);
  return { date: last.report_date, file: last.file_name, shape: report.shape, uploadedAt: new Date(last.created_at).toISOString(), by: last.created_by_name,
    fails: fails.length, tiers, tierNames: LEAD.TIERS, top, verifiedSinceYesterday: verified.length, verifiedIds: verified, yesterday };
}

// The board the page shows, from board.json and every upload.
async function currentBoard(query) {
  return deriveBoard(BOARD.readBoard(), await readImports(query));
}

module.exports = { TEXT_MAX, ensureTable, readImports, shaOf, deriveBoard, diffBoards, preview, morning, currentBoard };
