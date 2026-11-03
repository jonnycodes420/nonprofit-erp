// server/reports/routes.js — reports, saved reports, the report builder and the rows behind a figure.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// FIX-11 Part 3 — the bookkeeper's two files. Pure: grouping, the fee line,
// the net and the assertion that the deposits foot (depositsFile.js), and the
// column sets each tool wants (bookkeeper.js), declared once so the screen,
// this router and routes/finance.js cannot disagree about any of them.
const DEP = require("../../depositsFile");
const BK = require("../../bookkeeper");
// SCALE-2: org-wide figures are stored per org and served until something changes.
const OS = require("../../orgSummary");

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  ACTIVITY_DEFINITIONS, RB_READY, REPORT_HANDLERS, actor, asJson, checkWriteAccess, composeActivityReport,
  computeDriftForDonors, computeRetentionRate, figureSources, orgForYears, orgTime, orgToday, orgTz,
  parseReportParams, query, rbCustomDefs, rbFormatCell, reportCsvCell, reportToCsv, requireAdmin, requireAuth,
  run, runBuilderDef, runSaved, runSavedReportScheduleForOrg, savedReportFor, uuid, wrap, reportHooks,
} = ctx;
let RB = null;
RB_READY.then(m => { RB = m; });
let app = routers.r1;

// ── FIX-2 A — THE ROWS BEHIND A FIGURE ─────────────────────────────────────
// One endpoint shape for every number Steward shows. The caller's org only
// (req.user.orgId is the first argument of every source's query), read-only
// (a GET that writes nothing), paginated (?page, ?pageSize up to 200), and
// computed by the SAME source the figure was: figureSources.js is the one
// definition of each, so the rows and the number cannot disagree. A source
// name is from a fixed registry; a parameter it does not know is ignored and
// a malformed one is refused, never guessed.
app.get("/figures/:source/rows", requireAuth, wrap(async (req, res) => {
  const { page, pageSize, ...params } = req.query;
  // PROSPECT-1 — "Who could give more?" opens its rows only for those who may ask it.
  if (String(req.params.source) === "why" && params.q === "more" && !(await require("../../prospect").canSee(req.user.userId))) {
    return res.status(403).json({ error: "major_gifts_only" });
  }
  try {
    const out = await figureSources.figure(req.user.orgId, { key: String(req.params.source), params },
      { computeRetentionRate, computeDriftForDonors }, { page, pageSize });
    if (!out) return res.status(404).json({ error: "Steward has no figure by that name." });
    res.json(out);
  } catch (e) {
    if (e instanceof figureSources.FigureParamError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

// ── REPORTS-4 · A FIGURE'S ROWS, TO KEEP ───────────────────────────────────
// The same rows the drawer shows (figureSources.allRows, through figure()), as
// a file, or as the people in them so the drawer can save them as a Group.
// Both are GETs that write nothing; the Group is made by POST /groups and
// POST /groups/:id/members, the routes Groups already has, so the audit write
// and Undo are theirs. A percentage's rows are the people it counts.
async function figureRowsFor(req, res) {
  const { page, pageSize, ...params } = req.query;
  if (String(req.params.source) === "why" && params.q === "more" && !(await require("../../prospect").canSee(req.user.userId))) {
    res.status(403).json({ error: "major_gifts_only" }); return null;
  }
  try {
    const rows = await figureSources.allRows(req.user.orgId, { key: String(req.params.source), params },
      { computeRetentionRate, computeDriftForDonors });
    if (!rows) { res.status(404).json({ error: "Steward has no figure by that name." }); return null; }
    return rows;
  } catch (e) {
    if (e instanceof figureSources.FigureParamError) { res.status(400).json({ error: e.message }); return null; }
    throw e;
  }
}
const csvCell = v => { const t = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : "") + t.replace(/"/g, '""')}"` : t; };
app.get("/figures/:source/export.csv", requireAuth, wrap(async (req, res) => {
  const rows = await figureRowsFor(req, res);
  if (!rows) return;
  if (await require("../../exportGuard").largeExportRefused(req, res, rows.length)) return;   // SECURE-2 item 8
  const lines = [["Name", "Date", "Amount", "Detail", "Kind"].join(",")];
  for (const r of rows) lines.push([r.name, r.date || "", r.amount === null || r.amount === undefined ? "" : Number(r.amount).toFixed(2), r.detail || "", r.type || ""].map(csvCell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${String(req.params.source).replace(/[^a-z0-9-]/gi, "")}-rows.csv"`);
  res.send(lines.join("\r\n") + "\r\n");
}));
app.get("/figures/:source/people", requireAuth, wrap(async (req, res) => {
  const rows = await figureRowsFor(req, res);
  if (!rows) return;
  // EVENTS-3: a party's row (a household who came together) is all its people
  const ids = [...new Set(rows.flatMap(r => Array.isArray(r.people) ? r.people.map(x => x.donorId) : [r.donorId]).filter(Boolean))];
  res.json({ donorIds: ids, rows: rows.length });
}));
function sendReportCsv(res, filename, headers, rows) {
  const body = [headers, ...rows].map(r => r.map(reportCsvCell).join(",")).join("\r\n") + "\r\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

// ── REPORT-BUILDER ROUTES ──────────────────────────────────────────────────
app.get("/report-builder/catalogue", requireAuth, wrap(async (req, res) => {
  await RB_READY;
  const defs = await rbCustomDefs(req.user.orgId);
  res.json({
    entities: RB.ENTITY_KEYS.map(k => {
      const E = RB.ENTITIES[k];
      const custom = E.custom ? defs.filter(d => d.entity === E.custom.entity && RB.CUSTOM_KEY.test(d.key)).map(d => RB.fieldFor(k, "cf:" + d.key, defs)).filter(Boolean) : [];
      return { key: k, label: E.label, fields: [...Object.entries(E.fields).map(([fk, f]) => ({ key: fk, label: f.label, type: f.type, groupOnly: !!f.groupOnly })),
        ...custom.map(f => ({ key: f.key, label: f.label, type: f.type, custom: true }))] };
    }),
    ops: Object.entries(RB.OPS).map(([k, o]) => ({ key: k, label: o.label, types: o.types })),
  });
}));

// Run a definition that has not been saved. A read; changes nothing.
app.post("/report-builder/run", requireAuth, wrap(async (req, res) => {
  const out = await runBuilderDef(req.user.orgId, req.body?.definition || {});
  if (out.errors) return res.status(400).json({ error: out.errors.join(" "), errors: out.errors });
  res.json(out);
}));

app.get("/saved-reports", requireAuth, wrap(async (req, res) => {
  await RB_READY;
  const mine = await query(
    `SELECT id, name, question, shared, owner_id, owner_name, schedule, updated_at FROM saved_reports
      WHERE org_id=? AND (shared = true OR owner_id = ?) ORDER BY name`, [req.user.orgId, req.user.userId]);
  res.json({
    standard: RB.STANDARD_REPORTS.map(r => ({ id: "std:" + r.key, name: r.name, question: r.question })),
    saved: mine.map(r => ({ id: r.id, name: r.name, question: r.question, shared: r.shared, mine: r.owner_id === req.user.userId,
      ownerName: r.owner_name, schedule: r.schedule, updatedAt: r.updated_at })),
  });
}));

app.post("/saved-reports", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await RB_READY;
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const def = req.body?.definition || {};
  if (!name) return res.status(400).json({ error: "Give the report a name." });
  const v = RB.validateDefinition(def, { customDefs: await rbCustomDefs(req.user.orgId) });
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" ") });
  const schedule = RB.SCHEDULES.includes(req.body?.schedule ?? null) ? (req.body?.schedule ?? null) : null;
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const id = newId("rpt");
  await run(`INSERT INTO saved_reports (id,org_id,name,question,definition,shared,owner_id,owner_name,schedule,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, name, String(req.body?.question || "").slice(0, 300) || null, JSON.stringify(def),
     req.body?.shared === true, req.user.userId, u?.name || null, schedule, actor(req).id, actor(req).name]);
  res.status(201).json({ id });
}));

// Only the owner edits or deletes; a shared report is readable by the org and
// changeable by the person who made it.
app.put("/saved-reports/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  await RB_READY;
  const [r] = await query("SELECT * FROM saved_reports WHERE id=? AND org_id=? AND owner_id=?", [req.params.id, req.user.orgId, req.user.userId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  const def = req.body?.definition ?? asJson(r.definition, {});
  const v = RB.validateDefinition(def, { customDefs: await rbCustomDefs(req.user.orgId) });
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" ") });
  const schedule = req.body && "schedule" in req.body ? (RB.SCHEDULES.includes(req.body.schedule) ? req.body.schedule : null) : r.schedule;
  await run(`UPDATE saved_reports SET name=?, question=?, definition=?, shared=?, schedule=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [String(req.body?.name ?? r.name).trim().slice(0, 120) || r.name, req.body?.question ?? r.question, JSON.stringify(def),
     typeof req.body?.shared === "boolean" ? req.body.shared : r.shared, schedule, r.id, req.user.orgId]);
  res.json({ ok: true });
}));

app.delete("/saved-reports/:id", requireAuth, wrap(async (req, res) => {
  const { changes } = await run("DELETE FROM saved_reports WHERE id=? AND org_id=? AND owner_id=?", [req.params.id, req.user.orgId, req.user.userId]);
  if (!changes) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
}));

app.get("/saved-reports/:id/run", requireAuth, wrap(async (req, res) => {
  const rep = await savedReportFor(req.user.orgId, req.user.userId, req.params.id);
  if (!rep) return res.status(404).json({ error: "Not found" });
  const out = await runSaved(req.user.orgId, rep);
  if (out.errors) return res.status(400).json({ error: out.errors.join(" ") });
  const { raw, ...rest } = out; void raw;
  res.json({ report: { id: rep.id, name: rep.name, question: rep.question, standard: rep.standard, definition: rep.def }, ...rest });
}));

app.get("/saved-reports/:id/csv", requireAuth, wrap(async (req, res) => {
  const rep = await savedReportFor(req.user.orgId, req.user.userId, req.params.id);
  if (!rep) return res.status(404).json({ error: "Not found" });
  const out = await runSaved(req.user.orgId, rep);
  if (out.errors) return res.status(400).json({ error: out.errors.join(" ") });
  const slug = String(rep.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  sendReportCsv(res, `${slug}.csv`, out.columns.map(c => c.label), out.rows.map(r => out.columns.map(c => r[c.key])));
}));

app.get("/saved-reports/:id/pdf", requireAuth, wrap(async (req, res) => {
  const rep = await savedReportFor(req.user.orgId, req.user.userId, req.params.id);
  if (!rep) return res.status(404).json({ error: "Not found" });
  const out = await runSaved(req.user.orgId, rep);
  if (out.errors) return res.status(400).json({ error: out.errors.join(" ") });
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, bufferPages: true });
  const chunks = []; doc.on("data", c => chunks.push(c));
  const done = new Promise(r => doc.on("end", r));
  const W = doc.page.width - 72, n = Math.max(out.columns.length, 1), cw = W / n;
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f1a12").text(rep.name, 36, 36);
  if (rep.question) doc.font("Helvetica").fontSize(9.5).fillColor("#5a554f").text(rep.question);
  doc.moveDown(0.6);
  const header = () => {
    const y = doc.y;
    out.columns.forEach((c, i) => doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f1a12").text(c.label, 36 + i * cw, y, { width: cw - 6, lineBreak: false, ellipsis: true }));
    doc.moveTo(36, y + 13).lineTo(36 + W, y + 13).strokeColor("#e8e4db").stroke(); doc.y = y + 17;
  };
  header();
  for (const r of out.rows) {
    if (doc.y > doc.page.height - 60) { doc.addPage(); header(); }
    const y = doc.y;
    out.columns.forEach((c, i) => doc.font("Helvetica").fontSize(8.5).fillColor("#0f1a12").text(rbFormatCell(r[c.key], c.type), 36 + i * cw, y, { width: cw - 6, lineBreak: false, ellipsis: true }));
    doc.y = y + 13;
  }
  doc.moveDown(0.5).font("Helvetica").fontSize(8.5).fillColor("#5a554f")
    .text(`${out.totals.count.toLocaleString("en-US")} rows${out.totals.sums.length ? " · " + out.totals.sums.map(s => `${s.label} ${rbFormatCell(s.cents / 100, "money")}`).join(" · ") : ""}${out.capped ? ` · first ${out.rows.length} shown` : ""}`, 36);
  doc.end(); await done;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${String(rep.name).replace(/[^\w -]/g, "")}.pdf"`);
  res.end(Buffer.concat(chunks));
}));

// Ops/test hook: drive the exact scheduled path for the caller's org.
app.post("/saved-reports/run-schedule", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name, timezone FROM orgs WHERE id=?", [req.user.orgId]);
  const weekKey = /^wk:\d{4}-\d{2}-\d{2}$/.test(String(req.body?.weekKey || "")) ? req.body.weekKey : "wk:" + orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
  res.json(await runSavedReportScheduleForOrg(org, { weekKey }));
}));


// Reports are read paths — requireAuth only, never checkWriteAccess (a
// read_only org keeps full report access, consistent with GETs/exports
// everywhere else).
// GET /reports/activity?start=&end=&scope=mine|org — BUILD-88a A.5.
// The activity report over ANY window, from the one counter. It exists as a
// route because a figure you cannot take apart is a figure nobody can audit:
// the week is the sum of its days, and this is what lets anyone — the suite
// included — check that rather than take it on trust.
app.get("/reports/activity", requireAuth, wrap(async (req, res) => {
  const ymd = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
  const org = await orgTz(req.user.orgId);
  const today = orgToday(org);                                    // ORG_TZ_SEAM_OK
  const wk = orgTime.orgPeriodBounds(org, "week", 0);
  const start = ymd(req.query.start) || wk.start;
  const end = ymd(req.query.end) || today;
  if (start > end) return res.status(400).json({ error: "start must be on or before end" });
  const scope = req.query.scope === "mine" ? "mine" : "org";
  const report = await composeActivityReport(req.user.orgId, { start, end }, scope === "mine" ? req.user.userId : null);
  res.json({ ...report, definitions: ACTIVITY_DEFINITIONS });
}));

app.get("/reports/:key", requireAuth, OS.cached("report", { perUser: false, when: req => req.params.key === "giving-summary" && !req.query.format }), wrap(async (req, res) => {
  const { key } = req.params;
  if (!REPORT_HANDLERS[key]) return res.status(404).json({ error: "Unknown report" });
  let p;
  try { p = parseReportParams(req.query, await orgForYears(req.user.orgId)); }   // ORG_TZ_SEAM_OK
  catch (e) { return res.status(e.status === 400 ? 400 : 500).json({ error: e.message }); }
  const data = await REPORT_HANDLERS[key](req.user.orgId, p);
  if (p.format === "csv") {
    // BUILD-87 Part 4 — a report that has declared itself unbalanced REFUSES
    // to become a file, and says why. Asserted in cents by the handler, before
    // a single byte is written.
    if (data && data.exportRefused) {
      console.error("[report] export refused:", key, data.exportRefused);
      return res.status(409).json({ error: "export_unbalanced", message: data.exportRefused });
    }
    // THE FLAVOUR IS HONOURED HERE, which is the whole of item 0. The Monthly
    // close screen offered Steward / QuickBooks / Xero as three `<span>`s and
    // the download ignored them, because only routes/finance.js could see the
    // column sets. A flavour Steward does not know is refused BY NAME rather
    // than quietly falling back to one that looks similar.
    const flavour = String(req.query.flavour || "").trim().toLowerCase();
    if (flavour) {
      const known = key === "deposits"
        ? Object.prototype.hasOwnProperty.call(DEP.DEPOSIT_FLAVOURS, flavour)
        : !!BK.giftFlavour(flavour);
      if (!known) {
        return res.status(400).json({ error: "unknown_flavour",
          message: `Steward does not know a bookkeeping format called "${flavour}".` });
      }
    }
    const asked = key === "deposits" || key === "non-cash" || key === "bookkeeper" ? { flavour } : {};
    const { headers, rows } = reportToCsv(key, data, asked);
    if (await require("../../exportGuard").largeExportRefused(req, res, rows.length)) return;   // SECURE-2 item 8
    const suffix = key === "retention" ? p.yearMode
      : key === "top-donors" && p.scope === "lifetime" ? "lifetime"
      : ["lybunt", "sybunt", "annual", "three-year"].includes(key) ? `${p.yearMode === "fiscal" ? "fy" : "cy"}${p.year}`
      : `${p.from}_${p.to}`;
    const flavourTag = flavour && flavour !== "steward" ? `-${flavour}` : "";
    return sendReportCsv(res, `${key}${flavourTag}-${suffix}.csv`, headers, rows);
  }
  res.json(data);
}));
// FIX-9 Part B.4 — `sendReportCsv` is THE csv writer: the injection guard and
// the header rules live in it, so the volunteer group's export uses this one
// rather than growing a second. It is declared inside mount() like everything
// else in this file, so it is handed out the way `run` is rather than exported
// from module scope, where it does not exist.
reportHooks.sendCsv = sendReportCsv;
}

module.exports = { routers, mount };
