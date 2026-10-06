// routes/grantLibrary.js · GRANTS-1. THE LIBRARY, WHAT WENT WHERE, REPORTS
// WITH A HISTORY, AND A FIRST DRAFT OF ONE SECTION.
//
//   GET  /grant-library                      the org's reusable pieces, by kind
//   POST /grant-library                      a new piece (version 1 kept)
//   PUT  /grant-library/:id                  an edit: version + 1, the old one kept
//   GET  /grant-library/:id/versions         every version, and where each one went
//   POST /grant-library/:id/archive          put away (Undo: /restore)
//   POST /grant-library/:id/restore
//   POST /grants/:id/sends                   record that a document, piece or report went to the funder
//   POST /grant-sends/:id/remove             take a typed-in record off (Undo of the above)
//   GET  /grants/:id/sends                   what went to this funder for this grant
//   GET  /funders/:id/sends                  what went to this funder, across its grants
//   GET  /grants/:id/reports                 the grant's reports
//   POST /grants/:id/reports                 a draft, started from this funder's last submitted report
//   GET  /grant-reports/:id                  one report
//   POST /grant-reports/:id/build            outcomes, budget against actual, narrative from pieces
//   POST /grant-reports/:id/unbuild          Undo of a build (the sections and figures before it)
//   PUT  /grant-reports/:id                  edit while a draft
//   POST /grant-reports/:id/remove           discard a draft (Undo of a create)
//   POST /grant-reports/:id/submit           a person says it went: kept read-only from here
//   POST /grant-reports/:id/reopen           Undo of a submit
//   GET  /funders/:id/reports                every submitted report to this funder
//   POST /grants/:id/draft-section           a first draft of one section; saves nothing
//
// Every write is recorded by the one audit write (middleware/auditTrail.js);
// nothing here writes an audit row. Nothing here sends anything to anybody: a
// "send" is a person telling Steward what already went. The model is reached
// only through aiClient.js, and only for /draft-section, which returns text
// and stores none.
"use strict";
const express = require("express");
const money = require("../money");
const { aiGate, anthropicFor } = require("../aiClient");

const routers = { r0: express.Router() };

// ── Shared consts (the TDZ rule: every one above its first reader) ─────────
const KINDS = [
  { key: "mission",    label: "Mission",                 many: false },
  { key: "history",    label: "History",                 many: false },
  { key: "program",    label: "Program description",     many: true  },
  { key: "budget",     label: "Budget",                  many: true  },
  { key: "board_list", label: "Board list",              many: false },
  { key: "bios",       label: "Staff and board bios",    many: true  },
  { key: "audit",      label: "Audit",                   many: true  },
  { key: "other",      label: "Other",                   many: true  },
];
const KIND_KEYS = KINDS.map(k => k.key);
const SEND_WHATS = ["document", "library", "report"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECTION_KEY_RE = /^[a-z0-9_-]{1,40}$/;
const BODY_MAX = 50000;
const DRAFT_MODEL = "claude-opus-5";
// Server-owned fields on a section: a PUT from the page may not change them.
const SERVER_SECTION_FIELDS = ["needsConfirm", "note", "sources", "carriedFrom", "figures"];
// Outcome phrases a draft may only use when the person's own pieces already do
// (the same list shared/grantOutline.js refuses in an outline).
const OUTCOME_RUNS = [
  ["served"], ["we", "reached"], ["impacted"], ["lives", "changed"], ["outcomes"],
  ["participants"], ["attendance"], ["attended"], ["graduated"], ["improved"],
  ["meals", "served"], ["beneficiaries"], ["success", "rate"], ["test", "scores"],
];
const DRAFT_LABEL = "Draft. Read it and change it before you submit.";

const kindLabel = k => (KINDS.find(x => x.key === k) || {}).label || "Other";
const iso = d => (d instanceof Date ? d.toISOString() : d || null);
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const isDay = s => DAY_RE.test(String(s || "")) && !Number.isNaN(Date.parse(String(s)));
const cents = v => money.toCents(v) || 0;
const fmt = c => (c < 0 ? "-" + money.formatCentsPlain(-c) : money.formatCentsPlain(c));
const tokens = t => String(t || "").toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
function hasRun(ts, run) {
  for (let i = 0; i + run.length <= ts.length; i++) {
    let hit = true;
    for (let j = 0; j < run.length; j++) if (ts[i + j] !== run[j]) { hit = false; break; }
    if (hit) return true;
  }
  return false;
}
const numbersIn = t => (String(t || "").match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, ""));

function pieceShape(r) {
  return { id: r.id, kind: r.kind, kindLabel: kindLabel(r.kind), title: r.title, body: r.body || "",
    version: Number(r.version) || 1, archived: !!r.archived_at, archivedAt: iso(r.archived_at),
    createdByName: r.created_by_name || "", createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}
function sendShape(r) {
  let label = r.subject || "";
  if (r.what === "library") label = r.lib_title || r.piece_title || "Library piece";
  else if (r.what === "document") label = r.doc_file_name || "Document";
  else if (r.what === "report") label = r.report_title || "Report";
  return { id: r.id, grantId: r.grant_id, funderId: r.funder_donor_id || null, what: r.what, label,
    documentId: r.document_id || null, libraryPieceId: r.library_piece_id || null,
    libraryVersion: r.library_version == null ? null : Number(r.library_version),
    reportId: r.report_id || null, reportVersion: r.report_version == null ? null : Number(r.report_version),
    subject: r.subject || "", sentOn: r.sent_on, sentToName: r.sent_to_name || "", sentToEmail: r.sent_to_email || "",
    direction: r.direction || "out", source: r.source || "manual",
    program: r.program || "", funderName: r.funder_name || r.funder || "",
    createdByName: r.created_by_name || "", createdAt: iso(r.created_at) };
}
function reportShape(r) {
  const f = r.figures && typeof r.figures === "object" ? { ...r.figures } : null;
  if (f) delete f.before;
  return { id: r.id, grantId: r.grant_id, milestoneId: r.milestone_id || null, title: r.title,
    dueDate: r.due_date || null, askedFor: r.asked_for || "", status: r.status,
    sections: Array.isArray(r.sections) ? r.sections : [], figures: f,
    canUnbuild: !!(r.figures && r.figures.before),
    version: Number(r.version) || 1, startedFrom: r.started_from || null,
    submittedOn: r.submitted_on || null, submittedToName: r.submitted_to_name || "",
    submittedToEmail: r.submitted_to_email || "", submittedByName: r.submitted_by_name || "",
    program: r.program || "", funderName: r.funder_name || r.funder || "",
    createdByName: r.created_by_name || "", createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
}

function mount(ctx) {
const { actor, checkWriteAccess, query, run, requireAuth, uuid, wrap, orgTz, orgToday, grantMoneyRows, grantBalanceFrom } = ctx;
const app = routers.r0;
const newId = p => `${p}_${uuid().replace(/-/g, "").slice(0, 16)}`;

// The actor stamp: the user id, and the person's name where we have one.
async function who(req) {
  const a = actor(req);
  const [u] = await query(`SELECT name FROM users WHERE id = ?`, [a.id]);
  return { id: a.id, name: (u && u.name) || a.name };
}
async function today(orgId) { return orgToday(await orgTz(orgId)); }
async function grantRow(orgId, id) {
  const [g] = await query(
    `SELECT g.id, g.program, g.funder, g.funder_donor_id, g.outcomes, g.status, d.name AS funder_name, d.funder_interests
       FROM grants g LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE g.id = ? AND g.org_id = ?`, [id, orgId]);
  return g || null;
}
async function pieceRow(orgId, id) {
  const [p] = await query(`SELECT * FROM grant_library WHERE id = ? AND org_id = ?`, [id, orgId]);
  return p || null;
}
async function reportRow(orgId, id) {
  const [r] = await query(
    `SELECT r.*, g.program, g.funder, g.funder_donor_id, d.name AS funder_name
       FROM grant_reports r JOIN grants g ON g.id = r.grant_id AND g.org_id = r.org_id
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE r.id = ? AND r.org_id = ?`, [id, orgId]);
  return r || null;
}
async function funderRow(orgId, id) {
  const [d] = await query(`SELECT id, name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [id, orgId]);
  return d || null;
}
// Pieces in the order the person picked them; anything not theirs is dropped.
async function piecesInOrder(orgId, ids) {
  const want = (Array.isArray(ids) ? ids : []).map(String).slice(0, 20);
  if (!want.length) return [];
  const rows = await query(`SELECT * FROM grant_library WHERE org_id = ? AND id = ANY(?) AND archived_at IS NULL`, [orgId, want]);
  const by = new Map(rows.map(r => [r.id, r]));
  return [...new Set(want)].map(id => by.get(id)).filter(Boolean);
}
const SENDS_SQL = `
  SELECT s.*, lv.title AS lib_title, l.title AS piece_title, gd.file_name AS doc_file_name,
         gr.title AS report_title, gr.version AS report_version, g.program, g.funder, d.name AS funder_name
    FROM grant_sends s
    JOIN grants g ON g.id = s.grant_id AND g.org_id = s.org_id
    LEFT JOIN donors d ON d.id = s.funder_donor_id AND d.org_id = s.org_id
    LEFT JOIN grant_library l ON l.id = s.library_piece_id AND l.org_id = s.org_id
    LEFT JOIN grant_library_versions lv ON lv.piece_id = s.library_piece_id AND lv.version = s.library_version AND lv.org_id = s.org_id
    LEFT JOIN grant_documents gd ON gd.id = s.document_id AND gd.org_id = s.org_id
    LEFT JOIN grant_reports gr ON gr.id = s.report_id AND gr.org_id = s.org_id
   WHERE s.org_id = ?`;
const SENDS_ORDER = ` ORDER BY s.sent_on DESC, s.created_at DESC`;

// ── 1. THE LIBRARY ──────────────────────────────────────────────────────────
app.get("/grant-library", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const withArchived = String(req.query.archived || "") === "1";
  const rows = await query(
    `SELECT * FROM grant_library WHERE org_id = ? ${withArchived ? "" : "AND archived_at IS NULL"}
      ORDER BY kind, lower(title), created_at`, [orgId]);
  const pieces = rows.map(pieceShape);
  res.json({ pieces, kinds: KINDS,
    sentence: pieces.length ? `${pieces.length} ${pieces.length === 1 ? "piece" : "pieces"} you can reuse in any application or report.`
      : "Nothing in the library yet. Add your mission, history and program descriptions once, and reuse them everywhere." });
}));

app.post("/grant-library", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const b = req.body || {};
  const kind = String(b.kind || "");
  if (!KIND_KEYS.includes(kind)) return res.status(400).json({ code: "bad_kind", error: `A library piece is one of: ${KINDS.map(k => k.label).join(", ")}.` });
  const title = clip(b.title, 200) || kindLabel(kind);
  const body = String(b.body == null ? "" : b.body).slice(0, BODY_MAX);
  const w = await who(req);
  const id = newId("glib");
  await run(`INSERT INTO grant_library (id, org_id, kind, title, body, version, created_by, created_by_name) VALUES (?,?,?,?,?,1,?,?)`,
    [id, orgId, kind, title, body, w.id, w.name]);
  await run(`INSERT INTO grant_library_versions (id, org_id, piece_id, version, title, body, created_by, created_by_name) VALUES (?,?,?,1,?,?,?,?)`,
    [newId("glv"), orgId, id, title, body, w.id, w.name]);
  if (req.audit) { req.audit.entity("grant library piece", id, title); req.audit.summary(`Added "${title}" to the grant library`); }
  res.status(201).json({ piece: pieceShape(await pieceRow(orgId, id)) });
}));

app.put("/grant-library/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const p = await pieceRow(orgId, req.params.id);
  if (!p) return res.status(404).json({ error: "Library piece not found" });
  if (p.archived_at) return res.status(409).json({ code: "archived", error: "This piece is archived. Restore it before you change it." });
  const b = req.body || {};
  if (b.kind !== undefined && !KIND_KEYS.includes(String(b.kind))) return res.status(400).json({ code: "bad_kind", error: `A library piece is one of: ${KINDS.map(k => k.label).join(", ")}.` });
  const next = {
    kind: b.kind !== undefined ? String(b.kind) : p.kind,
    title: b.title !== undefined ? (clip(b.title, 200) || p.title) : p.title,
    body: b.body !== undefined ? String(b.body == null ? "" : b.body).slice(0, BODY_MAX) : p.body,
  };
  const previous = { kind: p.kind, title: p.title, body: p.body, version: Number(p.version) };
  if (next.kind === p.kind && next.title === p.title && next.body === p.body) return res.json({ piece: pieceShape(p), previous, unchanged: true });
  const w = await who(req);
  const v = Number(p.version) + 1;
  await run(`UPDATE grant_library SET kind = ?, title = ?, body = ?, version = ?, updated_at = NOW() WHERE id = ? AND org_id = ?`,
    [next.kind, next.title, next.body, v, p.id, orgId]);
  await run(`INSERT INTO grant_library_versions (id, org_id, piece_id, version, title, body, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?)`,
    [newId("glv"), orgId, p.id, v, next.title, next.body, w.id, w.name]);
  if (req.audit) { req.audit.entity("grant library piece", p.id, next.title); req.audit.summary(`Saved version ${v} of "${next.title}"`); }
  res.json({ piece: pieceShape(await pieceRow(orgId, p.id)), previous });
}));

app.get("/grant-library/:id/versions", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const p = await pieceRow(orgId, req.params.id);
  if (!p) return res.status(404).json({ error: "Library piece not found" });
  const vs = await query(`SELECT * FROM grant_library_versions WHERE org_id = ? AND piece_id = ? ORDER BY version DESC`, [orgId, p.id]);
  const sends = (await query(SENDS_SQL + ` AND s.library_piece_id = ?` + SENDS_ORDER, [orgId, p.id])).map(sendShape);
  res.json({ piece: pieceShape(p), versions: vs.map(v => ({ id: v.id, version: Number(v.version), title: v.title || "", body: v.body || "",
    createdByName: v.created_by_name || "", createdAt: iso(v.created_at),
    sentTo: sends.filter(s => s.libraryVersion === Number(v.version)) })) });
}));

for (const [verb, archived] of [["archive", true], ["restore", false]]) {
  app.post(`/grant-library/:id/${verb}`, requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const p = await pieceRow(orgId, req.params.id);
    if (!p) return res.status(404).json({ error: "Library piece not found" });
    await run(`UPDATE grant_library SET archived_at = ${archived ? "COALESCE(archived_at, NOW())" : "NULL"}, updated_at = NOW() WHERE id = ? AND org_id = ?`, [p.id, orgId]);
    if (req.audit) { req.audit.entity("grant library piece", p.id, p.title); req.audit.summary(`${archived ? "Archived" : "Restored"} "${p.title}" in the grant library`); }
    res.json({ piece: pieceShape(await pieceRow(orgId, p.id)) });
  }));
}

// ── 2. WHICH VERSION WENT TO WHICH FUNDER ──────────────────────────────────
app.post("/grants/:id/sends", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await grantRow(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const b = req.body || {};
  const what = String(b.what || "");
  if (!SEND_WHATS.includes(what)) return res.status(400).json({ code: "bad_what", error: "Say what went: a document, a library piece or a report." });
  const sentOn = b.sentOn ? String(b.sentOn) : await today(orgId);
  if (!isDay(sentOn)) return res.status(400).json({ code: "bad_date", error: "Give the date it went, as a date." });
  const toEmail = clip(b.sentToEmail, 200);
  if (toEmail && !EMAIL_RE.test(toEmail)) return res.status(400).json({ code: "bad_email", error: "That email address does not look right." });
  let documentId = null, pieceId = null, version = null, reportId = null, label = "";
  if (what === "document") {
    const [d] = await query(`SELECT id, file_name FROM grant_documents WHERE id = ? AND org_id = ? AND grant_id = ?`, [String(b.documentId || ""), orgId, g.id]);
    if (!d) return res.status(404).json({ error: "Document not found on this grant" });
    documentId = d.id; label = d.file_name;
  } else if (what === "library") {
    const p = await pieceRow(orgId, String(b.libraryPieceId || ""));
    if (!p) return res.status(404).json({ error: "Library piece not found" });
    version = b.version == null || b.version === "" ? Number(p.version) : Number(b.version);
    const [v] = await query(`SELECT version FROM grant_library_versions WHERE org_id = ? AND piece_id = ? AND version = ?`, [orgId, p.id, Number.isInteger(version) ? version : -1]);
    if (!v) return res.status(400).json({ code: "bad_version", error: `"${p.title}" has no version ${b.version}.` });
    pieceId = p.id; label = `${p.title}, version ${version}`;
  } else {
    const [r] = await query(`SELECT id, title FROM grant_reports WHERE id = ? AND org_id = ? AND grant_id = ?`, [String(b.reportId || ""), orgId, g.id]);
    if (!r) return res.status(404).json({ error: "Report not found on this grant" });
    reportId = r.id; label = r.title;
  }
  const w = await who(req);
  const id = newId("gsend");
  await run(`INSERT INTO grant_sends (id, org_id, grant_id, funder_donor_id, what, document_id, library_piece_id, library_version, report_id,
               sent_on, sent_to_name, sent_to_email, direction, source, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'out','manual',?,?)`,
    [id, orgId, g.id, g.funder_donor_id || null, what, documentId, pieceId, version, reportId, sentOn, clip(b.sentToName, 200) || null, toEmail || null, w.id, w.name]);
  if (req.audit) { req.audit.entity("grant", g.id, g.program || g.funder_name || g.funder); req.audit.summary(`Recorded that ${label} went to ${g.funder_name || g.funder || "the funder"} on ${sentOn}`); }
  const [row] = await query(SENDS_SQL + ` AND s.id = ?`, [orgId, id]);
  res.status(201).json({ send: sendShape(row) });
}));

app.post("/grant-sends/:id/remove", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [s] = await query(`SELECT id, grant_id, source, what FROM grant_sends WHERE id = ? AND org_id = ?`, [req.params.id, orgId]);
  if (!s) return res.status(404).json({ error: "Not found" });
  if (s.source !== "manual") return res.status(409).json({ code: "not_manual", error: "This came from the mailbox, so it stays as the email showed it." });
  await run(`DELETE FROM grant_sends WHERE id = ? AND org_id = ?`, [s.id, orgId]);
  if (req.audit) req.audit.summary(`Took off a record of what went to a funder`);
  res.json({ ok: true, id: s.id });
}));

app.get("/grants/:id/sends", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await grantRow(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const sends = (await query(SENDS_SQL + ` AND s.grant_id = ?` + SENDS_ORDER, [orgId, g.id])).map(sendShape);
  res.json({ sends });
}));

app.get("/funders/:id/sends", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const f = await funderRow(orgId, req.params.id);
  if (!f) return res.status(404).json({ error: "Funder not found" });
  const sends = (await query(SENDS_SQL + ` AND (s.funder_donor_id = ? OR g.funder_donor_id = ?)` + SENDS_ORDER, [orgId, f.id, f.id])).map(sendShape);
  res.json({ funder: { id: f.id, name: f.name }, sends });
}));

// ── 3. REPORTS WITH A HISTORY ──────────────────────────────────────────────
app.get("/grants/:id/reports", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await grantRow(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const rows = await query(
    `SELECT r.*, g.program, g.funder, d.name AS funder_name
       FROM grant_reports r JOIN grants g ON g.id = r.grant_id AND g.org_id = r.org_id
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE r.org_id = ? AND r.grant_id = ?
      ORDER BY (r.status = 'submitted'), r.due_date NULLS LAST, r.created_at`, [orgId, g.id]);
  res.json({ reports: rows.map(reportShape), funderId: g.funder_donor_id || null });
}));

app.get("/grant-reports/:id", requireAuth, wrap(async (req, res) => {
  const r = await reportRow(req.user.orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  res.json({ report: reportShape(r) });
}));

app.post("/grants/:id/reports", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await grantRow(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const b = req.body || {};
  const title = clip(b.title, 200) || `Report to ${g.funder_name || g.funder || "the funder"}`;
  const dueDate = b.dueDate ? String(b.dueDate) : null;
  if (dueDate && !isDay(dueDate)) return res.status(400).json({ code: "bad_date", error: "Give the due date as a date." });
  let milestoneId = null;
  if (b.milestoneId) {
    const [m] = await query(`SELECT id FROM grant_milestones WHERE id = ? AND org_id = ? AND grant_id = ?`, [String(b.milestoneId), orgId, g.id]);
    if (!m) return res.status(404).json({ error: "That deadline is not on this grant." });
    milestoneId = m.id;
  }
  // Next year's report starts from last year's: the newest submitted report
  // to the same funder, on any of its grants (or this grant, with no funder).
  const [last] = await query(
    `SELECT r.id, r.title, r.sections, r.submitted_on FROM grant_reports r
       JOIN grants g ON g.id = r.grant_id AND g.org_id = r.org_id
      WHERE r.org_id = ? AND r.status = 'submitted' AND ${g.funder_donor_id ? "g.funder_donor_id = ?" : "r.grant_id = ?"}
      ORDER BY r.submitted_on DESC NULLS LAST, r.updated_at DESC LIMIT 1`, [orgId, g.funder_donor_id || g.id]);
  const sections = last && Array.isArray(last.sections)
    ? last.sections.map(s => {
        const c = { ...s, carriedFrom: last.title };
        delete c.figures;
        if (c.needsConfirm) c.confirmed = false;
        if (s.key === "budget") c.note = "Last report's figures. Press Build to put this grant's own figures in.";
        return c;
      })
    : [];
  const w = await who(req);
  const id = newId("grep");
  await run(`INSERT INTO grant_reports (id, org_id, grant_id, milestone_id, title, due_date, asked_for, status, sections, started_from, created_by, created_by_name)
             VALUES (?,?,?,?,?,?,?,'draft',?::jsonb,?,?,?)`,
    [id, orgId, g.id, milestoneId, title, dueDate, clip(b.askedFor, 5000) || null, JSON.stringify(sections), last ? last.id : null, w.id, w.name]);
  if (req.audit) { req.audit.entity("grant", g.id, g.program || g.funder_name || g.funder); req.audit.summary(`Started the report "${title}"${last ? ` from "${last.title}"` : ""}`); }
  res.status(201).json({ report: reportShape(await reportRow(orgId, id)),
    startedFrom: last ? { id: last.id, title: last.title, submittedOn: last.submitted_on } : null });
}));

function draftOnly(r, res) {
  if (r.status === "draft") return true;
  res.status(409).json({ code: "submitted", error: "This report was submitted and is kept exactly as it went. Reopen it to change it." });
  return false;
}

app.post("/grant-reports/:id/build", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await reportRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  if (!draftOnly(r, res)) return;
  const g = await grantRow(orgId, r.grant_id);
  const day = await today(orgId);
  // Budget against actual: the screens' own query and balance, in cents,
  // stored now and never recomputed by a read.
  const R = await import("../shared/restrictedMoney.js");
  const [m] = await grantMoneyRows(orgId, "AND g.id = ?", [g.id]);
  const spend = await query(`SELECT id, amount, spent_on, description FROM grant_spend WHERE org_id = ? AND grant_id = ? ORDER BY spent_on, created_at`, [orgId, g.id]);
  const lines = spend.map(s => ({ id: s.id, spentOn: s.spent_on, description: s.description, amountCents: cents(s.amount) }));
  let figures = null;
  let budgetText = "Steward has no award recorded on this grant yet, so there is no budget against actual to show.";
  if (m) {
    const bal = grantBalanceFrom(R, m, day);
    figures = { asOf: day, awardedCents: bal.awardedCents, receivedCents: bal.receivedCents, spentCents: bal.spentCents,
      remainingCents: bal.remainingCents, outstandingCents: bal.outstandingCents, overspent: bal.overspent, restricted: bal.restricted,
      lines, linesTotalCents: lines.reduce((a, l) => a + l.amountCents, 0), sentence: bal.sentence };
    budgetText = [
      `As of ${day}:`,
      `Award: ${fmt(bal.awardedCents)}`,
      `Received: ${fmt(bal.receivedCents)}`,
      `Spent: ${fmt(bal.spentCents)}`,
      `Remaining (received less spent): ${fmt(bal.remainingCents)}`,
      ...(bal.outstandingCents > 0 ? [`Still owed by the funder: ${fmt(bal.outstandingCents)}`] : []),
      ...(lines.length ? ["", "Spending:", ...lines.map(l => `${l.spentOn}  ${l.description}  ${fmt(l.amountCents)}`)] : []),
    ].join("\n");
  }
  const outcomes = String(g.outcomes || "").trim();
  const built = [
    { key: "outcomes", title: "Outcomes", text: outcomes, needsConfirm: true, confirmed: false,
      note: outcomes ? "These are the outcomes written on the grant. Steward does not know what happened in the program, so a person confirms them before the report goes."
        : "Nothing is written on the grant's outcomes yet. Steward does not know what happened in the program; write it here." },
    { key: "budget", title: "Budget against actual", text: budgetText,
      note: figures ? `Figures from Steward's own records as of ${day}, kept as they were today.` : "" },
  ];
  const picked = await piecesInOrder(orgId, (req.body || {}).pieceIds);
  if (picked.length) {
    built.push({ key: "narrative", title: "Narrative", text: picked.map(p => String(p.body || "").trim()).filter(Boolean).join("\n\n"),
      sources: picked.map(p => ({ pieceId: p.id, title: p.title, version: Number(p.version) })),
      note: `From your library: ${picked.map(p => `${p.title} (version ${p.version})`).join(", ")}.` });
  }
  const keys = new Set(built.map(s => s.key));
  const old = Array.isArray(r.sections) ? r.sections : [];
  const sections = [...built, ...old.filter(s => !keys.has(s.key))];
  const prevFigures = r.figures && typeof r.figures === "object" ? { ...r.figures } : null;
  if (prevFigures) delete prevFigures.before;
  const stored = { ...(figures || { asOf: day, none: true }), before: { sections: old, figures: prevFigures } };
  await run(`UPDATE grant_reports SET sections = ?::jsonb, figures = ?::jsonb, updated_at = NOW() WHERE id = ? AND org_id = ?`,
    [JSON.stringify(sections), JSON.stringify(stored), r.id, orgId]);
  if (req.audit) { req.audit.entity("grant", g.id, g.program || g.funder_name || g.funder); req.audit.summary(`Built the report "${r.title}" from the grant's records`); }
  res.json({ report: reportShape(await reportRow(orgId, r.id)) });
}));

app.post("/grant-reports/:id/unbuild", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await reportRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  if (!draftOnly(r, res)) return;
  const before = r.figures && r.figures.before;
  if (!before) return res.status(409).json({ code: "nothing_to_undo", error: "There is no earlier version of this report to put back." });
  await run(`UPDATE grant_reports SET sections = ?::jsonb, figures = ?::jsonb, updated_at = NOW() WHERE id = ? AND org_id = ?`,
    [JSON.stringify(before.sections || []), before.figures ? JSON.stringify(before.figures) : null, r.id, orgId]);
  res.json({ report: reportShape(await reportRow(orgId, r.id)) });
}));

app.put("/grant-reports/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await reportRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  if (!draftOnly(r, res)) return;
  const b = req.body || {};
  const previous = { title: r.title, dueDate: r.due_date || null, askedFor: r.asked_for || "", sections: r.sections || [] };
  const title = b.title !== undefined ? (clip(b.title, 200) || r.title) : r.title;
  let dueDate = r.due_date || null;
  if (b.dueDate !== undefined) {
    dueDate = b.dueDate ? String(b.dueDate) : null;
    if (dueDate && !isDay(dueDate)) return res.status(400).json({ code: "bad_date", error: "Give the due date as a date." });
  }
  const askedFor = b.askedFor !== undefined ? (clip(b.askedFor, 5000) || null) : r.asked_for;
  let sections = Array.isArray(r.sections) ? r.sections : [];
  if (b.sections !== undefined) {
    if (!Array.isArray(b.sections) || b.sections.length > 30) return res.status(400).json({ code: "bad_sections", error: "A report holds up to thirty sections." });
    const was = new Map(sections.map(s => [s.key, s]));
    const seen = new Set();
    const next = [];
    for (const s of b.sections) {
      const key = String((s && s.key) || "").toLowerCase();
      if (!SECTION_KEY_RE.test(key) || seen.has(key)) return res.status(400).json({ code: "bad_sections", error: "Each section needs its own short name." });
      seen.add(key);
      const old = was.get(key) || {};
      const out = { key, title: clip(s.title, 200) || old.title || key, text: String(s.text == null ? "" : s.text).slice(0, BODY_MAX) };
      for (const f of SERVER_SECTION_FIELDS) if (old[f] !== undefined) out[f] = old[f];
      if (out.needsConfirm) out.confirmed = s.confirmed === true;
      next.push(out);
    }
    sections = next;
  }
  await run(`UPDATE grant_reports SET title = ?, due_date = ?, asked_for = ?, sections = ?::jsonb, updated_at = NOW() WHERE id = ? AND org_id = ?`,
    [title, dueDate, askedFor, JSON.stringify(sections), r.id, orgId]);
  res.json({ report: reportShape(await reportRow(orgId, r.id)), previous });
}));

app.post("/grant-reports/:id/remove", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await reportRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  if (!draftOnly(r, res)) return;
  await run(`DELETE FROM grant_sends WHERE org_id = ? AND report_id = ? AND source = 'manual'`, [orgId, r.id]);
  await run(`DELETE FROM grant_reports WHERE id = ? AND org_id = ?`, [r.id, orgId]);
  if (req.audit) req.audit.summary(`Discarded the draft report "${r.title}"`);
  res.json({ ok: true, id: r.id });
}));

app.post("/grant-reports/:id/submit", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await reportRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  if (!draftOnly(r, res)) return;
  const b = req.body || {};
  const submittedOn = b.submittedOn ? String(b.submittedOn) : await today(orgId);
  if (!isDay(submittedOn)) return res.status(400).json({ code: "bad_date", error: "Give the date it went, as a date." });
  const toEmail = clip(b.toEmail, 200);
  if (toEmail && !EMAIL_RE.test(toEmail)) return res.status(400).json({ code: "bad_email", error: "That email address does not look right." });
  const sections = Array.isArray(r.sections) ? r.sections : [];
  if (!sections.some(s => String(s.text || "").trim())) return res.status(400).json({ code: "empty_report", error: "This report has nothing in it yet. Build it or write a section first." });
  const unconfirmed = sections.find(s => s.needsConfirm && String(s.text || "").trim() && s.confirmed !== true);
  if (unconfirmed) return res.status(400).json({ code: "outcomes_unconfirmed", error: `Confirm the ${String(unconfirmed.title || "outcomes").toLowerCase()} first. Steward cannot know what happened in the program; you do.` });
  const w = await who(req);
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM grant_reports WHERE org_id = ? AND grant_id = ? AND status = 'submitted'`, [orgId, r.grant_id]);
  const sendId = newId("gsend");
  const toName = clip(b.toName, 200) || null;
  await ctx.withTransaction(async c => {
    await c.query(`UPDATE grant_reports SET status = 'submitted', version = $1, submitted_on = $2, submitted_to_name = $3, submitted_to_email = $4,
                     submitted_by = $5, submitted_by_name = $6, updated_at = NOW() WHERE id = $7 AND org_id = $8`,
      [n + 1, submittedOn, toName, toEmail || null, w.id, w.name, r.id, orgId]);
    await c.query(`INSERT INTO grant_sends (id, org_id, grant_id, funder_donor_id, what, report_id, sent_on, sent_to_name, sent_to_email, direction, source, created_by, created_by_name)
                   VALUES ($1,$2,$3,$4,'report',$5,$6,$7,$8,'out','manual',$9,$10)`,
      [sendId, orgId, r.grant_id, r.funder_donor_id || null, r.id, submittedOn, toName, toEmail || null, w.id, w.name]);
  });
  if (req.audit) { req.audit.entity("grant", r.grant_id, r.program || r.funder_name || r.funder); req.audit.summary(`Submitted the report "${r.title}" to ${toName || r.funder_name || "the funder"} on ${submittedOn}`); }
  res.json({ report: reportShape(await reportRow(orgId, r.id)), sendId });
}));

app.post("/grant-reports/:id/reopen", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const r = await reportRow(orgId, req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  if (r.status !== "submitted") return res.status(409).json({ code: "not_submitted", error: "This report is still a draft." });
  await ctx.withTransaction(async c => {
    await c.query(`UPDATE grant_reports SET status = 'draft', version = 1, submitted_on = NULL, submitted_to_name = NULL, submitted_to_email = NULL,
                     submitted_by = NULL, submitted_by_name = NULL, updated_at = NOW() WHERE id = $1 AND org_id = $2`, [r.id, orgId]);
    await c.query(`DELETE FROM grant_sends WHERE org_id = $1 AND report_id = $2 AND what = 'report' AND source = 'manual'`, [orgId, r.id]);
  });
  if (req.audit) { req.audit.entity("grant", r.grant_id, r.program || r.funder_name || r.funder); req.audit.summary(`Reopened the report "${r.title}" as a draft`); }
  res.json({ report: reportShape(await reportRow(orgId, r.id)) });
}));

app.get("/funders/:id/reports", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const f = await funderRow(orgId, req.params.id);
  if (!f) return res.status(404).json({ error: "Funder not found" });
  const rows = await query(
    `SELECT r.*, g.program, g.funder, d.name AS funder_name
       FROM grant_reports r JOIN grants g ON g.id = r.grant_id AND g.org_id = r.org_id
       LEFT JOIN donors d ON d.id = g.funder_donor_id AND d.org_id = g.org_id
      WHERE r.org_id = ? AND g.funder_donor_id = ? AND r.status = 'submitted'
      ORDER BY r.submitted_on DESC NULLS LAST, r.updated_at DESC`, [orgId, f.id]);
  res.json({ funder: { id: f.id, name: f.name }, reports: rows.map(reportShape) });
}));

// ── 4. A FIRST DRAFT OF ONE SECTION ────────────────────────────────────────
// From the org's own library pieces and the funder's stated interests, and
// nothing else. Saves nothing: the page puts the text into the section for a
// person to read and change. With AI off, or a reply that does not finish or
// states something the pieces do not, the draft is the pieces themselves.
function templateDraft(pieces) {
  return pieces.map(p => String(p.body || "").trim()).filter(Boolean).join("\n\n");
}
function draftProblems(text, sourceText) {
  const src = tokens(sourceText);
  const srcNums = new Set(numbersIn(sourceText));
  const out = [];
  const badNums = numbersIn(text).filter(n => !srcNums.has(n));
  if (badNums.length) out.push(`numbers not in your pieces (${[...new Set(badNums)].slice(0, 5).join(", ")})`);
  const t = tokens(text);
  const claims = OUTCOME_RUNS.filter(run => hasRun(t, run) && !hasRun(src, run)).map(run => run.join(" "));
  if (claims.length) out.push(`outcome language your pieces do not use (${claims.join(", ")})`);
  return out;
}

app.post("/grants/:id/draft-section", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const g = await grantRow(orgId, req.params.id);
  if (!g) return res.status(404).json({ error: "Grant not found" });
  const b = req.body || {};
  const section = clip(b.section, 80) || "Narrative";
  const pieces = await piecesInOrder(orgId, b.pieceIds);
  if (!pieces.length) return res.status(400).json({ code: "no_pieces", error: "Pick at least one library piece to draft from." });
  const instructions = clip(b.instructions, 1000);
  const interests = String(g.funder_interests || "").trim().slice(0, 3000);
  const funderName = g.funder_name || g.funder || "the funder";
  const template = templateDraft(pieces);
  const templateSentence = why => `${why} This is your library pieces put together in the order you picked. ${DRAFT_LABEL}`;
  const gate = await aiGate(orgId);
  if (!gate.ok) {
    return res.json({ text: template, source: "template", label: DRAFT_LABEL,
      sentence: templateSentence(gate.reason === "ai_disabled" ? "Drafting is turned off for your organization." : "Drafting is not available on this server.") });
  }
  const sourceText = [...pieces.map(p => `${p.title}\n${p.body}`), interests, instructions].join("\n\n");
  try {
    const msg = await anthropicFor(orgId).messages.create({
      model: DRAFT_MODEL,
      max_tokens: 900,
      thinking: { type: "disabled" },
      system: "You draft one section of a grant report or application for a small nonprofit. Use ONLY the facts in the organization's own library pieces. "
        + "Shape them toward the funder's stated interests where they genuinely fit, but never invent a fact, a number, a date, a name or an outcome. "
        + "Do not claim results the pieces do not state. Plain, warm, specific prose. No headings, no bullet lists, no markdown, no em dashes. "
        + "Return only the section text.",
      messages: [{ role: "user", content:
        `Section to draft: ${section}\nFunder: ${funderName}\n`
        + `Funder's stated interests: ${interests || "(none recorded)"}\n`
        + (instructions ? `What the person asked for: ${instructions}\n` : "")
        + `\nThe organization's library pieces:\n\n`
        + pieces.map((p, i) => `[${i + 1}] ${p.title} (${kindLabel(p.kind)})\n${p.body}`).join("\n\n") }],
    });
    if (msg.stop_reason !== "end_turn") {
      return res.json({ text: template, source: "template", label: DRAFT_LABEL, sentence: templateSentence("The draft did not finish, so Steward did not show it.") });
    }
    let text = (msg.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
    text = text.replace(/\s*\u2014\s*/g, ", ");
    const problems = text ? draftProblems(text, sourceText) : ["an empty reply"];
    if (problems.length) {
      return res.json({ text: template, source: "template", label: DRAFT_LABEL,
        sentence: templateSentence(`Steward set the written draft aside because it had ${problems.join(" and ")}.`) });
    }
    return res.json({ text, source: "ai", label: DRAFT_LABEL,
      sentence: `Steward drafted this from ${pieces.length === 1 ? "one library piece" : `${pieces.length} library pieces`}${interests ? ` and ${funderName}'s stated interests` : ""}. ${DRAFT_LABEL}` });
  } catch (e) {
    console.warn("[grant draft-section] fell back to the template:", e.message);
    return res.json({ text: template, source: "template", label: DRAFT_LABEL, sentence: templateSentence("Drafting could not be reached just now.") });
  }
}));
}

module.exports = { routers, mount, KINDS };
