// routes/sheets.js · SHEETS-1. BRING IN AN OLD SPREADSHEET.
//
//   POST /sheets/read                   what Steward found in a sheet: grants, a table of numbers, or neither. Writes nothing.
//   POST /sheets/board-reports          keep a table of numbers as a board report, with its original file
//   GET  /sheets/board-reports          the board reports brought in, newest first
//   GET  /sheets/:id                    one stored sheet: its table, and every column Steward could not place
//   GET  /sheets/:id/file               the original file, as it was uploaded
//   POST /sheets/:id/remove             take one off (Undo puts it back)
//   POST /sheets/:id/restore
//   POST /sheets/:id/undo-grant-import  Undo of a grant import: the grants it made, and the kept file
//
// The file is read in the browser (the one reader, parseFileToSheets) and the
// rows come here with the original bytes. A grant tracker goes into the
// pipeline through POST /grants/import, the one grant importer, which stores
// the file and its unplaced columns through prepareSheetFile/sheetRowTx below.
// Nothing is guessed: a column that is not a grant field is listed and kept
// with the file, never dropped and never squeezed into a field. Every write is
// recorded by the one audit write; nothing here writes one.
"use strict";
const express = require("express");
const F = require("../interactionFiles");

const routers = { r0: express.Router() };
const grantImportMod = () => import("../shared/grantImport.js");
const SHEET_ASSET_KIND = "sheetfile";
const SHEET_MAX_BYTES = 10 * 1024 * 1024;   // with the 16mb parser in server.js: move both or neither
const SHEET_MIME = ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"];
const MAX_ROWS = 5000, MAX_COLS = 80;
const TYPES_SENTENCE = "Steward reads Excel (.xlsx, .xls) and CSV files.";

let C = null;

// A cell that reads as a number: $1,250.00, (300), 12%, 4.5. Never a date.
function numberish(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(s)) return false;
  return /^\(?-?[$£€]?\s?\d[\d,]*(\.\d+)?\)?%?$/.test(s);
}

// Rows as arrays aligned to the headers, whatever shape the reader gave.
function tableOf(headers, rows) {
  const hs = (Array.isArray(headers) ? headers : []).map(h => String(h == null ? "" : h).trim()).slice(0, MAX_COLS);
  const rs = (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map(r => Array.isArray(r)
    ? hs.map((_, i) => (r[i] == null ? "" : String(r[i])))
    : hs.map(h => (r && r[h] != null ? String(r[h]) : "")))
    .filter(r => r.some(c => String(c).trim() !== ""));
  return { headers: hs, rows: rs };
}

// What this sheet is. Grants when it names a funder and an amount; a table of
// numbers when at least one column is mostly numbers; otherwise neither, said
// plainly, and nothing is stored.
async function readSheet(headers, rows) {
  const I = await grantImportMod();
  const t = tableOf(headers, rows);
  if (!t.headers.length || !t.rows.length) return { kind: "nothing", headers: t.headers, rowCount: 0, sentence: "The sheet has no rows under its headings, so there is nothing to bring in." };
  const gm = I.grantMapping(t.headers);
  const m = gm.mapping || {};
  const placed = new Set(Object.values(m));
  const unplacedCols = t.headers.filter(h => h && !placed.has(h));
  const numericCols = t.headers.filter((h, i) => {
    const vals = t.rows.map(r => r[i]).filter(v => String(v).trim() !== "");
    return vals.length && vals.filter(numberish).length / vals.length >= 0.6;
  });
  if (m.funderName && (m.amountRequested || m.amountAwarded)) {
    return { kind: "grants", headers: t.headers, rowCount: t.rows.length, mapping: m,
      unplaced: unplacedCols, unrecognised: gm.unrecognised || [],
      sentence: `This looks like a grant tracker: ${t.rows.length} ${t.rows.length === 1 ? "row" : "rows"}, with the funder in "${m.funderName}" and the amount in "${m.amountAwarded || m.amountRequested}".`
        + (unplacedCols.length ? ` ${unplacedCols.length === 1 ? "One column is" : unplacedCols.length + " columns are"} not a grant field (${unplacedCols.join(", ")}) and will be kept with the file, not dropped.` : "") };
  }
  if (numericCols.length && t.headers.length >= 2) {
    return { kind: "board_report", headers: t.headers, rowCount: t.rows.length, numericColumns: numericCols, preview: t.rows.slice(0, 12),
      sentence: `This looks like a table of numbers: ${t.rows.length} ${t.rows.length === 1 ? "row" : "rows"} and ${t.headers.length} columns, ${numericCols.length} of them numbers. It can be kept as a board report, exactly as it is.` };
  }
  return { kind: "nothing", headers: t.headers, rowCount: t.rows.length,
    sentence: "Steward found neither grants (a funder and an amount) nor a column of numbers in this sheet, so it will not guess. Save the sheet with a heading row and try again." };
}

// The original file, checked and put in the asset store. Returns
// { asset, contentType, bytes, fileName } or { error, sentence }.
async function prepareSheetFile(orgId, body) {
  const m = /^data:([^;,]*);base64,(.*)$/s.exec(String((body && body.file) || ""));
  if (!m) return { error: "no_file", sentence: "The original file did not arrive. Choose it again." };
  const fileName = F.sanitizeFilename(String(body.fileName || "spreadsheet"));
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName) || [])[1] || "";
  const contentType = F.resolveMime(m[1], fileName);
  if (!SHEET_MIME.includes(contentType)) return { error: "bad_type", sentence: `That file is not a spreadsheet. ${TYPES_SENTENCE}` };
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > SHEET_MAX_BYTES) return { error: "too_big", sentence: "That file is over 10 MB. Save the sheet you need on its own and try again." };
  if (!F.bytesMatchMime(buffer, contentType)) return { error: "bad_bytes", sentence: `The file says it is .${ext || "a spreadsheet"} but its contents are not. ${TYPES_SENTENCE}` };
  const asset = await C.putThemeAsset({ orgId, kind: SHEET_ASSET_KIND, buffer, contentType });
  return { asset, contentType, bytes: buffer.length, fileName };
}

// The stored_sheets row, inside the caller's transaction (the grant import's).
// The unplaced columns keep their values line by line.
async function sheetRowTx(runTx, { orgId, kind, title, periodLabel, file, sheetName, headers, rows, unplacedCols, grantIds, who }) {
  const t = tableOf(headers, rows);
  const idx = unplacedCols.map(h => t.headers.indexOf(h)).filter(i => i >= 0);
  const unplaced = { columns: idx.map(i => t.headers[i]),
    rows: t.rows.map((r, n) => ({ line: n + 1, values: Object.fromEntries(idx.map(i => [t.headers[i], r[i]])) }))
      .filter(x => Object.values(x.values).some(v => String(v).trim() !== "")) };
  const id = "sht_" + C.uuid().replace(/-/g, "").slice(0, 14);
  await runTx(`INSERT INTO stored_sheets (id,org_id,kind,title,period_label,file_name,content_type,bytes,asset_id,sheet_name,headers,rows,unplaced,grant_ids,created_by,created_by_name)
               VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?,?)`,
    [id, orgId, kind, String(title || file.fileName).slice(0, 200), periodLabel ? String(periodLabel).slice(0, 80) : null,
     file.fileName, file.contentType, file.bytes, file.asset.id, sheetName ? String(sheetName).slice(0, 120) : null,
     JSON.stringify(kind === "board_report" ? t.headers : unplaced.columns), JSON.stringify(kind === "board_report" ? t.rows : []),
     JSON.stringify(unplaced), JSON.stringify(grantIds || []), who.id, who.name]);
  return { id, unplaced };
}

function mount(ctx) {
C = ctx;
const { query, run, wrap, requireAuth, checkWriteAccess, actor } = ctx;
const app = routers.r0;

const rowOut = r => ({ id: r.id, kind: r.kind, title: r.title, periodLabel: r.period_label || null, fileName: r.file_name, contentType: r.content_type,
  bytes: r.bytes, sheetName: r.sheet_name || null, rowCount: Array.isArray(r.rows) ? r.rows.length : 0, grantCount: Array.isArray(r.grant_ids) ? r.grant_ids.length : 0,
  unplacedColumns: (r.unplaced && r.unplaced.columns) || [], createdAt: r.created_at, createdByName: r.created_by_name || "", removed: !!r.removed_at });

app.post("/sheets/read", requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  res.json({ ...(await readSheet(b.headers, b.rows)), fileName: String(b.fileName || ""), sheetName: b.sheetName || null, wrote: false });
}));

app.post("/sheets/board-reports", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  const found = await readSheet(b.headers, b.rows);
  if (found.kind === "nothing") return res.status(400).json({ error: "no_table", sentence: found.sentence });
  const file = await prepareSheetFile(orgId, b);
  if (file.error) return res.status(400).json(file);
  const a = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [a.id, orgId]);
  const who = { id: a.id, name: (u && u.name) || a.name };
  const { id } = await sheetRowTx((sql, args) => run(sql, args), { orgId, kind: "board_report", title: String(b.title || "").trim() || file.fileName.replace(/\.[^.]+$/, ""),
    periodLabel: b.periodLabel, file, sheetName: b.sheetName, headers: b.headers, rows: b.rows, unplacedCols: [], grantIds: [], who });
  const [row] = await query(`SELECT * FROM stored_sheets WHERE id=?`, [id]);
  res.status(201).json({ ...rowOut(row), sentence: `Kept "${row.title}" under Reports, with ${file.fileName} attached.` });
}));

app.get("/sheets/board-reports", requireAuth, wrap(async (req, res) => {
  const rows = await query(`SELECT * FROM stored_sheets WHERE org_id=? AND kind='board_report' AND removed_at IS NULL ORDER BY created_at DESC`, [req.user.orgId]);
  res.json({ reports: rows.map(rowOut) });
}));

app.get("/sheets/:id", requireAuth, wrap(async (req, res) => {
  const [r] = await query(`SELECT * FROM stored_sheets WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json({ ...rowOut(r), headers: r.headers || [], rows: r.rows || [], unplaced: r.unplaced || {}, grantIds: r.grant_ids || [] });
}));

app.get("/sheets/:id/file", requireAuth, wrap(async (req, res) => {
  const [r] = await query(`SELECT * FROM stored_sheets WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  const { getThemeAsset } = require("../assetStore");
  const a = await getThemeAsset(r.asset_id);
  if (!a || a.orgId !== req.user.orgId) return res.status(404).json({ error: "file_gone", sentence: "The original file is no longer there." });
  res.setHeader("Content-Type", r.content_type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${String(r.file_name).replace(/["\\\r\n]/g, "")}"`);
  res.send(a.buffer);
}));

for (const [verb, val] of [["remove", "NOW()"], ["restore", "NULL"]]) {
  app.post(`/sheets/:id/${verb}`, requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const [r] = await query(`SELECT id FROM stored_sheets WHERE id=? AND org_id=?`, [req.params.id, req.user.orgId]);
    if (!r) return res.status(404).json({ error: "Not found" });
    await run(`UPDATE stored_sheets SET removed_at=${val} WHERE id=? AND org_id=?`, [r.id, req.user.orgId]);
    res.json({ ok: true, id: r.id });
  }));
}

// Undo of a grant import, offered on the toast straight after it: the grants
// it made come off, unless somebody has already added to one (a deadline, a
// document, an award, a report), and the kept file goes with them. Funders it
// created stay on file, because they are people records now and may already
// carry more.
app.post("/sheets/:id/undo-grant-import", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [r] = await query(`SELECT * FROM stored_sheets WHERE id=? AND org_id=? AND kind='grant_import'`, [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  const ids = Array.isArray(r.grant_ids) ? r.grant_ids : [];
  const touched = ids.length ? await query(
    `SELECT g.id FROM grants g WHERE g.org_id=? AND g.id = ANY(?::text[]) AND (g.award_pledge_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM grant_milestones m WHERE m.grant_id=g.id) OR EXISTS (SELECT 1 FROM grant_documents d WHERE d.grant_id=g.id)
        OR EXISTS (SELECT 1 FROM grant_reports x WHERE x.grant_id=g.id))`, [orgId, ids]) : [];
  if (touched.length) return res.status(409).json({ error: "touched", sentence: `${touched.length === 1 ? "One of these grants has" : touched.length + " of these grants have"} been added to since, so they are kept. Take them off one at a time if you mean to.` });
  if (ids.length) await run(`DELETE FROM grants WHERE org_id=? AND id = ANY(?::text[])`, [orgId, ids]);
  await run(`UPDATE stored_sheets SET removed_at=NOW() WHERE id=? AND org_id=?`, [r.id, orgId]);
  res.json({ ok: true, removed: ids.length });
}));
}

module.exports = { routers, mount, readSheet, prepareSheetFile, sheetRowTx, SHEET_MAX_BYTES, TYPES_SENTENCE };
