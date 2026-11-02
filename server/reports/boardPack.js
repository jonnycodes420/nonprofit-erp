// server/reports/boardPack.js — the board pack and board reports.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
// FIX-12 Part 3: the one door to a model (asks the org's AI switch on every call).
const { anthropicFor, requireAi, transcribeAudio, AiOffError, AI_OFF_MESSAGE, recordAiFallback } = require("../../aiClient");
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  actor, asJson, checkWriteAccess, composeBoardPack, escapeHtml, orgTime, orgToday, orgTz, query,
  rbFormatCell, requireAdmin, requireAuth, run, savedDashboardFor, sendBoardPackEmail, toCents, toDollars,
  uuid, wrap, reportHooks,
} = ctx;

// ══ REPORTS-3 — SAVED DASHBOARDS AND THE BOARD PACK ════════════════════════
//
// The ED stops rebuilding the same report every month, and the board gets the
// same numbers on the same day without anyone exporting anything.
//
// ONE COMPOSITION. composeBoardPack builds the pack as DATA — every number
// with the figure source it was computed from, its definition and its sentence
// — and renderBoardPackPdf draws that data. The screen and the paper read the
// same object, so a number cannot be one thing on one and another on the
// other. Every number in it is a figureSources.js source, which is what makes
// the one test possible: each can be re-asked of /figures/:source/rows and
// footed to the cent against the live report.
let BP = null;
const BP_READY = import("../../shared/boardPack.js").then(m => { BP = m; return m; });

// ── THE PDF ────────────────────────────────────────────────────────────────
// The org's name and logo, page numbers, the period and the date it was
// produced, and the definitions page. `compress: false` is deliberate: it
// keeps the text literal in the file, which is what lets the one test read
// every number back OUT of the PDF rather than trust the composer that made
// it. A board pack is a handful of pages; the bytes do not matter.
async function renderBoardPackPdf(pack) {
  const PDFDocument = require("pdfkit");
  const DD = await import("../../shared/displayDate.js");
  const doc = new PDFDocument({ size: "LETTER", margin: 50, bufferPages: true, compress: false });
  const chunks = []; doc.on("data", c => chunks.push(c));
  const done = new Promise(r => doc.on("end", r));
  const INK = "#0f1a12", GREY = "#5a554f", EMERALD = "#0d5c3a", BRASS = "#c9a84c", RULE = "#e8e4db";
  const PW = doc.page.width, L = 50, W = PW - 100;
  const fmtMoney = v => "$" + (Math.round((Number(v) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtVal = (kind, v, suffix) => {
    if (v === null || v === undefined) return "None yet";   // POLISH-1: never an em dash
    if (kind === "money") return fmtMoney(v);
    if (kind === "percent") return `${v}%`;
    return Number(v).toLocaleString("en-US") + (suffix ? ` ${suffix}` : "");
  };
  let logo = null;
  if (pack.logo && /^data:image\/(png|jpe?g);base64,/.test(pack.logo)) {
    try { logo = Buffer.from(pack.logo.split(",")[1], "base64"); } catch { logo = null; }
  }

  // ── the cover band, on page one only ──
  if (logo) { try { doc.image(logo, PW - L - 60, 46, { fit: [60, 46] }); } catch { /* a logo that will not draw costs the logo, not the pack */ } }
  doc.font("Helvetica-Bold").fontSize(11).fillColor(GREY).text(pack.orgName, L, 50, { width: W - 90 });
  doc.font("Helvetica-Bold").fontSize(23).fillColor(INK).text(pack.title, L, doc.y + 6, { width: W - 90 });
  doc.font("Helvetica").fontSize(11).fillColor(GREY)
    .text(`${pack.period.label} · produced ${pack.producedOnLabel}`, L, doc.y + 4, { width: W - 90 });
  const filterWords = Object.entries(pack.filters).filter(([k]) => ["fund", "campaign", "owner"].includes(k));
  if (filterWords.length) {
    doc.font("Helvetica").fontSize(9).fillColor(GREY)
      .text(`Narrowed by ${filterWords.map(([k]) => k).join(", ")}.`, L, doc.y + 2, { width: W });
  }
  let y = doc.y + 16;
  doc.moveTo(L, y).lineTo(L + W, y).strokeColor(RULE).stroke();
  y += 16;

  const room = need => { if (y > doc.page.height - need) { doc.addPage(); y = 56; } };
  const heading = t => { room(110); doc.font("Helvetica-Bold").fontSize(12.5).fillColor(INK).text(t, L, y, { width: W }); y = doc.y + 7; };

  for (const s of pack.sections) {
    heading(s.title);
    if (s.kind === "figures") {
      for (const f of s.figures) {
        room(70);
        doc.font("Helvetica").fontSize(10).fillColor(GREY).text(f.label, L + 8, y, { width: W * 0.55 });
        doc.font("Helvetica-Bold").fontSize(13.5).fillColor(INK)
          .text(fmtVal(f.kind, f.value, f.suffix), L + W * 0.58, y - 2, { width: W * 0.42, align: "right" });
        y = Math.max(doc.y, y + 18);
        // A BLANK IS PRINTED AS A BLANK, with the sentence saying why.
        if (f.value === null && f.blank) {
          doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(f.blank, L + 8, y, { width: W - 16 });
          y = doc.y + 6;
        }
        if (f.note) {
          doc.font("Helvetica").fontSize(8.5).fillColor(BRASS).text(f.note, L + 8, y, { width: W - 16 });
          y = doc.y + 6;
        }
      }
      y += 8;
    } else if (s.kind === "list") {
      for (const [i, r] of s.rows.entries()) {
        room(60);
        doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(`${i + 1}. ${r.name || "(no name)"}`, L + 8, y, { width: W * 0.5 });
        doc.font("Helvetica").fontSize(9).fillColor(GREY).text(r.dateLabel || "", L + W * 0.5, y, { width: W * 0.22 });
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(EMERALD)
          .text(r.amount == null ? "" : fmtMoney(r.amount), L + W * 0.72, y, { width: W * 0.28, align: "right" });
        y = Math.max(doc.y, y + 14);
      }
      room(40);
      doc.moveTo(L + 8, y + 2).lineTo(L + W, y + 2).strokeColor(RULE).stroke();
      y += 8;
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(`${s.label} · every gift in the period`, L + 8, y, { width: W * 0.6 });
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(fmtMoney(s.total), L + W * 0.62, y - 1, { width: W * 0.38, align: "right" });
      y = Math.max(doc.y, y + 16) + 10;
    } else if (s.kind === "goals") {
      if (!s.goals.length) { doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text("No active goals.", L + 8, y, { width: W }); y = doc.y + 14; }
      for (const g of s.goals) {
        room(60);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(g.label, L + 8, y, { width: W * 0.5 });
        const right = `${fmtMoney(g.raised.value)} of ${fmtMoney(g.target.value)}${g.percent.value == null ? "" : ` · ${g.percent.value}%`}`;
        doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(right, L + W * 0.5, y, { width: W * 0.5, align: "right" });
        y = Math.max(doc.y, y + 16);
      }
      y += 10;
    } else if (s.kind === "chart") {
      for (const p of s.points) {
        room(40);
        doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(DD.displayMonth(p.month), L + 8, y, { width: W * 0.34 });
        doc.font("Helvetica").fontSize(9.5).fillColor(EMERALD)
          .text(p.thisYear ? `${fmtMoney(p.thisYear.value)} this year` : "", L + W * 0.34, y, { width: W * 0.33, align: "right" });
        doc.font("Helvetica").fontSize(9.5).fillColor(GREY)
          .text(p.lastYear ? `${fmtMoney(p.lastYear.value)} last year` : "", L + W * 0.67, y, { width: W * 0.33, align: "right" });
        y = Math.max(doc.y, y + 13);
      }
      y += 10;
    } else if (s.kind === "report") {
      const n = Math.max(1, (s.columns || []).length), cw = W / n;
      room(60);
      (s.columns || []).forEach((c, i) => doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY)
        .text(c.label, L + i * cw, y, { width: cw - 6, lineBreak: false, ellipsis: true }));
      y = doc.y + 4;
      doc.moveTo(L, y).lineTo(L + W, y).strokeColor(RULE).stroke(); y += 5;
      for (const r of (s.rows || [])) {
        room(40);
        (s.columns || []).forEach((c, i) => doc.font("Helvetica").fontSize(8.5).fillColor(INK)
          .text(rbFormatCell(r[c.key], c.type), L + i * cw, y, { width: cw - 6, lineBreak: false, ellipsis: true }));
        y += 12;
      }
      if (s.totalRows > (s.rows || []).length) {
        doc.font("Helvetica").fontSize(8.5).fillColor(GREY)
          .text(`${(s.totalRows - s.rows.length).toLocaleString("en-US")} more rows in the report.`, L, y + 2, { width: W });
        y = doc.y + 4;
      }
      y += 10;
    } else if (s.kind === "missing") {
      doc.font("Helvetica").fontSize(9.5).fillColor(BRASS).text(s.definition, L + 8, y, { width: W - 16 });
      y = doc.y + 14;
    }
  }

  // ── WHAT EACH NUMBER MEANS ──
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("What each number means", L, 56, { width: W });
  let dy = doc.y + 10;
  for (const d of pack.definitions) {
    if (dy > doc.page.height - 90) { doc.addPage(); dy = 56; }
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(d.label, L, dy, { width: W });
    dy = doc.y + 2;
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(d.definition, L, dy, { width: W, lineGap: 1.4 });
    dy = doc.y + 2;
    if (d.sentence) { doc.font("Helvetica-Oblique").fontSize(8).fillColor(GREY).text(d.sentence, L, dy, { width: W, lineGap: 1.2 }); dy = doc.y + 2; }
    dy += 8;
  }

  // ── PAGE NUMBERS, on every page, once the count is known ──
  // POLISH-1 Part 7: the footer sits below the bottom margin, and pdfkit
  // answers text written there by starting a NEW page, so a three-page pack
  // printed as six: three real pages and three blank ones each holding only
  // its footer (page 4 read "page 1 of 3"). The margin is lifted for the one
  // line and the line is told not to wrap, so it stays on its own page.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(GREY)
      .text(`${pack.orgName} · ${pack.title} · ${pack.period.label} · page ${i + 1} of ${range.count}`,
        L, doc.page.height - 34, { width: W, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end(); await done;
  return Buffer.concat(chunks);
}

// ── THE BOARD PACK ─────────────────────────────────────────────────────────
// GET, so a board pack is a read: it writes nothing and survives HEAD.
const boardPackOpts = (req) => ({
  dashboardId: req.query.dashboard || null, userId: req.user.userId,
  frequency: req.query.frequency, from: req.query.from, to: req.query.to,
  fund: req.query.fund, campaign: req.query.campaign, owner: req.query.owner, group: req.query.group,
});
let app = routers.r1;

app.get("/board-pack", requireAuth, wrap(async (req, res) => {
  const pack = await composeBoardPack(req.user.orgId, boardPackOpts(req));
  if (!pack) return res.status(404).json({ error: "Not found" });
  res.json(pack);
}));

app.get("/board-pack/pdf", requireAuth, wrap(async (req, res) => {
  const pack = await composeBoardPack(req.user.orgId, boardPackOpts(req));
  if (!pack) return res.status(404).json({ error: "Not found" });
  const pdf = await renderBoardPackPdf(pack);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${boardPackFilename(pack)}"`);
  res.setHeader("Content-Length", pdf.length);
  res.end(pdf);
}));

function boardPackFilename(pack) {
  const slug = String(pack.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board-pack";
  return `${slug}-${pack.period.from}.pdf`;
}

// ── THE SCHEDULE ───────────────────────────────────────────────────────────
// One per organisation, OFF until somebody turns it on. The recipients are the
// org's own staff and board addresses from Settings; a scheduled pack is never
// sent anywhere else, and never to a donor.
async function boardPackRecipients(orgId) {
  const [o] = await query("SELECT board_pack_emails FROM orgs WHERE id=?", [orgId]);
  const list = asJson(o && o.board_pack_emails, []);
  return (Array.isArray(list) ? list : []).map(String).filter(Boolean);
}

app.get("/board-pack/schedule", requireAuth, wrap(async (req, res) => {
  const B = await BP_READY;
  const [s] = await query("SELECT * FROM board_pack_schedules WHERE org_id=?", [req.user.orgId]);
  const sends = s ? await query(
    "SELECT period_key, period_label, recipients, created_at FROM board_pack_sends WHERE schedule_id=? ORDER BY created_at DESC LIMIT 12",
    [s.id]) : [];
  res.json({
    schedule: s ? { id: s.id, dashboardId: s.dashboard_id, frequency: s.frequency, dayOfMonth: s.day_of_month,
      enabled: s.enabled, lastSentAt: s.last_sent_at } : null,
    recipients: await boardPackRecipients(req.user.orgId),
    frequencies: B.PACK_FREQUENCIES, dayMin: B.SCHEDULE_DAY_MIN, dayMax: B.SCHEDULE_DAY_MAX,
    offSentence: B.SCHEDULE_OFF_SENTENCE,
    sends: sends.map(r => ({ periodKey: r.period_key, periodLabel: r.period_label, recipients: r.recipients, at: r.created_at })),
  });
}));

app.put("/board-pack/schedule", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
  const B = await BP_READY;
  const v = B.validateSchedule(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" "), errors: v.errors });
  // Turning it ON with nobody to send it to would schedule a send that can
  // only fail, so it is refused with the thing to do about it.
  if (v.value.enabled && !(await boardPackRecipients(req.user.orgId)).length) {
    return res.status(400).json({ error: "Add the staff and board addresses in Settings before turning the schedule on." });
  }
  if (v.value.dashboardId && !(await savedDashboardFor(req.user.orgId, req.user.userId, v.value.dashboardId))) {
    return res.status(400).json({ error: "That dashboard is not one you can open." });
  }
  const [existing] = await query("SELECT id FROM board_pack_schedules WHERE org_id=?", [req.user.orgId]);
  if (existing) {
    await run(`UPDATE board_pack_schedules SET dashboard_id=?, frequency=?, day_of_month=?, enabled=?, updated_at=NOW() WHERE id=?`,
      [v.value.dashboardId, v.value.frequency, v.value.dayOfMonth, v.value.enabled, existing.id]);
    return res.json({ id: existing.id });
  }
  const id = "bps_" + uuid().slice(0, 10);
  await run(`INSERT INTO board_pack_schedules (id,org_id,dashboard_id,frequency,day_of_month,enabled,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, v.value.dashboardId, v.value.frequency, v.value.dayOfMonth, v.value.enabled, actor(req).id, actor(req).name]);
  res.status(201).json({ id });
}));

// "Send a test to me" — to the CALLER's own address and nowhere else. It is
// not a dress rehearsal of the schedule: it reserves nothing and logs no send,
// because nothing went to the board.
app.post("/board-pack/schedule/test", requireAuth, wrap(async (req, res) => {
  const [me] = await query("SELECT email, name FROM users WHERE id=? AND org_id=?", [req.user.userId, req.user.orgId]);
  if (!me || !me.email) return res.status(400).json({ error: "Your account has no email address on it." });
  const [s] = await query("SELECT * FROM board_pack_schedules WHERE org_id=?", [req.user.orgId]);
  const pack = await composeBoardPack(req.user.orgId, {
    dashboardId: (s && s.dashboard_id) || null, userId: req.user.userId,
    frequency: (s && s.frequency) || "quarterly",
  });
  if (!pack) return res.status(400).json({ error: "The dashboard this schedule names is not there any more." });
  const [org] = await query("SELECT id, name FROM orgs WHERE id=?", [req.user.orgId]);
  const pdf = await renderBoardPackPdf(pack);
  const sent = await sendBoardPackEmail(org, me.email, `Test · ${pack.title} · ${pack.period.label}`,
    boardPackEmailHtml(pack, { test: true }), pdf, boardPackFilename(pack));
  // FIX-15 Part 3 — the provider's answer, not an optimistic one.
  res.json({ sent, to: me.email, period: pack.period.label });
}));

function boardPackEmailHtml(pack, { test = false } = {}) {
  return `<div style="font-family:Arial,sans-serif;color:#0f1a12">
    ${test ? `<p style="font-size:13px;color:#5a554f">This is the test copy you asked for. Nobody else was sent it.</p>` : ""}
    <p style="font-size:15px"><strong>${escapeHtml(pack.title)}</strong> for ${escapeHtml(pack.period.label)} is attached.</p>
    <p style="font-size:13px;color:#5a554f">Produced ${escapeHtml(pack.producedOnLabel)}. Every number in it is defined on the last page.</p>
  </div>`;
}

// THE SCHEDULED SEND. The digest_sends discipline: the ledger row is RESERVED
// before the first send and released if nothing went out, so a board never
// gets the same pack twice and a failed run can go again on the next tick.
async function runBoardPackScheduleForOrg(org, { today, force = false } = {}) {
  const B = await BP_READY;
  const [s] = await query("SELECT * FROM board_pack_schedules WHERE org_id=? AND enabled = true", [org.id]);
  if (!s) return { sent: 0, skipped: 0, reason: "no enabled schedule" };
  if (!force && !B.isSendDay({ frequency: s.frequency, dayOfMonth: s.day_of_month }, today)) {
    return { sent: 0, skipped: 0, reason: "not the day" };
  }
  const to = await boardPackRecipients(org.id);
  if (!to.length) return { sent: 0, skipped: 0, reason: "no recipients" };
  const pack = await composeBoardPack(org.id, {
    dashboardId: s.dashboard_id, userId: null, frequency: s.frequency,
  });
  if (!pack) return { sent: 0, skipped: 0, reason: "dashboard gone" };
  const periodKey = B.periodKeyFor(s.frequency, pack.period.key);
  const reserved = await query(
    "INSERT INTO board_pack_sends (id,org_id,schedule_id,period_key,period_label,recipients) VALUES (?,?,?,?,?,?) ON CONFLICT (schedule_id, period_key) DO NOTHING RETURNING id",
    ["bpk_" + uuid().slice(0, 10), org.id, s.id, periodKey, pack.period.label, to.length]);
  if (!reserved.length) return { sent: 0, skipped: 1, reason: "already sent for this period" };
  const pdf = await renderBoardPackPdf(pack);
  let sent = 0;
  for (const addr of to) {
    if (await sendBoardPackEmail(org, addr, `${pack.title} · ${pack.period.label}`, boardPackEmailHtml(pack), pdf, boardPackFilename(pack))) sent++;
  }
  if (!sent) {
    await run("DELETE FROM board_pack_sends WHERE id=?", [reserved[0].id]);
    return { sent: 0, skipped: to.length, reason: "nothing was accepted" };
  }
  await run("UPDATE board_pack_sends SET recipients=? WHERE id=?", [sent, reserved[0].id]);
  await run("UPDATE board_pack_schedules SET last_sent_at=NOW() WHERE id=?", [s.id]);
  return { sent, skipped: to.length - sent, periodKey, period: pack.period.label };
}

// Ops/test hook: drive the exact scheduled path for the caller's org.
app.post("/board-pack/schedule/run", requireAuth, requireAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT id, name, timezone FROM orgs WHERE id=?", [req.user.orgId]);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String((req.body || {}).today || "")) ? req.body.today : orgToday(await orgTz(req.user.orgId));   // ORG_TZ_SEAM_OK
  res.json(await runBoardPackScheduleForOrg(org, { today, force: (req.body || {}).force === true }));
}));

// ── Board Reports ──────────────────────────────────────────────────────────
const BOARD_REPORTS_DDL = `
  CREATE TABLE IF NOT EXISTS board_reports (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    quarter INTEGER,
    year INTEGER,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    generated_by TEXT,
    generated_by_name TEXT,
    metrics TEXT,
    pdf_data TEXT
  )`;
const BOARD_REPORTS_MIGRATE = `ALTER TABLE board_reports ADD COLUMN IF NOT EXISTS pdf_data TEXT`;

app.get("/reports/board", requireAuth, wrap(async (req, res) => {
  await run(BOARD_REPORTS_DDL).catch(() => {});
  await run(BOARD_REPORTS_MIGRATE).catch(() => {});
  const rows = await query(
    "SELECT id, quarter, year, generated_at, generated_by_name, metrics FROM board_reports WHERE org_id = ? ORDER BY generated_at DESC LIMIT 20",
    [req.user.orgId]
  );
  res.json(rows.map(r => ({
    ...r,
    metrics: typeof r.metrics === "string" ? JSON.parse(r.metrics || "{}") : (r.metrics || {}),
  })));
}));

app.get("/reports/board/:id/pdf", requireAuth, wrap(async (req, res) => {
  // BUILD-75 B: the table is lazily created by the sibling list/generate
  // routes — without the same guard here, the FIRST request an org ever
  // makes to this route on a fresh database was a 500, and a foreign id
  // 500ed instead of 404ing.
  await run(BOARD_REPORTS_DDL).catch(() => {});
  const [report] = await query(
    "SELECT id, quarter, year, pdf_data FROM board_reports WHERE id = ? AND org_id = ?",
    [req.params.id, req.user.orgId]
  );
  if (!report || !report.pdf_data) return res.status(404).json({ error: "Report not found" });
  const buf = Buffer.from(report.pdf_data, "base64");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="board-report-q${report.quarter}-${report.year}.pdf"`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}));

app.post("/reports/board", requireAuth, wrap(async (req, res) => {
  console.log("[board-report] START — orgId:", req.user.orgId);

  let PDFDocument;
  try {
    PDFDocument = require("pdfkit");
    console.log("[board-report] step 1: pdfkit loaded OK");
  } catch(e) {
    console.error("[board-report] FAIL step 1: pdfkit not found —", e.message);
    return res.status(500).json({ error: "pdfkit module missing: " + e.message });
  }

  const { orgId, userId, email } = req.user;

  await run(BOARD_REPORTS_DDL).catch(e => console.error("[board-report] DDL warn:", e.message));
  await run(BOARD_REPORTS_MIGRATE).catch(() => {});

  // Date helpers — toDs safely converts Date objects OR strings to YYYY-MM-DD
  // ORG_TZ_SEAM_OK (BUILD-75 A.1) — the stamped quarter/year and every period
  // bound come from the ORG's civil date, not the process clock. The old
  // `new Date().getFullYear()`/`getMonth()` form stamped next quarter's label
  // on a report generated in the last UTC-offset hours of Mar/Jun/Sep/Dec 31.
  const _orgTzBR = await orgTz(orgId);
  const today = orgToday(_orgTzBR);
  const qb = orgTime.orgPeriodBounds(_orgTzBR, "quarter", 0);
  const pqb = orgTime.orgPeriodBounds(_orgTzBR, "quarter", -1);
  const yr = orgTime.parseCivil(today).y;
  const q = Math.floor((orgTime.parseCivil(today).m - 1) / 3) + 1;
  const qMs = qb.start, qMe = qb.end;
  const pqMs = pqb.start;
  // FIX-60: a quarter still running is compared with the SAME number of days
  // of the quarter before, never with all of it.
  const qThrough = orgTime.compareCivil(qMe, today) > 0 ? today : qMe;
  const qRunning = qThrough !== qMe;
  const qDays = orgTime.daysBetween(qMs, qThrough) + 1;
  let pqMe = orgTime.addDays(pqMs, qDays - 1);
  if (orgTime.compareCivil(pqMe, pqb.end) > 0) pqMe = pqb.end;
  // NUMBERS-4: "this year" is the org's FISCAL year to date, labelled with its
  // months (shared/numbers/fiscalYear.js). It was the calendar year, beside a
  // Fundraising page and reports that all read the fiscal year.
  const [_brOrgRow] = await query("SELECT * FROM orgs WHERE id = ?", [orgId]);
  const _fy = NUMBERS.fiscalYear.fiscalYearToDate(_brOrgRow || {}, 0);
  const _fyPrev = NUMBERS.fiscalYear.fiscalYear(_brOrgRow || {}, -1);
  const ytdS = _fy.from;
  const ytdE = _fy.to;
  const toDs = d => d ? (d instanceof Date ? orgTime.civilOf(d) : String(d)).slice(0, 10) : "";

  console.log("[board-report] step 2: dates — q:", q, "yr:", yr, "qMs:", qMs, "qMe:", qMe);

  // Fetch raw data
  console.log("[board-report] step 3: fetching core data...");
  const [org, allDonors, allGrants, allTasks, allCampaigns] = await Promise.all([
    query("SELECT * FROM orgs WHERE id = ?", [orgId]).then(r => r[0]),
    query("SELECT id,name,total_giving,stage,created_at FROM donors WHERE org_id = ? AND deleted_at IS NULL", [orgId]),
    query("SELECT * FROM grants WHERE org_id = ?", [orgId]),
    query("SELECT done,due FROM tasks WHERE org_id = ? AND voided_at IS NULL", [orgId]),
    query("SELECT * FROM campaigns WHERE org_id = ?", [orgId]),
  ]);
  console.log("[board-report] step 3: core data OK — donors:", allDonors.length, "grants:", allGrants.length, "tasks:", allTasks.length, "campaigns:", allCampaigns.length);

  // Finance
  console.log("[board-report] step 4: fetching finance data...");
  const [ytdFinRows, allFinRows, topExpRows, budgetRows] = await Promise.all([
    query("SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? AND date >= ? AND date <= ? GROUP BY type", [orgId, ytdS, ytdE]),
    query("SELECT type, SUM(amount) as total FROM fin_transactions WHERE org_id = ? GROUP BY type", [orgId]),
    query(
      `SELECT a.name, SUM(ft.amount) as total FROM fin_transactions ft
       LEFT JOIN accounts a ON a.id = ft.account_id
       WHERE ft.org_id = ? AND ft.type = 'expense' AND ft.date >= ? AND ft.date <= ?
       GROUP BY a.name ORDER BY total DESC LIMIT 5`,
      [orgId, ytdS, ytdE]
    ),
    query(
      `SELECT a.name, COALESCE(b.amount, 0) as budget, COALESCE(SUM(ft.amount), 0) as actual
       FROM accounts a
       LEFT JOIN budgets b ON b.account_id = a.id AND b.year = ? AND COALESCE(b.basis, 'calendar') = 'calendar'
       LEFT JOIN fin_transactions ft ON ft.account_id = a.id AND ft.type = 'expense' AND ft.date >= ? AND ft.date <= ?
       WHERE a.org_id = ? AND a.type = 'expense' AND a.active = TRUE
       GROUP BY a.name, b.amount ORDER BY actual DESC LIMIT 8`,
      // NUMBERS-4: this block is a CALENDAR-basis budget (b.basis), so its
      // actuals stay on that budget's calendar year, beside it.
      [yr, `${yr}-01-01`, `${yr}-12-31`, orgId]
    ),
  ]);

  console.log("[board-report] step 4: finance OK — ytdFinRows:", ytdFinRows.length, "budgetRows:", budgetRows.length);
  const ytdFin = Object.fromEntries(ytdFinRows.map(r => [r.type, parseFloat(r.total) || 0]));
  const allFin = Object.fromEntries(allFinRows.map(r => [r.type, parseFloat(r.total) || 0]));
  const ytdRevenue  = ytdFin.income  || 0;
  const ytdExpenses = ytdFin.expense || 0;
  const netSurplus  = ytdRevenue - ytdExpenses;
  const cashOnHand  = (allFin.income || 0) - (allFin.expense || 0);
  const totalBudget = budgetRows.reduce((s, r) => s + (parseFloat(r.budget) || 0), 0);
  const totalActual = budgetRows.reduce((s, r) => s + (parseFloat(r.actual) || 0), 0);
  const budgetVariance = totalBudget - totalActual;

  // Donors
  // NUMBERS-4: people, counted once (shared/numbers/households.js).
  const totalDonors  = (await NUMBERS.households.counts(query, orgId)).people;
  const lapsedDonors = allDonors.filter(d => d.stage === "lapsed").length;
  const newDonorsQ   = allDonors.filter(d => toDs(d.created_at) >= qMs && toDs(d.created_at) <= qMe).length;
  const top10        = [...allDonors].sort((a, b) => (b.total_giving || 0) - (a.total_giving || 0)).slice(0, 10);

  console.log("[board-report] step 5: fetching gift retention rows...");
  // NUMBERS-4: retained is shared/numbers/retained.js (gave last fiscal year
  // and this one, gifts only, live people) and the quarter's money is
  // givingBetween (money: credit rows out, refunds off, never past today).
  // They were their own SQL: calendar years, refunds and credits counted.
  const [ret, qGive, pqGive] = await Promise.all([
    NUMBERS.retained.retention(query, orgId, { from: _fy.from, to: _fy.to }, { from: _fyPrev.start, to: _fyPrev.end }),
    NUMBERS.givingBetween.givingBetween(query, orgId, { from: qMs, to: qMe, today }),
    NUMBERS.givingBetween.givingBetween(query, orgId, { from: pqMs, to: pqMe, today }),
  ]);
  console.log("[board-report] step 5: retention OK — retained:", ret.retained, "of", ret.prior);
  const retentionRate = ret.prior > 0 ? Math.round(ret.retained / ret.prior * 100) : 0;
  const raisedThisQ   = qGive.cents / 100;
  const raisedLastQ   = pqGive.cents / 100;

  // Grants
  const activeGrants    = allGrants.filter(g => g.status === "active");
  const pipelineGrants  = allGrants.filter(g => ["prospecting", "pending"].includes(g.status));
  const wonThisQ        = allGrants.filter(g => g.status === "active" && toDs(g.updated_at) >= qMs);
  // FIX-12: `now` lived in server.js's scope before the FIX-1 split and was
  // never brought across, so every board report died here with a ReferenceError.
  const now             = new Date();
  const thirty          = new Date(now); thirty.setDate(thirty.getDate() + 30);
  const upcomingDL      = allGrants.filter(g => {
    if (!g.deadline || g.status === "closed") return false;
    const d = new Date(g.deadline); return d >= now && d <= thirty;
  });
  // BUILD-100 Part 1 migrated these columns INTEGER → NUMERIC(12,2), and pg
  // serialises NUMERIC as a STRING, so `0 + "5000.00"` CONCATENATED: the board
  // report's pipeline value read "05000.003000.00". Summed in integer cents
  // through the one money seam, which is the rule for a figure a board reads.
  const pipelineValue = toDollars(pipelineGrants.reduce((s, g) => s + (toCents(g.amount) || 0), 0));
  const awardedYTD    = toDollars(activeGrants.reduce((s, g) => s + (toCents(g.received) || 0), 0));

  // Communications
  const sentQ        = allCampaigns.filter(c => c.status === "sent" && toDs(c.sent_at) >= qMs && toDs(c.sent_at) <= qMe);
  const avgOpenRate  = sentQ.length > 0
    ? Math.round(sentQ.reduce((s, c) => s + ((c.open_count || 0) / Math.max(c.recipient_count || 1, 1) * 100), 0) / sentQ.length)
    : 0;
  const totalReached = sentQ.reduce((s, c) => s + (c.recipient_count || 0), 0);

  // Tasks
  const completedQ = allTasks.filter(t => t.done && (t.due || "") >= qMs && (t.due || "") <= qMe).length;
  const overdue    = allTasks.filter(t => !t.done && t.due && t.due < today).length;

  console.log("[board-report] step 6: computed — totalDonors:", totalDonors, "activeGrants:", activeGrants.length, "pipelineValue:", pipelineValue, "raisedThisQ:", raisedThisQ, "completedQ:", completedQ, "overdue:", overdue);

  // AI Executive Summary
  console.log("[board-report] step 7: calling Claude API...");
  const client = anthropicFor(orgId);
  let execSummary = "";
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      thinking: { type: "disabled" },   // FIX-28: three short paragraphs need no thinking (the ASK-3 rule)
      messages: [{
        role: "user",
        content: `Write an executive summary for a nonprofit board of directors. Exactly 3 paragraphs. Confident, board-appropriate, factual tone. No bullet points. No headers. Prose only.

Paragraph 1, Financial Health: YTD Revenue $${ytdRevenue.toLocaleString()}, Expenses $${ytdExpenses.toLocaleString()}, Net Surplus $${netSurplus.toLocaleString()}, Cash on Hand $${cashOnHand.toLocaleString()}, Budget Variance ${budgetVariance >= 0 ? "favorable" : "unfavorable"} by $${Math.abs(budgetVariance).toLocaleString()}. Top expense category: ${topExpRows[0]?.name || "operations"}.

Paragraph 2, Donor & Fundraising Momentum: ${totalDonors} total donors, ${newDonorsQ} new this quarter, ${lapsedDonors} lapsed, ${retentionRate}% retention rate vs prior year. Raised $${raisedThisQ.toLocaleString()} this quarter vs $${raisedLastQ.toLocaleString()} ${qRunning ? `in the first ${qDays} days of last quarter` : "last quarter"}. ${sentQ.length} campaigns sent with ${avgOpenRate}% average open rate.

Paragraph 3, Grants & Opportunities: ${activeGrants.length} active grants, $${pipelineValue.toLocaleString()} in pipeline, $${awardedYTD.toLocaleString()} awarded YTD. ${wonThisQ.length} grants won this quarter. ${upcomingDL.length} deadline(s) in the next 30 days${upcomingDL.length > 0 ? " (" + upcomingDL.slice(0, 3).map(g => g.funder).join(", ") + ")" : ""}. ${overdue} overdue tasks.

Organization: ${org.name}. Mission: ${org.mission || "not specified"}. Period: Q${q} ${yr}. Year to date means the fiscal year to date, ${_fy.label}.`,
      }],
    });
    // FIX-28: an unfinished summary is never printed; the template paragraphs are used instead.
    if (msg.stop_reason && msg.stop_reason !== "end_turn") throw new Error(`unfinished reply (${msg.stop_reason})`);
    execSummary = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!execSummary) throw new Error("empty reply");
    console.log("[board-report] step 7: Claude OK —", execSummary.length, "chars");
  } catch(e) {
    console.error("[board-report] step 7: Claude FAILED (using fallback) —", e.message);
    recordAiFallback(orgId, "board_report.summary", e);
    execSummary = `${org.name} concludes Q${q} ${yr} with year-to-date revenue of $${ytdRevenue.toLocaleString()} and expenses of $${ytdExpenses.toLocaleString()}, producing a net ${netSurplus >= 0 ? "surplus" : "deficit"} of $${Math.abs(netSurplus).toLocaleString()}. Cash on hand stands at $${cashOnHand.toLocaleString()}, with a budget variance that is ${budgetVariance >= 0 ? "favorable" : "unfavorable"} by $${Math.abs(budgetVariance).toLocaleString()}.\n\nThe donor base comprises ${totalDonors} constituents, with ${newDonorsQ} new donors acquired this quarter and a year-over-year retention rate of ${retentionRate}%. The organization raised $${raisedThisQ.toLocaleString()} this quarter compared to $${raisedLastQ.toLocaleString()} ${qRunning ? `in the first ${qDays} days of the prior quarter` : "in the prior quarter"}. ${sentQ.length} email campaigns reached ${totalReached} donors with an average open rate of ${avgOpenRate}%.\n\nThe grant portfolio includes ${activeGrants.length} active grants with $${pipelineValue.toLocaleString()} in the pipeline and $${awardedYTD.toLocaleString()} awarded year to date. ${wonThisQ.length > 0 ? wonThisQ.length + " grant(s) were secured this quarter. " : ""}${upcomingDL.length} deadline(s) fall within the next 30 days, requiring board awareness and organizational follow-through.`;
  }

  // Generate PDF
  console.log("[board-report] step 8: generating PDF...");
  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  const pdfBuffer = await new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN = "#1a6b4a";
    const INK   = "#1a1a1a";
    const INK3  = "#6b7280";
    const BG    = "#f5f5f0";
    const PW    = doc.page.width;
    const fmtD  = n => "$" + (parseFloat(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const ql    = `Q${q} ${yr}`;
    const genDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // ── PAGE 1: Cover ──────────────────────────────────────────────────────
    doc.rect(0, 0, PW, doc.page.height).fill("#0d1117");
    doc.rect(0, 0, PW, 5).fill(GREEN);
    doc.rect(0, doc.page.height - 5, PW, 5).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(30).fillColor("#ffffff").text(org.name, 0, 250, { align: "center", width: PW });
    doc.font("Helvetica").fontSize(10).fillColor("#6b7280").text("B O A R D   R E P O R T", 0, doc.y + 10, { align: "center" });
    doc.font("Helvetica-Bold").fontSize(22).fillColor(GREEN).text(ql, 0, doc.y + 10, { align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text(genDate, 0, doc.y + 8, { align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor("#374151").text("CONFIDENTIAL: FOR BOARD USE ONLY", 0, doc.y + 40, { align: "center", characterSpacing: 1.5 });

    // ── PAGE 2: Executive Summary ──────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Executive Summary", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(ql + " · " + org.name, 50, 42);

    let y = 76;
    execSummary.split(/\n+/).filter(Boolean).forEach((para, i) => {
      if (i > 0) y += 12;
      doc.font("Helvetica").fontSize(11).fillColor(INK).text(para.trim(), 50, y, { width: PW - 100, lineGap: 5 });
      y = doc.y + 2;
    });

    // ── PAGE 3: Financial Snapshot ─────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Financial Snapshot", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(`Fiscal year to date, ${_fy.label}`, 50, 42);

    y = 76;
    const mw = (PW - 100) / 4;
    [
      ["YTD Revenue",  fmtD(ytdRevenue),  "#1a6b4a"],
      ["YTD Expenses", fmtD(ytdExpenses), "#dc2626"],
      ["Net Surplus",  fmtD(netSurplus),  netSurplus >= 0 ? "#1a6b4a" : "#dc2626"],
      ["Cash on Hand", fmtD(cashOnHand),  cashOnHand >= 0 ? "#1a6b4a" : "#dc2626"],
    ].forEach(([label, value, color], i) => {
      const x = 50 + i * mw;
      doc.rect(x, y, mw - 6, 60).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: mw - 18 });
      doc.font("Helvetica-Bold").fontSize(15).fillColor(color).text(value, x + 8, y + 24, { width: mw - 18 });
    });
    y += 72;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Budget vs. Actuals, Expense Accounts", 50, y); y += 18;
    doc.rect(50, y, PW - 100, 22).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#fff");
    doc.text("Account", 58, y + 7, { width: 195 });
    doc.text("Budget", 260, y + 7, { width: 85, align: "right" });
    doc.text("Actual YTD", 352, y + 7, { width: 85, align: "right" });
    doc.text("Variance", 444, y + 7, { width: 78, align: "right" });
    y += 22;

    budgetRows.forEach((row, i) => {
      const bgt  = parseFloat(row.budget) || 0;
      const act  = parseFloat(row.actual) || 0;
      const vari = bgt - act;
      doc.rect(50, y, PW - 100, 20).fill(i % 2 === 0 ? "#ffffff" : BG);
      doc.font("Helvetica").fontSize(8).fillColor(INK).text(row.name || "Uncategorized", 58, y + 6, { width: 195 });
      doc.text(bgt > 0 ? fmtD(bgt) : "Not set", 260, y + 6, { width: 85, align: "right" });
      doc.text(fmtD(act), 352, y + 6, { width: 85, align: "right" });
      doc.font("Helvetica-Bold").fillColor(vari >= 0 ? "#1a6b4a" : "#dc2626").text((vari >= 0 ? "+" : "") + fmtD(vari), 444, y + 6, { width: 78, align: "right" });
      y += 20;
    });

    doc.rect(50, y, PW - 100, 22).fill("#e5e7eb");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text("TOTAL", 58, y + 7, { width: 195 });
    doc.text(fmtD(totalBudget), 260, y + 7, { width: 85, align: "right" });
    doc.text(fmtD(totalActual), 352, y + 7, { width: 85, align: "right" });
    doc.fillColor(budgetVariance >= 0 ? "#1a6b4a" : "#dc2626").text((budgetVariance >= 0 ? "+" : "") + fmtD(budgetVariance), 444, y + 7, { width: 78, align: "right" });
    y += 30;

    if (topExpRows.length > 0) {
      doc.font("Helvetica").fontSize(8).fillColor(INK3).text(
        `Largest expense category: ${topExpRows[0].name} (${fmtD(topExpRows[0].total)})`, 50, y
      );
    }

    // ── PAGE 4: Donor Dashboard ────────────────────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Donor Dashboard", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(ql, 50, 42);

    y = 76;
    [
      ["Total Donors",      String(totalDonors),  INK],
      ["New This Quarter",  String(newDonorsQ),   "#1a6b4a"],
      ["Lapsed Donors",     String(lapsedDonors), "#dc2626"],
      ["Retention Rate",    retentionRate + "%",  retentionRate >= 70 ? "#1a6b4a" : retentionRate >= 50 ? "#f59e0b" : "#dc2626"],
    ].forEach(([label, value, color], i) => {
      const x = 50 + i * mw;
      doc.rect(x, y, mw - 6, 60).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: mw - 18 });
      doc.font("Helvetica-Bold").fontSize(15).fillColor(color).text(value, x + 8, y + 24, { width: mw - 18 });
    });
    y += 72;

    const qChange = raisedLastQ > 0 ? ((raisedThisQ - raisedLastQ) / raisedLastQ * 100).toFixed(1) : null;
    doc.rect(50, y, PW - 100, 44).fill(BG);
    doc.font("Helvetica").fontSize(8).fillColor(INK3).text("RAISED THIS QUARTER", 62, y + 9);
    doc.font("Helvetica-Bold").fontSize(20).fillColor(GREEN).text(fmtD(raisedThisQ), 62, y + 22);
    doc.font("Helvetica").fontSize(9).fillColor(INK3).text(qRunning ? `vs ${fmtD(raisedLastQ)}, the first ${qDays} days of last quarter` : `vs ${fmtD(raisedLastQ)} prior quarter`, 215, y + 26);
    if (qChange !== null) {
      const dir = parseFloat(qChange) >= 0 ? "▲" : "▼";
      doc.font("Helvetica-Bold").fontSize(12)
        .fillColor(parseFloat(qChange) >= 0 ? "#1a6b4a" : "#dc2626")
        .text(`${dir} ${Math.abs(parseFloat(qChange)).toFixed(1)}%`, 375, y + 22);
    }
    y += 56;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Top 10 Donors: Lifetime Giving", 50, y); y += 18;
    doc.rect(50, y, PW - 100, 22).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#fff");
    doc.text("#", 58, y + 7, { width: 18 });
    doc.text("Donor", 82, y + 7, { width: 235 });
    doc.text("Stage", 324, y + 7, { width: 90 });
    doc.text("Lifetime Giving", 422, y + 7, { width: 100, align: "right" });
    y += 22;

    top10.forEach((d, i) => {
      const parts   = (d.name || "").trim().split(" ");
      const display = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
      doc.rect(50, y, PW - 100, 20).fill(i % 2 === 0 ? "#ffffff" : BG);
      doc.font("Helvetica").fontSize(8).fillColor(INK3).text(String(i + 1), 58, y + 6, { width: 18 });
      doc.fillColor(INK).text(display, 82, y + 6, { width: 235 });
      doc.fillColor(INK3).text(d.stage || "Not set", 324, y + 6, { width: 90 });
      doc.font("Helvetica-Bold").fillColor(GREEN).text(fmtD(d.total_giving), 422, y + 6, { width: 100, align: "right" });
      y += 20;
    });

    // ── PAGE 5: Grants + Communications + Tasks ────────────────────────────
    doc.addPage();
    doc.rect(0, 0, PW, 58).fill(GREEN);
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#fff").text("Grants & Operations", 50, 18);
    doc.font("Helvetica").fontSize(9).fillColor("#a7f3d0").text(ql, 50, 42);

    y = 76;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Grant Portfolio", 50, y); y += 18;
    const gmw = (PW - 100) / 5;
    [
      ["Active Grants",  String(activeGrants.length)],
      ["Pipeline Value", fmtD(pipelineValue)],
      ["Awarded YTD",    fmtD(awardedYTD)],
      ["Won This Qtr",   String(wonThisQ.length)],
      ["Due in 30 Days", String(upcomingDL.length)],
    ].forEach(([label, value], i) => {
      const x = 50 + i * gmw;
      doc.rect(x, y, gmw - 5, 52).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 7, y + 8, { width: gmw - 16 });
      doc.font("Helvetica-Bold").fontSize(14).fillColor(GREEN).text(value, x + 7, y + 22, { width: gmw - 16 });
    });
    y += 64;

    if (upcomingDL.length > 0) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Upcoming Grant Deadlines (Next 30 Days)", 50, y); y += 16;
      upcomingDL.slice(0, 5).forEach((g, i) => {
        const days = Math.round((new Date(g.deadline) - now) / 86400000);
        doc.rect(50, y, PW - 100, 19).fill(i % 2 === 0 ? "#ffffff" : BG);
        doc.font("Helvetica").fontSize(8).fillColor(INK).text(g.funder, 58, y + 5, { width: 200 });
        doc.fillColor(INK3).text(g.program || "Not set", 264, y + 5, { width: 140 });
        doc.font("Helvetica-Bold").fillColor(days <= 14 ? "#dc2626" : "#f59e0b").text(days + "d", 415, y + 5, { width: 100, align: "right" });
        y += 19;
      });
      y += 12;
    }

    doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 16;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Communications: Q" + q + " Activity", 50, y); y += 18;
    const cw = (PW - 100) / 3;
    [
      ["Campaigns Sent", String(sentQ.length)],
      ["Avg Open Rate",  avgOpenRate + "%"],
      ["Donors Reached", String(totalReached)],
    ].forEach(([label, value], i) => {
      const x = 50 + i * cw;
      doc.rect(x, y, cw - 6, 50).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: cw - 18 });
      doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(value, x + 8, y + 22, { width: cw - 18 });
    });
    y += 62;

    doc.moveTo(50, y).lineTo(PW - 50, y).strokeColor("#e5e7eb").lineWidth(0.5).stroke(); y += 16;

    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Task Summary", 50, y); y += 18;
    [
      ["Completed This Qtr", String(completedQ),                        "#1a6b4a"],
      ["Overdue Tasks",      String(overdue),                           overdue > 0 ? "#dc2626" : "#1a6b4a"],
      ["Total Open",         String(allTasks.filter(t => !t.done).length), INK],
    ].forEach(([label, value, color], i) => {
      const x = 50 + i * cw;
      doc.rect(x, y, cw - 6, 50).fill(BG);
      doc.font("Helvetica").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x + 8, y + 9, { width: cw - 18 });
      doc.font("Helvetica-Bold").fontSize(16).fillColor(color).text(value, x + 8, y + 22, { width: cw - 18 });
    });

    // Page numbers + footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af")
        .text(`${org.name}  ·  ${ql} Board Report  ·  Confidential`, 50, doc.page.height - 28, { width: PW - 130, height: 20, align: "left" })
        .text(`${i - range.start + 1} / ${range.count}`, PW - 80, doc.page.height - 28, { width: 30, height: 20, align: "right" });
    }

    doc.end();
  });

  console.log("[board-report] step 8: PDF OK —", pdfBuffer.length, "bytes");

  // Save report record
  const reportId = "br_" + uuid().slice(0, 8);
  await run(
    "INSERT INTO board_reports (id,org_id,quarter,year,generated_by,generated_by_name,metrics,pdf_data) VALUES (?,?,?,?,?,?,?,?)",
    [reportId, orgId, q, yr, userId, email, JSON.stringify({
      ytdRevenue, ytdExpenses, netSurplus, cashOnHand,
      totalDonors, newDonorsQ, lapsedDonors, retentionRate,
      raisedThisQ, raisedLastQ,
      activeGrants: activeGrants.length, pipelineValue, awardedYTD,
      sentCampaigns: sentQ.length, avgOpenRate, totalReached,
      completedQ, overdue,
    }), pdfBuffer.toString("base64")]
  ).catch(e => console.error("[board-report] step 9 WARN: save failed —", e.message));
  console.log("[board-report] step 9: record saved —", reportId);

  const safeOrg  = org.name.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase();
  const filename = `${safeOrg}-board-report-q${q}-${yr}.pdf`;
  console.log("[board-report] DONE — sending", filename, pdfBuffer.length, "bytes");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.end(pdfBuffer);
}));
// REPORTS-3 — the scheduled board pack, for routes/jobs.js's 5-minute tick.
// Handed out here rather than exported from module scope, where it does not
// exist: everything in this file is declared inside mount().
reportHooks.runBoardPackSchedule = runBoardPackScheduleForOrg;
}

module.exports = { routers, mount };
