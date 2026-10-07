// routes/oldReports.js · REPORTS-5. BRING YOUR OLD REPORTS WITH YOU.
//
//   POST /old-reports/read                   what Steward makes of one file: the kind of report, the system it
//                                            came from and why, the period, a preview, and whether its numbers
//                                            can be read. Writes nothing.
//   POST /old-reports/preview                what a mapping would pull in from a table already read: the totals,
//                                            their sum, and whether it matches the file's own Total line. Writes nothing.
//   POST /old-reports/batches                start one import (everything in it undoes together)
//   POST /old-reports/batches/:id/files      keep one file, and if asked, pull its numbers in as historical totals
//   POST /old-reports/batches/:id/undo       take the whole import back out: every file and every total
//   GET  /old-reports                        the past reports kept, newest first, with what was pulled in
//
// One wizard behind two doors (Reports and the Import menu) calls these. The
// file is ALWAYS kept, exactly as it came. Numbers are pulled in only from a
// table Steward can read (a CSV, an Excel sheet, or a PDF with real text), only
// as the person mapped them, and only as HISTORICAL TOTALS (oldReports.js):
// never gifts, never people. A scanned PDF is kept and said to be unreadable.
// Every write is recorded by the one audit write; nothing here writes one.
"use strict";
const express = require("express");
const F = require("../interactionFiles");
const O = require("../oldReports");

const routers = { r0: express.Router() };
const ASSET_KIND = "sheetfile";   // the same kind of kept file as SHEETS-1, kept live the same way
let C = null;

// The file, decoded and checked. Returns { buffer, contentType, fileName, ext } or { error, sentence }.
function decodeFile(body) {
  const m = /^data:([^;,]*);base64,(.*)$/s.exec(String((body && body.file) || ""));
  if (!m) return { error: "no_file", sentence: "The file did not arrive. Choose it again." };
  const fileName = F.sanitizeFilename(String(body.fileName || "report"));
  const ext = ((/\.([a-z0-9]+)$/i.exec(fileName) || [])[1] || "").toLowerCase();
  const contentType = O.TYPES[ext] || F.resolveMime(m[1], fileName);
  if (!Object.values(O.TYPES).includes(contentType)) return { error: "bad_type", sentence: `Steward cannot keep that kind of file. It takes ${O.TYPES_SENTENCE}` };
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > O.MAX_BYTES) return { error: "too_big", sentence: `${fileName} is over 25 MB. Save the pages you need as a smaller file and try again.` };
  if (contentType !== "text/csv" && !F.bytesMatchMime(buffer, contentType)) return { error: "bad_bytes", sentence: `${fileName} says it is .${ext} but its contents are not.` };
  return { buffer, contentType, fileName, ext };
}

// What Steward reads in a file: its table (from the browser for Excel, read
// here for CSV and PDF), its text, and whether there is anything to read.
async function readFile(file, body) {
  if (file.ext === "pdf") {
    let pdf;
    try { pdf = await O.readPdf(file.buffer); }
    catch { return { table: null, text: "", pages: null, scanned: false, broken: true }; }
    return { table: pdf.scanned ? null : O.tableFromLines(pdf.lines), text: pdf.text, pages: pdf.pages, scanned: pdf.scanned };
  }
  if (file.ext === "csv") {
    const t = O.parseCsv(file.buffer.toString("utf8"));
    return { table: t.headers.length ? t : null, text: "", pages: null, scanned: false };
  }
  const hs = Array.isArray(body.headers) ? body.headers.map(h => String(h ?? "").trim()).slice(0, 80) : [];
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000).map(r => hs.map((_, i) => String((Array.isArray(r) ? r[i] : r && r[hs[i]]) ?? "").trim())) : [];
  return { table: hs.length ? { headers: hs, rows } : null, text: String(body.sheetName || ""), pages: null, scanned: false };
}

function readableSentence(r, file) {
  if (r.broken) return `${file.fileName} could not be opened as a PDF. It can still be kept as a file.`;
  if (r.scanned) return `${file.fileName} is a scan: its pages are pictures, with no text in them. It is kept as a file, and its numbers cannot be read. Steward does not guess at numbers in a picture.`;
  if (!r.table) return `Steward found no table in ${file.fileName}. It is kept as a file, with no numbers pulled in.`;
  return `Steward can read a table of ${r.table.rows.length} ${r.table.rows.length === 1 ? "line" : "lines"} in ${file.fileName}.`;
}

function mount(ctx) {
C = ctx;
const { query, run, wrap, requireAuth, checkWriteAccess, actor } = ctx;
const app = routers.r0;

async function whoOf(req) {
  const a = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id=? AND org_id=?`, [a.id, req.user.orgId]);
  return { id: a.id, name: (u && u.name) || a.name };
}

app.post("/old-reports/read", requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const file = decodeFile(b);
  if (file.error) return res.status(400).json(file);
  const r = await readFile(file, b);
  const guess = O.guessReport({ fileName: file.fileName, headers: r.table ? r.table.headers : [], rows: r.table ? r.table.rows : [], text: r.text });
  const wide = !!(r.table && r.table.headers.filter(h => /^(fy\s*)?(19|20)\d{2}$/i.test(String(h).trim())).length >= 1
    && !r.table.headers.some(h => /^(amount|total|gift total|revenue)$/i.test(String(h).trim())));
  res.json({
    fileName: file.fileName, contentType: file.contentType, bytes: file.buffer.length, pages: r.pages,
    scanned: r.scanned, readable: !!r.table, sentence: readableSentence(r, file),
    kind: guess.kind, system: guess.system, systemLabel: guess.systemLabel, period: guess.period, why: guess.why,
    table: r.table ? { headers: r.table.headers, rows: r.table.rows, rowCount: r.table.rows.length } : null,
    wide, mapping: r.table ? (wide ? { wide: true, amountRow: 0 } : O.guessMapping(r.table.headers)) : null,
    kinds: O.KIND_KEYS.map(k => ({ key: k, label: O.KINDS[k].label })),
    systems: [...O.SYSTEM_KEYS.map(k => ({ key: k, label: O.SYSTEMS[k].label })), { key: "spreadsheet", label: "A spreadsheet or another system" }],
    wrote: false,
  });
}));

app.post("/old-reports/preview", requireAuth, wrap(async (req, res) => {
  const b = req.body || {};
  const t = b.table || {};
  const headers = Array.isArray(t.headers) ? t.headers.map(String).slice(0, 80) : [];
  const rows = Array.isArray(t.rows) ? t.rows.slice(0, 5000).map(r => headers.map((_, i) => String((Array.isArray(r) ? r[i] : "") ?? ""))) : [];
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const period = DAY.test(String(b.periodFrom || "")) && DAY.test(String(b.periodTo || "")) ? { from: b.periodFrom, to: b.periodTo } : null;
  const out = O.totalsFromTable({ headers, rows }, b.mapping || {}, period);
  if (!out.ok) return res.json({ ok: false, sentence: out.error, wrote: false });
  res.json({ ok: true, wrote: false, count: out.rows.length, cents: out.cents, amount: (out.cents / 100).toFixed(2),
    fileTotal: out.fileTotal, footsToFile: out.footsToFile, rows: out.rows.slice(0, 8),
    setAside: out.setAside.reduce((m, x) => ({ ...m, [x.reason]: (m[x.reason] || 0) + 1 }), {}) });
}));

app.post("/old-reports/batches", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const who = await whoOf(req);
  const id = "orb_" + C.uuid().replace(/-/g, "").slice(0, 14);
  await run(`INSERT INTO old_report_batches (id, org_id, created_by, created_by_name) VALUES (?,?,?,?)`, [id, req.user.orgId, who.id, who.name]);
  res.status(201).json({ id });
}));

app.post("/old-reports/batches/:id/files", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [batch] = await query(`SELECT * FROM old_report_batches WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!batch) return res.status(404).json({ error: "Not found" });
  if (batch.undone_at) return res.status(409).json({ error: "undone", sentence: "That import was undone. Start a new one." });
  const [n] = await query(`SELECT COUNT(*)::int AS n FROM stored_sheets WHERE org_id=? AND batch_id=?`, [orgId, batch.id]);
  if (n.n >= O.MAX_FILES) return res.status(400).json({ error: "too_many", sentence: `One import takes up to ${O.MAX_FILES} files.` });
  const b = req.body || {};
  const file = decodeFile(b);
  if (file.error) return res.status(400).json(file);
  const kind = O.KIND_KEYS.includes(b.kind) ? b.kind : "other";
  const system = O.SYSTEM_KEYS.includes(b.system) || b.system === "spreadsheet" ? b.system : "spreadsheet";
  const systemLabel = (O.SYSTEMS[system] && O.SYSTEMS[system].label) || "a spreadsheet";
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const from = DAY.test(String(b.periodFrom || "")) ? b.periodFrom : null;
  const to = DAY.test(String(b.periodTo || "")) ? b.periodTo : null;
  if ((from && !to) || (to && !from) || (from && to && from > to)) return res.status(400).json({ error: "bad_period", sentence: "The period needs a first and a last day, in that order." });
  const r = await readFile(file, b);

  // The numbers, only when asked and only from a table Steward can read.
  let totals = null;
  if (b.pull === true) {
    if (!r.table) return res.status(400).json({ error: "unreadable", sentence: readableSentence(r, file) });
    totals = O.totalsFromTable(r.table, b.mapping || {}, from && to ? { from, to } : null);
    if (!totals.ok) return res.status(400).json({ error: "bad_mapping", sentence: totals.error });
    if (!totals.rows.length) return res.status(400).json({ error: "no_numbers", sentence: "None of the lines had an amount and a period, so there is nothing to pull in. Keep it as a file, or map other columns." });
  }

  const who = await whoOf(req);
  const asset = await C.putThemeAsset({ orgId, kind: ASSET_KIND, buffer: file.buffer, contentType: file.contentType });
  const sheetId = "sht_" + C.uuid().replace(/-/g, "").slice(0, 14);
  const title = String(b.title || "").trim().slice(0, 200) || file.fileName.replace(/\.[^.]+$/, "");
  const periodLabel = from && to ? (from.slice(5) === "01-01" && to.slice(5) === "12-31" && from.slice(0, 4) === to.slice(0, 4) ? from.slice(0, 4) : `${from} to ${to}`) : null;
  await run(`INSERT INTO stored_sheets (id,org_id,kind,title,period_label,file_name,content_type,bytes,asset_id,sheet_name,headers,rows,unplaced,grant_ids,
                                        batch_id,report_kind,source_system,period_from,period_to,guess_why,scanned,page_count,created_by,created_by_name)
             VALUES (?,?,'old_report',?,?,?,?,?,?,?,?::jsonb,?::jsonb,'{}'::jsonb,'[]'::jsonb,?,?,?,?,?,?,?,?,?,?)`,
    [sheetId, orgId, title, periodLabel, file.fileName, file.contentType, file.buffer.length, asset.id, b.sheetName ? String(b.sheetName).slice(0, 120) : null,
     JSON.stringify(r.table ? r.table.headers : []), JSON.stringify(r.table ? r.table.rows : []),
     batch.id, kind, system, from, to, b.why ? String(b.why).slice(0, 600) : null, !!r.scanned, r.pages, who.id, who.name]);

  if (totals) {
    // A board report's total-raised row, a giving summary and a by-fund table
    // are the org's giving for their periods; a LYBUNT list or top donors are
    // not (their amounts are what some people gave, not what the org raised).
    const givingKind = !!(O.KINDS[kind] && O.KINDS[kind].giving) || (kind === "board_report" && b.mapping && b.mapping.wide);
    for (const t of totals.rows) {
      await run(`INSERT INTO historical_totals (id,org_id,batch_id,sheet_id,report_kind,counts_as_giving,period_from,period_to,label,amount,gift_count,donor_count,source_system,file_name,created_by,created_by_name)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ["hst_" + C.uuid().replace(/-/g, "").slice(0, 14), orgId, batch.id, sheetId, kind, givingKind, t.from, t.to, t.label,
         (t.cents / 100).toFixed(2), t.gifts, t.donors, systemLabel, file.fileName, who.id, who.name]);
    }
  }
  const sum = totals ? totals.cents : 0;
  res.status(201).json({
    sheetId, fileName: file.fileName, kept: true, scanned: !!r.scanned,
    totals: totals ? { count: totals.rows.length, cents: sum, amount: (sum / 100).toFixed(2), fileTotal: totals.fileTotal,
      footsToFile: totals.footsToFile, setAside: totals.setAside.map(x => x.reason) } : null,
    sentence: totals
      ? `Kept ${file.fileName}, and pulled in ${totals.rows.length} ${totals.rows.length === 1 ? "total" : "totals"} from ${systemLabel}${totals.footsToFile === true ? ", which add up to the file's own total to the cent" : ""}.`
      : `Kept ${file.fileName} under Reports${r.scanned ? ". It is a scan, so its numbers cannot be read" : ""}.`,
  });
}));

app.post("/old-reports/batches/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [batch] = await query(`SELECT * FROM old_report_batches WHERE id=? AND org_id=?`, [req.params.id, orgId]);
  if (!batch) return res.status(404).json({ error: "Not found" });
  const who = await whoOf(req);
  const t = await query(`DELETE FROM historical_totals WHERE org_id=? AND batch_id=? RETURNING id`, [orgId, batch.id]);
  const s = await query(`UPDATE stored_sheets SET removed_at=NOW() WHERE org_id=? AND batch_id=? AND removed_at IS NULL RETURNING id`, [orgId, batch.id]);
  await run(`UPDATE old_report_batches SET undone_at=NOW(), undone_by=? WHERE id=? AND org_id=?`, [who.id, batch.id, orgId]);
  res.json({ ok: true, files: s.length, totals: t.length,
    sentence: `Took the import back out: ${s.length} ${s.length === 1 ? "file" : "files"} and ${t.length} ${t.length === 1 ? "total" : "totals"}.` });
}));

// Every past report kept: the old systems' and SHEETS-1's board reports alike,
// newest period first, each with the kind, the system and what was pulled in.
app.get("/old-reports", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT s.id, s.kind, s.title, s.period_label, s.period_from, s.period_to, s.file_name, s.content_type, s.bytes, s.report_kind,
            s.source_system, s.scanned, s.page_count, s.guess_why, s.batch_id, s.created_at, s.created_by_name,
            (SELECT COUNT(*)::int FROM historical_totals h WHERE h.org_id = s.org_id AND h.sheet_id = s.id) AS totals,
            (SELECT COALESCE(SUM(h.amount), 0)::text FROM historical_totals h WHERE h.org_id = s.org_id AND h.sheet_id = s.id) AS total_amount
       FROM stored_sheets s
      WHERE s.org_id = ? AND s.kind IN ('old_report', 'board_report') AND s.removed_at IS NULL
      ORDER BY COALESCE(s.period_to, s.period_label, '') DESC, s.created_at DESC`, [req.user.orgId]);
  res.json({ reports: rows.map(r => ({
    id: r.id, kind: r.kind, title: r.title, periodLabel: r.period_label, periodFrom: r.period_from, periodTo: r.period_to,
    // The year it covers; with no period given, the year in its title or file name.
    year: ([r.period_to, r.period_label, r.title, r.file_name].map(v => String(v || "").match(/(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/)).find(Boolean) || [])[1] || null,
    fileName: r.file_name, contentType: r.content_type, bytes: r.bytes,
    reportKind: r.report_kind || (r.kind === "board_report" ? "board_report" : "other"),
    reportKindLabel: (O.KINDS[r.report_kind || (r.kind === "board_report" ? "board_report" : "other")] || O.KINDS.other).label,
    system: r.source_system ? ((O.SYSTEMS[r.source_system] || {}).label || "A spreadsheet") : (r.kind === "board_report" ? "A spreadsheet" : null),
    scanned: !!r.scanned, pages: r.page_count, why: r.guess_why, batchId: r.batch_id, createdAt: r.created_at, createdByName: r.created_by_name || "",
    totals: r.totals, totalAmount: Number(r.total_amount),
    source: r.totals ? { key: "historical-totals", params: { from: "1900-01-01", to: "2999-12-31", sheet: r.id } } : null,
  })), typesSentence: O.TYPES_SENTENCE });
}));
}

module.exports = { routers, mount };
