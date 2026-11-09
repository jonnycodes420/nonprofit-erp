// server/reports/dashboard.js — the dashboard, Home, dashboard tiles and saved dashboards.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it: each router below sits inside crm.js's r0 or r1 at the
// place its routes held in the one file, so Express tries them in the same order.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).
const express = require("express");
const NUMBERS = require("../../shared/numbers");   // NUMBERS-3 — one home for every giving number
const { newId } = require("../shared/newId");   // IDS-1: every new row id is prefix + 20 hex
// SCALE-2: org-wide figures are stored per org and served until something changes.
const OS = require("../../orgSummary");
const SEALED_MAIL = require("../mail/sealedMail");   // SECURE-3: a synced email's body opens only here

const routers = {
  r1: express.Router(),
};

function mount(ctx) {
const {
  ALL_PIPELINE_STAGES, MEANINGFUL_CONTACT_TYPES, NOT_HISTORY_TYPES, RB_READY, UNDO_SECONDS, actor, asJson,
  checkWriteAccess, composeBoardPack, computeAtRiskCandidates, computeDashboard, computeRetentionRate,
  computeStewardshipDebtBreakdown, dashboardsMod, displayNameCase, donorOnly, figureSources,
  fundraisingCampaignRows, fundraisingGoalsPortfolio, goalFigureRow, grantMsMod, importHealth,
  lookupMatchingGift, orgDaysOverdue, orgFiscalYearStart, orgPlanTier, orgRow, orgTime, orgToday, orgTz,
  portfolioMembership, query, requireAuth, run, solicitableSql, toCents, toDollars, trashRow, uuid, wrap,
} = ctx;
let RB = null;
RB_READY.then(m => { RB = m; });

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
let app = routers.r1;

app.get("/dashboards/:key", requireAuth, wrap(async (req, res) => {
  const out = await computeDashboard(req.user.orgId, String(req.params.key),
    { isTeam: orgPlanTier(await orgRow(req.user.orgId)) === "team" });
  if (!out) return res.status(404).json({ error: "Unknown dashboard" });
  res.json(out);
}));

// PARITY-1 Part C · HOME'S ANNUAL GOAL BAR. The org's annual goal (the most
// recent active top-level goal whose category is Annual), drawn from the SAME
// goal row the Fundraising dashboard draws (goalFigureRow), so the raised
// figure opens the gifts behind it. No annual goal, no bar: `goal` is null.
app.get("/home/annual-goal", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const out = await fundraisingCampaignRows(orgId).then(fundraisingGoalsPortfolio).catch(() => null);
  const g = ((out && out.goals) || []).find(x => x.isTopLevel && x.lifecycle === "active" && x.goalCategory === "annual");
  // LEDGER-1: running today, as Fundraising's roll-up counts goals (a goal not
  // started yet has raised nothing in its own dates and read $0 here).
  if (!g) return res.json({ goal: null });
  const fig = async source => ({ ...(await figureSources.figureValue(orgId, source, {})), source });
  res.json({ goal: await goalFigureRow(g, fig) });
}));

// ── THE BOARD PACKET ───────────────────────────────────────────────────────
// A dashboard, as a PDF, for a packet. Rendered from the SAME payload the
// screen renders, so the totals are equal by construction rather than by two
// pieces of arithmetic agreeing — tests/dashboards.test.js proves it in CENTS.
//
// Every footnote is the definition string from shared/dashboards.js. The
// sentence a board member reads on hover and the one printed under the table
// are one string, not two copies.
async function renderDashboardPdf(board, org) {
  const PDFDocument = require("pdfkit");
  const DD = await import("../../shared/displayDate.js");
  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const INK = "#0f1a12", EMERALD = "#0d5c3a", GREY = "#5a554f", PW = doc.page.width;
    // Sign first (-$800.00), the fmtFull rule.
    const fmtMoney = n => {
      const c = Math.round((Number(n) || 0) * 100);
      return (c < 0 ? "-$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    // A figure prints the way it is DECLARED, never guessed from its size.
    const fmtFigure = (kind, v, suffix) => v === null || v === undefined ? "not enough history yet"
      : kind === "money" ? fmtMoney(v) : kind === "percent" ? `${v}%` : `${v}${suffix || ""}`;

    doc.rect(0, 0, PW, 78).fill(INK);
    doc.font("Helvetica").fontSize(9).fillColor("#c9a84c").text(displayNameCase(org.name || ""), 50, 24);
    doc.font("Helvetica-Bold").fontSize(19).fillColor("#f0ede6").text(board.question, 50, 40, { width: PW - 100 });

    let y = 96;
    // FIX-2 A — THE ANSWER, printed as the screen says it.
    if (board.answer && board.answer.text) {
      doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(board.answer.text, 50, y, { width: PW - 100 });
      y = doc.y + 8;
    }
    doc.font("Helvetica").fontSize(9).fillColor(GREY)
      .text(`As of ${DD.displayDate(board.asOf)} · ${board.fiscalYear.fyLabel || `${DD.displayDate(board.fiscalYear.start)} to ${DD.displayDate(board.fiscalYear.end)}`}`, 50, y);   // POLISH-7
    y = doc.y + 14;

    const notes = [];
    for (const m of board.metrics) {
      notes.push(`${m.label}. ${m.definition}`);
      if (m.kind === "series") {
        const pts = Array.isArray(m.value) ? m.value : [];
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(m.label, 50, y); y = doc.y + 4;
        for (const p of pts) {
          if (y > doc.page.height - 120) { doc.addPage(); y = 60; }
          doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(DD.displayMonth(p.month), 58, y, { width: 120 });
          doc.font("Helvetica").fillColor(EMERALD).text(p.thisYear ? `${fmtMoney(p.thisYear.value)} this year` : "", 180, y, { width: 170, align: "right" });
          doc.font("Helvetica").fillColor(GREY).text(p.lastYear ? `${fmtMoney(p.lastYear.value)} last year` : "", 360, y, { width: PW - 410, align: "right" });
          y = Math.max(doc.y, y + 13);
          // PARITY-1 Part C — a series with a third year prints it on its own line.
          if (p.yearBefore) {
            doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text(`${fmtMoney(p.yearBefore.value)} the year before`, 360, y, { width: PW - 410, align: "right" });
            y = Math.max(doc.y, y + 13);
          }
        }
        y += 10;
      } else if (m.kind === "breakdown") {
        const rows = Array.isArray(m.value) ? m.value : [];
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(m.label, 50, y); y = doc.y + 4;
        if (!rows.length) { doc.font("Helvetica").fontSize(9).fillColor(GREY).text("Nothing here yet.", 50, y); y = doc.y + 12; continue; }
        for (const r of rows) {
          if (y > doc.page.height - 120) { doc.addPage(); y = 60; }
          const label = `${r.group ? "" : "   "}${r.label}${r.whenLabel ? " · due " + r.whenLabel : ""}`;
          doc.font(r.group ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(INK).text(label, 58, y, { width: PW - 220 });
          const kind = r.kind || (m.rowsAre === "money" || r.money ? "money" : "count");
          const goal = (r.also || []).find(a => a.key === "goal"), pct = (r.also || []).find(a => a.key === "percent");
          const cnt = (r.also || []).find(a => a.key === "count");
          const right = goal ? `${fmtMoney(r.value)} of ${fmtMoney(goal.value)}${pct && pct.value != null ? ` · ${pct.value}%` : ""}`
            : cnt ? `${fmtFigure(kind, r.value, r.suffix)} · ${cnt.value} ${cnt.value === 1 ? "person" : "people"}`
            : fmtFigure(kind, r.value, r.suffix);
          doc.font("Helvetica-Bold").fillColor(EMERALD).text(right, PW - 210, y, { width: 160, align: "right" });
          y = Math.max(doc.y, y + 13);
        }
        y += 10;
      } else {
        if (y > doc.page.height - 140) { doc.addPage(); y = 60; }
        // A BLANK IS PRINTED AS A BLANK, with the sentence saying when.
        doc.font("Helvetica").fontSize(9).fillColor(GREY).text(m.label, 50, y, { width: 260 });
        doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(fmtFigure(m.kind, m.value), 320, y - 2, { width: PW - 370, align: "right" });
        y += 20;
        if (m.value == null && m.blank) {
          doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(m.blank, 58, y - 4, { width: PW - 110 });
          y = doc.y + 8;
        }
      }
    }

    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text("What each number means", 50, 60);
    let ny = 82;
    for (const p of (board.answer?.parts || [])) if (p.figure && p.figure.definition) notes.unshift(`${p.figure.label}. ${p.figure.definition}`);
    for (const n of notes) {
      if (ny > doc.page.height - 90) { doc.addPage(); ny = 60; }
      doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(n, 50, ny, { width: PW - 100, lineGap: 1.5 });
      ny = doc.y + 8;
    }
    doc.end();
  });
}

app.get("/dashboards/:key/pdf", requireAuth, wrap(async (req, res) => {
  const org = await orgRow(req.user.orgId);
  const board = await computeDashboard(req.user.orgId, String(req.params.key),
    { isTeam: orgPlanTier(org) === "team" });
  if (!board) return res.status(404).json({ error: "Unknown dashboard" });
  const pdf = await renderDashboardPdf(board, org);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${board.key}-${board.asOf}.pdf"`);
  res.setHeader("Content-Length", pdf.length);
  res.end(pdf);
}));

// The registry itself, so the client's rail is the server's list and cannot
// drift from it.
app.get("/dashboards", requireAuth, wrap(async (req, res) => {
  const D = await dashboardsMod();
  res.json({ dashboards: D.DASHBOARDS.map(d => ({ key: d.key, label: d.label, question: d.question, blurb: d.blurb })) });
}));

// THE TILE CATALOGUE — what she can put on a dashboard, built from the
// registries that already exist rather than a list typed beside them: every
// figure source, the one chart, and every standard and saved report. A source
// added to figureSources.js appears here without this route being touched,
// which is the same reason the Reports rail is filled from the server.
app.get("/dashboard-tiles", requireAuth, wrap(async (req, res) => {
  await RB_READY;
  const B = await BP_READY;
  const figures = Object.entries(figureSources.SOURCES)
    // A source that needs a particular record (one donor, one grant, one
    // campaign) is not a dashboard tile: a dashboard is about the
    // organisation, and a tile that demanded an id would have nothing to put
    // in it.
    .filter(([, d]) => !Object.entries(d.params || {}).some(([k, spec]) =>
      spec.endsWith(":required") && !["from", "to"].includes(k)))
    .map(([key, d]) => ({ key, label: d.label,
      filters: ["fund", "campaign", "owner"].filter(f => (d.params || {})[B.FILTER_PARAM[f]]),
      period: !!(d.params || {}).from }));
  const saved = await query(
    "SELECT id, name FROM saved_reports WHERE org_id=? AND (shared = true OR owner_id = ?) ORDER BY name",
    [req.user.orgId, req.user.userId]);
  res.json({
    figures,
    charts: B.CHART_KEYS.map(k => ({ key: k, label: "Giving this year against last year" })),
    reports: [...RB.STANDARD_REPORTS.map(r => ({ id: "std:" + r.key, name: r.name })),
              ...saved.map(r => ({ id: r.id, name: r.name }))],
    filterKeys: B.FILTER_KEYS, maxTiles: B.MAX_TILES,
  });
}));

app.get("/saved-dashboards", requireAuth, wrap(async (req, res) => {
  const mine = await query(
    `SELECT id, name, shared, owner_id, owner_name, updated_at, tiles FROM saved_dashboards
      WHERE org_id=? AND (shared = true OR owner_id = ?) ORDER BY name`, [req.user.orgId, req.user.userId]);
  res.json({ dashboards: mine.map(r => ({ id: r.id, name: r.name, shared: r.shared, mine: r.owner_id === req.user.userId,
    ownerName: r.owner_name, tileCount: asJson(r.tiles, []).length, updatedAt: r.updated_at })) });
}));

app.post("/saved-dashboards", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const B = await BP_READY;
  const v = B.validateDashboard(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" "), errors: v.errors });
  const [u] = await query("SELECT name FROM users WHERE id=?", [req.user.userId]);
  const id = newId("dash");
  await run(`INSERT INTO saved_dashboards (id,org_id,name,tiles,filters,shared,owner_id,owner_name,created_by,created_by_name)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, req.user.orgId, v.value.name, JSON.stringify(v.value.tiles), JSON.stringify(v.value.filters),
     v.value.shared, req.user.userId, u ? u.name : null, actor(req).id, actor(req).name]);
  res.status(201).json({ id });
}));

app.put("/saved-dashboards/:id", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const B = await BP_READY;
  const [r] = await query("SELECT * FROM saved_dashboards WHERE id=? AND org_id=? AND owner_id=?",
    [req.params.id, req.user.orgId, req.user.userId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  const v = B.validateDashboard({ name: req.body && req.body.name !== undefined ? req.body.name : r.name,
    tiles: req.body && req.body.tiles !== undefined ? req.body.tiles : asJson(r.tiles, []),
    filters: req.body && req.body.filters !== undefined ? req.body.filters : asJson(r.filters, {}),
    shared: typeof (req.body || {}).shared === "boolean" ? req.body.shared : r.shared });
  if (!v.ok) return res.status(400).json({ error: v.errors.join(" "), errors: v.errors });
  await run(`UPDATE saved_dashboards SET name=?, tiles=?, filters=?, shared=?, updated_at=NOW() WHERE id=? AND org_id=?`,
    [v.value.name, JSON.stringify(v.value.tiles), JSON.stringify(v.value.filters), v.value.shared, r.id, req.user.orgId]);
  res.json({ ok: true });
}));

app.delete("/saved-dashboards/:id", requireAuth, wrap(async (req, res) => {
  const [mine] = await query("SELECT id FROM saved_dashboards WHERE id=? AND org_id=? AND owner_id=?",
    [req.params.id, req.user.orgId, req.user.userId]);
  if (!mine) return res.status(404).json({ error: "Not found" });
  const undoId = await trashRow("saved_dashboards", req.params.id, req);
  if (!undoId) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, deleted: 1, undoId, undoSeconds: UNDO_SECONDS });
}));

// Run one: the tiles with their values, each carrying the figure source it was
// computed from, so every number on the screen opens its rows.
app.get("/saved-dashboards/:id/run", requireAuth, wrap(async (req, res) => {
  const pack = await composeBoardPack(req.user.orgId, {
    dashboardId: req.params.id, userId: req.user.userId,
    from: req.query.from, to: req.query.to, fund: req.query.fund, campaign: req.query.campaign, owner: req.query.owner,
  });
  if (!pack) return res.status(404).json({ error: "Not found" });
  res.json(pack);
}));

// ── Board ──────────────────────────────────────────────────────────────────
app.get("/board", requireAuth, wrap(async (req, res) => {
  const members = await query("SELECT * FROM board_members WHERE org_id = ?", [req.user.orgId]);
  res.json(members.map(m => ({ ...m, committees: JSON.parse(m.committees || "[]") })));
}));

app.post("/board", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { name, role, employer, term, givingLevel, committees, attendance } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const id = newId("b");
  await run(
    "INSERT INTO board_members (id,org_id,name,role,employer,term,giving_level,committees,attendance,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, req.user.orgId, name, role || "Member", employer || "", term || "",
     givingLevel || "$0", JSON.stringify(committees || []), attendance ?? 100, actor(req).id, actor(req).name]
  );
  const rows = await query("SELECT * FROM board_members WHERE id = ?", [id]);
  res.status(201).json(rows[0]);
}));

// ── Dashboard ──────────────────────────────────────────────────────────────
// GET /donors (the list route App.jsx's loadData() uses) never embeds
// interactions — only GET /donors/:id does, joined lazily when a profile
// opens. adaptData() hardcodes donors[].interactions to [], so the
// Dashboard's Recent Activity feed had no real data source. This gives it
// one directly, org-wide, instead of relying on the per-donor shape.
// (route deleted, BUILD-75 B.4 — zero references anywhere: client, tests, scripts, docs. See audit/BUILD-75-FINDINGS.md B.1 orphan verdicts.)

app.get("/dashboard/my-stats", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const now = new Date();
  const fyStart = orgFiscalYearStart(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  // FIX-14 Part 1 — the org's civil today (this was the UTC date), and Visits
  // YTD is the one meetings source (meetings.js) for this staff member.
  const today = orgToday(await orgTz(orgId));                // ORG_TZ_SEAM_OK

  const [portfolioRows, visitsRows, movesRows, giftsRows, pipelineRows, lapsedRows, orgInteractionRows, orgGiftHistoryRows] = await Promise.all([
    query("SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND assigned_to=? AND deleted_at IS NULL", [orgId, userId]),
    figureSources.figureValue(orgId, { key: "meetings", params: { from: fyStart, to: today, staff: userId } }, {}).then(f => [{ cnt: f.value || 0 }]),
    // "Moves Made" = every meaningful-contact interaction (call/meeting/
    // email/stewardship — the same MEANINGFUL_CONTACT_TYPES used by
    // Stewardship Debt/First-Touch Delay), NOT literally every interactions
    // row with created_by=userId. Previously unfiltered by type, which
    // silently counted 'gift' rows (auto-logged by /donors/:id/gifts and the
    // bulk history importer) and 'stage_change' rows (auto-logged by a
    // Kanban drag) as if they were outreach — a bulk gift import or a stage
    // drag inflated a fundraiser's own activity count without them actually
    // contacting anyone. This makes Visits YTD a true subset of Moves Made
    // (meeting ⊂ meaningful contact) instead of two counts with an unclear
    // relationship, and lets GET /dashboard/my-stats/moves/breakdown below
    // return a list that actually matches what's being counted.
    query(`SELECT COUNT(*) as cnt FROM interactions WHERE org_id=? AND created_by=? AND type IN ${MEANINGFUL_CONTACT_TYPES} AND date>=?`, [orgId, userId, fyStart]),
    // NUMBERS-2: the drill-down's rows exactly (deleted people out, cents kept).
    // NUMBERS-3: this fiscal year TO TODAY, money only (shared/numbers/givingBetween.js).
    query(`SELECT COALESCE(SUM(g.amount),0)::text as total FROM gifts g JOIN donors d ON d.id=g.donor_id AND d.org_id=g.org_id WHERE g.org_id=? AND d.assigned_to=? AND d.deleted_at IS NULL AND ${NUMBERS.givingBetween.IN_SPAN("g")}`, [orgId, userId, fyStart, today]),
    query("SELECT COALESCE(SUM(total_giving),0) as total FROM donors WHERE org_id=? AND assigned_to=? AND stage NOT IN ('lapsed','closed') AND deleted_at IS NULL", [orgId, userId]),
    query("SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND assigned_to=? AND stage='lapsed' AND deleted_at IS NULL", [orgId, userId]),
    // Org-wide (not user-scoped) signals for the Home dashboard's empty-state
    // copy: distinguishes "you have real donor/gift history but genuinely
    // haven't logged any outreach yet" (show explanatory first-run copy)
    // from "this org has no donors at all" (a different, existing empty state).
    // Deliberately scoped to MEANINGFUL_CONTACT_TYPES, not any interaction row:
    // a fresh onboarding import creates 'gift' interactions as a side effect
    // of recording each gift (see /donors/import-combined), which is real
    // data but not outreach — counting it here would hide the "log your
    // first call" prompt on Day 1 for every org that imported gift history.
    query(`SELECT COUNT(*) as cnt FROM interactions WHERE org_id=? AND type IN ${MEANINGFUL_CONTACT_TYPES}`, [orgId]),
    query("SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND deleted_at IS NULL AND gift_count>0", [orgId]),
  ]);

  res.json({
    portfolioCount: parseInt(portfolioRows[0]?.cnt || 0),
    visitsYtd: parseInt(visitsRows[0]?.cnt || 0),
    madeYtd: parseInt(movesRows[0]?.cnt || 0),
    giftsYtd: toDollars(toCents(giftsRows[0]?.total) || 0),
    // NUMBERS-2: the year these "YTD" figures cover, shown once on Home.
    yearLabel: NUMBERS.fiscalYear.period(await orgTz(orgId), "fiscal", 0).periodLabel,   // ORG_TZ_SEAM_OK
    pipelineValue: parseInt(pipelineRows[0]?.total || 0),
    lapsedCount: parseInt(lapsedRows[0]?.cnt || 0),
    orgHasInteractions: parseInt(orgInteractionRows[0]?.cnt || 0) > 0,
    orgHasGiftHistory: parseInt(orgGiftHistoryRows[0]?.cnt || 0) > 0,
  });
}));

// BUILD-16 Part 1 — the Home command center. Four headers a fundraiser opens
// the app to see: Portfolio [Team], Tasks [Core], Need to Do [Core], Pipeline
// [Team]. First-touch-delay / stewardship-debt are demoted to secondary chips
// (still served by /metrics/stewardship-summary), never headline cards. Plan-
// graceful: a Core org gets Tasks + a giving snapshot, no broken Team headers.
// The Need-to-do LIST itself is the existing /dashboard/today queue (the client
// already fetches it) — this endpoint returns the four headers' summary data.
app.get("/dashboard/home", requireAuth, OS.cached("dashboard-home"), wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const scope = req.query.scope === "all" ? "all" : "mine";
  // THE ORG'S CIVIL DATE, NOT THE UTC DAY. These four counts are Home's Today
  // rail. A UTC slice is already tomorrow from ~20:00 Eastern, so every task
  // due today moved into `overdue` and "due today" read 0 - every evening, on
  // the calmest screen in the product, with nothing having changed but the
  // clock. Same seam the gift paths have used since BUILD-75.
  const today = orgToday(await orgTz(orgId));           // ORG_TZ_SEAM_OK

  const orgRows = await query("SELECT plan, subscription_status FROM orgs WHERE id=?", [orgId]);
  const tier = orgRows.length ? orgPlanTier(orgRows[0]) : "core";

  // BUILD-54 §1 — everything after the tier probe is independent: one
  // parallel batch instead of ~7 sequential round trips. The team-only
  // queries only join the batch on team tier (results unchanged).
  const taskScope = scope === "mine" ? "AND assigned_to=?" : "";
  const mMine = tier === "team" ? portfolioMembership({ orgId, userId, scope: "mine", alias: "" }) : null;
  const mScope = tier === "team" ? portfolioMembership({ orgId, userId, scope, alias: "" }) : null;
  const owner = scope === "mine" ? "assigned_to = ?" : "assigned_to IS NOT NULL";
  const oppParams = scope === "mine" ? [orgId, orgId, userId] : [orgId, orgId];
  const nullQ = Promise.resolve(null);
  const [distinctOfficers, taskRows, pRows, cRows, totRows, stageRows, oppRows] = await Promise.all([
    // BUILD-32 Part 4 — the Home "My donors / Whole org" scope toggle is a
    // single-value picker unless 2+ officers actually have assigned donors.
    query(
      `SELECT COUNT(DISTINCT assigned_to)::int AS c FROM donors
         WHERE org_id=? AND assigned_to IS NOT NULL AND deleted_at IS NULL`, [orgId]),
    // Tasks buckets [Core] — open tasks, scoped to the user (mine) or org (all).
    query(
      `SELECT
         COUNT(*) FILTER (WHERE due <> '' AND due IS NOT NULL AND due < ?) AS overdue,
         COUNT(*) FILTER (WHERE due <> '' AND due IS NOT NULL AND left(due,10) = ?) AS today,
         COUNT(*) FILTER (WHERE due <> '' AND due IS NOT NULL AND due > ? AND left(due,10) <> ?) AS upcoming,
         COUNT(*) FILTER (WHERE due = '' OR due IS NULL) AS no_date,
         COUNT(*) AS total
       FROM tasks WHERE org_id=? AND done=0 AND voided_at IS NULL ${taskScope}`,
      scope === "mine" ? [today, today, today, today, orgId, userId] : [today, today, today, today, orgId]),
    mMine ? query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_giving),0) AS val FROM donors WHERE ${mMine.where}`, mMine.params) : nullQ,
    mMine ? query("SELECT portfolio_color FROM users WHERE id=? AND org_id=?", [userId, orgId]) : nullQ,
    mScope ? query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_giving),0) AS val FROM donors WHERE ${mScope.where}`, mScope.params) : nullQ,
    mScope ? query(`SELECT stage, COUNT(*) AS cnt, COALESCE(SUM(total_giving),0) AS val
             FROM donors WHERE ${mScope.where} GROUP BY stage`, mScope.params) : nullQ,
    mScope ? query(
      `SELECT COALESCE(SUM(target_amount),0) AS ask, COUNT(*) AS cnt
         FROM opportunities WHERE org_id=? AND status='open'
           AND donor_id IN (SELECT id FROM donors WHERE org_id=? AND deleted_at IS NULL AND ${owner})`, oppParams) : nullQ,
  ]);
  const multiOfficer = (distinctOfficers[0]?.c || 0) >= 2;
  const tRow = taskRows[0] || {};
  const tasks = {
    overdue: parseInt(tRow.overdue, 10) || 0,
    today: parseInt(tRow.today, 10) || 0,
    upcoming: parseInt(tRow.upcoming, 10) || 0,
    noDate: parseInt(tRow.no_date, 10) || 0,
    total: parseInt(tRow.total, 10) || 0,
  };

  // Portfolio [Team] — the officer's assigned constituents + their lifetime
  // value + the officer's color. Null on Core (the header is hidden).
  let portfolio = null;
  if (tier === "team") {
    portfolio = {
      count: parseInt(pRows[0]?.cnt, 10) || 0,
      value: parseFloat(pRows[0]?.val) || 0,
      color: cRows[0]?.portfolio_color || null,
    };
  }

  // Pipeline [Team] — SAME membership as the board + Portfolio card (the ONE
  // definition via portfolioMembership), broken out per stage for the compact
  // summary. total/value are computed over the whole portfolio so they equal the
  // Portfolio card and the board exactly; the per-stage rows are the display
  // breakdown. The open-ask forecast is scoped to the SAME portfolio donors the
  // board sums, so Home's forecast and the board's asks agree. Null on Core.
  let pipeline = null;
  if (tier === "team") {
    const byStage = Object.fromEntries(stageRows.map(r => [r.stage, r]));
    const stages = ALL_PIPELINE_STAGES.map(s => ({
      stage: s,
      count: parseInt(byStage[s]?.cnt, 10) || 0,
      value: parseFloat(byStage[s]?.val) || 0,
    }));
    pipeline = {
      total: parseInt(totRows[0]?.cnt, 10) || 0,
      value: parseFloat(totRows[0]?.val) || 0,
      stages,
      forecastOpen: Math.round(parseFloat(oppRows[0]?.ask) || 0),
      openOppCount: parseInt(oppRows[0]?.cnt, 10) || 0,
    };
  }

  // ── BUILD-88b B.2 — LATE PLEDGE INSTALMENTS, for the morning sentence ────
  // A pledge somebody signed and then stopped paying is the quietest kind of
  // bad news: nothing fails, nothing bounces, and the money simply never
  // arrives. A SHELL pledge (BUILD-88a A.7, inferred from payments) is never
  // counted late — it has no schedule anybody wrote down, so it is unfinished
  // rather than overdue, and it is reported separately so it can be finished.
  const orgForPledges = await orgTz(orgId);
  const pledgeToday = orgToday(orgForPledges);                     // ORG_TZ_SEAM_OK
  const { PLEDGE_LATE_DAYS } = await import("../../shared/draftNote.js");
  const [lateRow] = await query(
    `SELECT COUNT(*)::int AS late FROM pledge_installments i
       JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id
       JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
      WHERE i.org_id=? AND i.paid_gift_id IS NULL AND i.due_date <= ?
        AND p.status='open' AND COALESCE(p.is_shell,false) = false AND COALESCE(p.is_match,false) = false
        AND d.deleted_at IS NULL AND d.is_sample IS NOT TRUE`,
    [orgId, orgTime.addDays(pledgeToday, -PLEDGE_LATE_DAYS)]);
  const [shellRow] = await query(
    `SELECT COUNT(*)::int AS n FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
      WHERE p.org_id=? AND p.status='open' AND d.deleted_at IS NULL
        AND (COALESCE(p.is_shell,false) = true
             OR NOT EXISTS (SELECT 1 FROM pledge_installments i WHERE i.pledge_id = p.id))`,
    [orgId]);

  // BUILD-101 Part 2 — memberships that expire this calendar month and are
  // still held. Home says it in one line, and only when it is not zero.
  const monthStart = pledgeToday.slice(0, 7) + "-01", monthEnd = pledgeToday.slice(0, 7) + "-31";
  const [expRow] = await query(
    `SELECT COUNT(*)::int AS n FROM memberships m JOIN donors d ON d.id=m.donor_id AND d.org_id=m.org_id
      WHERE m.org_id=? AND m.status IN ('active','grace') AND m.expires_on BETWEEN ? AND ? AND d.deleted_at IS NULL`,
    [orgId, monthStart, monthEnd]);
  // BUILD-100 (grants) Part 7 — grant deadlines inside Home's window, counted
  // through grantMilestones' ONE window so this and the Deadlines screen's line
  // cannot disagree. Open milestones only; a sample grant never counts.
  const GM = await grantMsMod();
  const openMs = await query(
    `SELECT m.due_date FROM grant_milestones m JOIN grants g ON g.id=m.grant_id AND g.org_id=m.org_id
      WHERE m.org_id=? AND m.state NOT IN ('done','skipped') AND g.is_sample IS NOT TRUE`, [orgId]);
  const grantDeadlinesSoon = GM.deadlinesInWindow(openMs.map(r => ({ dueDate: r.due_date })), pledgeToday).length;
  res.json({ tier, scope, portfolio, tasks, pipeline, multiOfficer, today: pledgeToday,
             latePledgeInstallments: lateRow?.late || 0,
             membershipsExpiringThisMonth: expRow?.n || 0,
             grantDeadlinesSoon, grantDeadlineWindowDays: GM.HOME_WINDOW_DAYS,
             pledgesNeedingSchedule: shellRow?.n || 0 });
}));

// Per-stat drill-downs behind the My Portfolio bar. Each mirrors the exact
// filter its headline count above uses (same fyStart boundary, same type
// filters), so the number shown and the list you get from clicking it can
// never disagree. Rows are shaped for MetricBreakdownPanel — visits/moves/
// gifts are one row per logged event (a donor can appear more than once, so
// each row carries its own `id`), pipeline/lapsed are one row per donor.
app.get("/dashboard/my-stats/visits/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  const now = new Date();
  const fyStart = orgFiscalYearStart(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const PAGE_SIZE = 50;
  // FIX-14 Part 1 — the same source as the count on Home (meetings.js).
  const f = await figureSources.figure(orgId, { key: "meetings", params: { from: fyStart, to: orgToday(await orgTz(orgId)), staff: userId } }, {}, { pageSize: PAGE_SIZE });   // ORG_TZ_SEAM_OK
  const { displayDateShort } = await import("../../shared/displayDate.js");
  const names = Object.fromEntries((await query("SELECT id, name FROM donors WHERE org_id=? AND id = ANY(?)",
    [orgId, [...new Set((f.rows || []).map(r => r.donorId || r.donor_id).filter(Boolean))]])).map(r => [r.id, r.name]));
  res.json({
    count: f.totalRows || 0,
    rows: (f.rows || []).map(r => ({
      id: r.id, donorId: r.donorId || r.donor_id, donorName: names[r.donorId || r.donor_id] || "",
      detail: r.type === "meeting" ? "Meeting from a calendar" : "Meeting logged",
      value: displayDateShort(r.date, r.date),
    })),
  });
}));

app.get("/dashboard/my-stats/moves/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // fyStart mirrors /dashboard/my-stats exactly: July 1 fiscal year boundary.
  const now = new Date();
  const fyStart = orgFiscalYearStart(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const PAGE_SIZE = 50;
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT i.id, i.donor_id, d.name AS donor_name, i.date, i.type FROM interactions i
       JOIN donors d ON d.id = i.donor_id
       WHERE i.org_id=? AND i.created_by=? AND i.type IN ${MEANINGFUL_CONTACT_TYPES} AND i.date>=? AND d.deleted_at IS NULL
       ORDER BY i.date DESC NULLS LAST LIMIT ?`,
      [orgId, userId, fyStart, PAGE_SIZE]
    ),
    query(
      `SELECT COUNT(*) as cnt FROM interactions i JOIN donors d ON d.id=i.donor_id
       WHERE i.org_id=? AND i.created_by=? AND i.type IN ${MEANINGFUL_CONTACT_TYPES} AND i.date>=? AND d.deleted_at IS NULL`,
      [orgId, userId, fyStart]
    ),
  ]);
  const TYPE_LABEL = { call: "Call", meeting: "Meeting", email: "Email", stewardship: "Stewardship" };
  res.json({
    count: parseInt(countRow[0]?.cnt || 0),
    rows: rows.map(r => ({
      id: r.id, donorId: r.donor_id, donorName: r.donor_name,
      detail: TYPE_LABEL[r.type] || r.type,
      value: orgTime.civilLocale(r.date, { month: "short", day: "numeric" }),
    })),
  });
}));

app.get("/dashboard/my-stats/gifts/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  // fyStart mirrors /dashboard/my-stats exactly: this fiscal year to today,
  // money only (NUMBERS-3, shared/numbers/givingBetween.js).
  const now = new Date();
  const fyStart = orgFiscalYearStart(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  const today = orgToday(await orgTz(orgId));                // ORG_TZ_SEAM_OK
  const PAGE_SIZE = 50;
  const [rows, totalRow] = await Promise.all([
    query(
      `SELECT g.id, g.donor_id, d.name AS donor_name, g.date, g.amount FROM gifts g
       JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
       WHERE g.org_id=? AND d.assigned_to=? AND ${NUMBERS.givingBetween.IN_SPAN("g")} AND d.deleted_at IS NULL
       ORDER BY g.amount DESC LIMIT ?`,
      [orgId, userId, fyStart, today, PAGE_SIZE]
    ),
    query(
      `SELECT COALESCE(SUM(g.amount),0) as total, COUNT(*) as cnt FROM gifts g
       JOIN donors d ON d.id=g.donor_id AND d.org_id = g.org_id
       WHERE g.org_id=? AND d.assigned_to=? AND ${NUMBERS.givingBetween.IN_SPAN("g")} AND d.deleted_at IS NULL`,
      [orgId, userId, fyStart, today]
    ),
  ]);
  res.json({
    // BUILD-73 Part 2 — was Math.round(): a drill-down total is money, and
    // rounding it here made the panel disagree with the ledger it drills into.
    total: toDollars(toCents(totalRow[0]?.total) || 0),
    count: parseInt(totalRow[0]?.cnt || 0),
    rows: rows.map(r => ({
      id: r.id, donorId: r.donor_id, donorName: r.donor_name,
      detail: orgTime.civilLocale(r.date, { month: "short", day: "numeric", year: "numeric" }),
      value: "$" + Number(r.amount).toLocaleString(),
    })),
  });
}));

app.get("/dashboard/my-stats/pipeline/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const [rows, totalRow] = await Promise.all([
    query(
      `SELECT id, name, stage, total_giving FROM donors
       WHERE org_id=? AND assigned_to=? AND stage NOT IN ('lapsed','closed') AND deleted_at IS NULL
       ORDER BY total_giving DESC LIMIT ?`,
      [orgId, userId, PAGE_SIZE]
    ),
    query(
      `SELECT COALESCE(SUM(total_giving),0) as total, COUNT(*) as cnt FROM donors
       WHERE org_id=? AND assigned_to=? AND stage NOT IN ('lapsed','closed') AND deleted_at IS NULL`,
      [orgId, userId]
    ),
  ]);
  res.json({
    // BUILD-73 Part 2 — was Math.round(); see the sibling drill-down above.
    total: toDollars(toCents(totalRow[0]?.total) || 0),
    count: parseInt(totalRow[0]?.cnt || 0),
    rows: rows.map(d => ({
      donorId: d.id, donorName: d.name,
      detail: d.stage ? d.stage[0].toUpperCase() + d.stage.slice(1) : "",
      value: "$" + Number(d.total_giving || 0).toLocaleString(),
    })),
  });
}));

app.get("/dashboard/my-stats/lapsed/breakdown", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT id, name, total_giving, last_gift_date FROM donors
       WHERE org_id=? AND assigned_to=? AND stage='lapsed' AND deleted_at IS NULL
       ORDER BY total_giving DESC LIMIT ?`,
      [orgId, userId, PAGE_SIZE]
    ),
    query(
      "SELECT COUNT(*) as cnt FROM donors WHERE org_id=? AND assigned_to=? AND stage='lapsed' AND deleted_at IS NULL",
      [orgId, userId]
    ),
  ]);
  res.json({
    count: parseInt(countRow[0]?.cnt || 0),
    rows: rows.map(d => ({
      donorId: d.id, donorName: d.name,
      detail: d.last_gift_date ? `Last gave ${orgTime.civilLocale(d.last_gift_date, { month: "short", day: "numeric", year: "numeric" })}` : "No gift date on file",
      value: "$" + Number(d.total_giving || 0).toLocaleString(),
    })),
  });
}));

app.get("/dashboard/today", requireAuth, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const today = new Date();
  // BUILD-72 Part 4 — the day view is the screen Part 0 captured going wrong:
  // `todayStr` was a UTC calendar date, so at 20:00 EDT it rolled over and a
  // task due today began reading "1 day overdue" with nothing changing but the
  // clock. It is now the civil date IN THE ORG'S TIMEZONE, and every window
  // below is derived from it by calendar arithmetic. ORG_TZ_SEAM_OK
  const org = await orgTz(orgId);
  const todayStr = orgToday(org, today);
  const ninetyDaysAgo = orgTime.addDays(todayStr, -90);
  const items = [];

  // Ownership scoping — defaults to "this is MY job today" (the logged-in
  // user's own assigned donors), matching the existing assigned_to pattern
  // already used by GET /donors/my and /dashboard/my-stats. ?scope=all opts
  // into the previous org-wide behavior for anyone who legitimately needs
  // it (admins/directors) — additive, not a removal of that capability.
  // Every donor-touching bucket below applies the same `scopeClause`/
  // `scopeParams` fragment so the whole unified queue honors one rule.
  const scope = req.query.scope === "all" ? "all" : "mine";
  const scopeClause = scope === "mine" ? "AND d.assigned_to = ?" : "";
  const scopeParams = scope === "mine" ? [userId] : [];
  // Each bucket below can produce a reason for a donor another bucket
  // already claimed. The queue is meant to be one ranked, unified list, so
  // the higher-priority reason should always win regardless of which
  // bucket happened to run first — not whichever bucket got there first.
  const upsertItem = item => {
    const existingIdx = items.findIndex(i => i.donorId === item.donorId);
    if (existingIdx === -1) items.push(item);
    else if (items[existingIdx].priority < item.priority) items[existingIdx] = item;
  };

  // ── BUILD-54 §1 — every bucket below is an independent read, so all of
  // them fire in ONE parallel batch. This endpoint was ~14 sequential
  // Railway↔Supabase round trips (~1.2s TTFB on a small org, the slowest
  // read in the product); the results are byte-identical because bucket
  // APPLICATION order below is unchanged — upsertItem's strict-< tie-break
  // depends on that order, so never reorder the for-loops. The two receipt
  // queries now always run (cheap LIMIT-5 reads) but still only APPLY when
  // the org has receipts enabled.
  const sixtyDaysAgo = orgTime.addDays(todayStr, -60);   // ORG_TZ_SEAM_OK
  const [
    orgReceiptRows, atRiskCandidates, noContact, lapsedDonorRows, unacked,
    needsReceipt, mismatched, dueTasks, milestoneRows, atRiskDraftRows,
    noteReminderRows, atRiskSubs, portalDrift, employerDonorRows,
  ] = await Promise.all([
    query("SELECT receipts_enabled FROM orgs WHERE id=?", [orgId]),
    // Single source of truth for "at risk" — shared with the 'at_risk'
    // auto-enroll trigger (see computeAtRiskCandidates/autoEnroll in
    // server.js) so this display flag and the real-time draft trigger can
    // never drift into two different definitions of the same thing.
    computeAtRiskCandidates(orgId),
    // Donors in active stages with no recent contact
    query(`
    SELECT d.id, d.name, d.total_giving, d.last_gift_date, d.last_gift_amount, d.stage,
           MAX(i.date) AS last_contact
    FROM donors d
    -- SCALE-2: "i.org_id = d.org_id" is the tenant rule (a person's
    -- conversations are in the person's org). Without it this read every
    -- org's interactions, 2.6M rows on the load database: 560 ms -> 67 ms.
    LEFT JOIN interactions i ON i.donor_id = d.id AND i.org_id = d.org_id AND i.type <> ALL(?::text[])
    WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.stage NOT IN ('prospect','lapsed')
      AND ${solicitableSql("d")} AND ${donorOnly("d")} AND ${namedOrGivingSql("d")} ${scopeClause}
    GROUP BY d.id, d.name, d.total_giving, d.last_gift_date, d.last_gift_amount, d.stage
    -- IMPORT-2: NO HISTORY YET IS NOT COLD. A person with no conversation on
    -- file at all is somebody Steward knows nothing about, not somebody gone
    -- quiet; a gift line is not a conversation. Only a real last contact older
    -- than ninety days puts somebody here.
    HAVING MAX(i.date) < ?
    ORDER BY COALESCE(d.total_giving, 0) DESC
    LIMIT 20
  `, [NOT_HISTORY_TYPES, orgId, ...scopeParams, ninetyDaysAgo]),
    // Lapsed donors
    query(`
    SELECT id, name, total_giving, last_gift_date
    FROM donors d
    WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.stage = 'lapsed'
      AND ${solicitableSql("d")} AND ${donorOnly("d")}
      AND d.imported_sustainer IS NOT TRUE ${scopeClause}
    ORDER BY total_giving DESC
    LIMIT 5
  `, [orgId, ...scopeParams]),
    // Unacknowledged recent gifts (need a thank-you)
    query(`
    SELECT g.id AS gift_id, g.amount, g.date, d.id AS donor_id, d.name AS donor_name, d.total_giving
    FROM gifts g
    -- SCALE-2: "g.org_id = d.org_id" is the tenant rule (a gift's donor is in
    -- the gift's org); it lets the planner read this org's recent gifts by
    -- (org_id, date) instead of probing every donor: 43 ms -> 10 ms at 25k.
    JOIN donors d ON d.id = g.donor_id AND g.org_id = d.org_id
    WHERE d.org_id = ? AND d.deleted_at IS NULL
      AND (g.acknowledgement_sent = false OR g.acknowledgement_sent IS NULL)
      AND d.deceased IS NOT TRUE
      AND g.date >= ? ${scopeClause}
    ORDER BY g.amount DESC
    LIMIT 5
  `, [orgId, ninetyDaysAgo, ...scopeParams]),
    // Tax receipts — $250+ gifts with no acknowledgment (applied only when
    // the org has receipts enabled)
    query(`
      SELECT g.id AS gift_id, g.amount, g.date, d.id AS donor_id, d.name AS donor_name, d.total_giving
      FROM gifts g
      JOIN donors d ON d.id = g.donor_id AND g.org_id = d.org_id   -- SCALE-2: the tenant rule, as above
      WHERE d.org_id = ? AND d.deleted_at IS NULL
        AND g.amount >= 250
        AND (g.acknowledgement_sent = false OR g.acknowledgement_sent IS NULL)
        AND (g.is_sample IS NOT TRUE)
        AND d.deceased IS NOT TRUE
        AND g.date >= ? ${scopeClause}
      ORDER BY g.amount DESC
      LIMIT 5
    `, [orgId, sixtyDaysAgo, ...scopeParams]),
    // Receipt/gift mismatch (applied only when receipts enabled)
    query(`
      SELECT r.id AS receipt_id, r.receipt_number, r.amount AS receipt_amount,
             g.amount AS gift_amount, d.id AS donor_id, d.name AS donor_name, d.total_giving
      FROM receipts r
      LEFT JOIN gifts g ON g.id = r.gift_id
      JOIN donors d ON d.id = r.donor_id
      WHERE r.org_id = ? AND d.deleted_at IS NULL AND r.type = 'gift' AND r.voided_at IS NULL
        AND (g.id IS NULL OR r.amount != g.amount OR (r.snapshot->>'giftDateRaw') != g.date)
        ${scopeClause}
      LIMIT 5
    `, [orgId, ...scopeParams]),
    // Overdue donor-linked tasks
    query(`
    SELECT t.id, t.title, t.due, t.priority AS task_priority, t.type AS task_type, t.donor_id, d.name AS donor_name, d.total_giving
    FROM tasks t
    JOIN donors d ON d.id = t.donor_id
    WHERE t.org_id = ? AND d.deleted_at IS NULL AND done=0 AND t.voided_at IS NULL AND t.due <= ? ${scopeClause}
      AND COALESCE(t.link_kind, '') <> 'next_step'   -- FIX-31: a next step is already in this queue as its thread
    ORDER BY t.due ASC
    LIMIT 5
  `, [orgId, todayStr, ...scopeParams]),
    // Milestone-ready donors — pending AI-drafted stewardship emails
    query(`
    SELECT md.id AS draft_id, md.donor_id, md.subject, md.created_at, d.name AS donor_name, d.total_giving
    FROM milestone_drafts md
    JOIN donors d ON d.id = md.donor_id
    WHERE md.org_id = ? AND d.deleted_at IS NULL AND md.status = 'pending_review' ${scopeClause}
    ORDER BY md.created_at DESC
    LIMIT 5
  `, [orgId, ...scopeParams]),
    // At-risk re-engagement drafts
    query(`
    SELECT md.id AS draft_id, md.donor_id, d.name AS donor_name, d.total_giving
    FROM milestone_drafts md
    JOIN donors d ON d.id = md.donor_id
    WHERE md.org_id = ? AND d.deleted_at IS NULL AND md.status = 'pending_review' AND md.milestone_key = 'at_risk' ${scopeClause}
    ORDER BY md.created_at DESC
    LIMIT 10
  `, [orgId, ...scopeParams]),
    // Personal-note reminders
    query(`
    SELECT nr.id AS reminder_id, nr.donor_id, nr.talking_points, nr.created_at, d.name AS donor_name, d.total_giving
    FROM note_reminders nr
    JOIN donors d ON d.id = nr.donor_id
    WHERE nr.org_id = ? AND d.deleted_at IS NULL AND nr.status = 'pending' ${scopeClause}
    ORDER BY nr.created_at DESC
    LIMIT 5
  `, [orgId, ...scopeParams]),
    // At-risk recurring gifts — failed/retrying donor subscriptions
    query(`
    SELECT rs.donor_id, rs.stripe_subscription_id, rs.amount, rs.interval, d.name AS donor_name, d.total_giving
    FROM recurring_subscriptions rs
    JOIN donors d ON d.id = rs.donor_id
    WHERE rs.org_id = ? AND d.deleted_at IS NULL AND rs.status IN ('past_due','recovering') ${scopeClause}
    ORDER BY rs.amount DESC NULLS LAST
    LIMIT 5
  `, [orgId, ...scopeParams]),
    // BUILD-45 §6.3 drift wire — portal cancel/pause in the last 7 days
    query(`
    SELECT DISTINCT ON (pal.donor_id) pal.donor_id, pal.action, pal.created_at,
           d.name AS donor_name, d.total_giving,
           rs.amount, rs.interval
    FROM portal_audit_log pal
    JOIN donors d ON d.id = pal.donor_id AND d.org_id = pal.org_id AND d.deleted_at IS NULL
    LEFT JOIN recurring_subscriptions rs ON rs.id = (pal.meta->>'subId') AND rs.org_id = pal.org_id
    WHERE pal.org_id = ? AND pal.action IN ('recurring_cancel','recurring_pause')
      AND pal.created_at > NOW() - INTERVAL '7 days' ${scopeClause}
    ORDER BY pal.donor_id, pal.created_at DESC
    LIMIT 5
  `, [orgId, ...scopeParams]).catch(() => []),
    // Matching-gift opportunities — recent donors with a known employer
    query(`
    SELECT d.id, d.name, d.employer, d.total_giving, d.last_gift_amount, d.last_gift_date
    FROM donors d
    WHERE d.org_id = ? AND d.deleted_at IS NULL AND d.employer IS NOT NULL AND d.employer <> ''
      AND ${solicitableSql("d")} AND ${donorOnly("d")} AND d.last_gift_date >= ? ${scopeClause}
    ORDER BY d.last_gift_date DESC NULLS LAST
    LIMIT 30
  `, [orgId, ninetyDaysAgo, ...scopeParams]),
  ]);
  const receiptsEnabled = !!orgReceiptRows[0]?.receipts_enabled;
  const atRiskDonorIds = new Set(atRiskCandidates.map(x => x.id));

  for (const d of noContact) {
    const daysSinceContact = d.last_contact
      ? Math.floor((today - new Date(d.last_contact)) / 86400000) : null;
    const daysSinceGift = d.last_gift_date
      ? Math.floor((today - new Date(d.last_gift_date)) / 86400000) : null;
    const totalGiving = parseFloat(d.total_giving) || 0;
    const lastAmt = parseFloat(d.last_gift_amount) || 0;

    const isLapsing = atRiskDonorIds.has(d.id);
    let reason, action;
    if (isLapsing) {
      reason = `Gave $${lastAmt.toLocaleString()}: last gift ${daysSinceGift} days ago, lapsing risk`;
      action = "call";
    } else if (daysSinceContact) {
      const prefix = totalGiving > 0 ? `Gave $${totalGiving.toLocaleString()} total · ` : "";
      reason = `${prefix}no contact in ${daysSinceContact} days`;
      action = totalGiving >= 5000 ? "call" : "email";
    } else {
      reason = d.stage === "qualify"
        ? "New prospect, no contact yet. First outreach sets the tone."
        : "In your portfolio, no outreach logged yet. Make a strong first impression.";
      action = "call";
    }

    const priority = Math.min(50, totalGiving / 5000)
      + (isLapsing ? 30 : 0)
      + (daysSinceContact && daysSinceContact > 180 ? 20 : 0);

    upsertItem({ donorId: d.id, donorName: d.name, reason, priority, action, totalGiving, isLapsing });
  }

  // Lapsed donors — explicitly excluded from the no-contact bucket above
  // (which only looks at active stages), but the queue is meant to unify
  // lapsed/no-contact/overdue-task/milestone in one ranked list, so they
  // need their own bucket rather than never appearing at all.
  for (const l of lapsedDonorRows) {
    const daysSince = l.last_gift_date ? Math.floor((today - new Date(l.last_gift_date)) / 86400000) : null;
    const totalGiving = parseFloat(l.total_giving) || 0;
    const lapsedItem = {
      donorId: l.id, donorName: l.name,
      reason: `Lapsed · ${daysSince != null ? `last gift ${daysSince} days ago` : "no gift on record"}${totalGiving > 0 ? `, $${totalGiving.toLocaleString()} lifetime value` : ""}`,
      priority: 60 + Math.min(20, totalGiving / 5000), action: "lapsed",
      totalGiving, isLapsing: true,
    };
    upsertItem(lapsedItem);
  }

  // Unacknowledged recent gifts (need a thank-you).
  // BUILD-80 Part 9 — the queue reads the LARGEST-GIFTS panel first: a
  // number that is 10% of the file in one row is a parse error until a
  // human says otherwise, and a $200,000 misparse must never LEAD the
  // thank-you queue. An unconfirmed largest-import gift becomes a
  // confirm-this-amount question, not a thank-you task.
  const { stats: impStats } = await importHealth(orgId);
  const { eitherContainsTokenRun } = await import("../../shared/importShape.js");
  const unconfirmedLargest = (impStats?.largestGifts || []).filter(g => !g.confirmed);
  for (const g of unacked) {
    const giftDate = orgTime.civilLocale(g.date, { month: "long", day: "numeric" });
    // BUILD-84 census — matching two donor NAMES respects token boundaries.
    // `g.donor_name.includes(x.name)` matched "Ann Lee" inside "Joann Leewood",
    // which here would put a confirm-this-amount flag on the wrong donor's
    // thank-you. `eitherContainsTokenRun` is the ONE boundary-aware test.
    const flagged = unconfirmedLargest.find(x => Number(x.dollars) === Number(g.amount) && x.name && g.donor_name
      && eitherContainsTokenRun(g.donor_name, x.name));
    if (flagged) {
      upsertItem({
        donorId: g.donor_id, donorName: g.donor_name,
        reason: `Imported gift of $${Number(g.amount).toLocaleString()} on ${giftDate}, one of the file's largest. Confirm the amount is real before thanking.`,
        priority: 90, action: "confirm-gift",
        totalGiving: parseFloat(g.total_giving) || 0,
        confirmGift: { name: flagged.name, dollars: flagged.dollars },
      });
      continue;
    }
    upsertItem({
      donorId: g.donor_id, donorName: g.donor_name,
      reason: `Gave $${Number(g.amount).toLocaleString()} on ${giftDate}: not yet thanked`,
      priority: 75, action: "thank",
      totalGiving: parseFloat(g.total_giving) || 0,
    });
  }

  // Tax receipts — $250+ gifts with no acknowledgment yet (see CLAUDE.md
  // "Tax receipting"), org has receipts enabled, gift within the last 60
  // days. Online gifts auto-receipt near-instantly via the webhook (which
  // sets acknowledgement_sent=true), so in practice this bucket only ever
  // surfaces offline/manually-entered gifts, which never auto-receipt.
  // Deliberately priority 76, not 75 — one point above the "not yet
  // thanked" bucket above, so a legally-required receipt wins the
  // upsertItem tie (strict `<` — equal priorities keep whichever bucket
  // ran first) when both could apply to the same offline gift.
  if (receiptsEnabled) {
    for (const g of needsReceipt) {
      const giftDate = orgTime.civilLocale(g.date, { month: "long", day: "numeric" });
      upsertItem({
        donorId: g.donor_id, donorName: g.donor_name,
        reason: `Gift of $${Number(g.amount).toLocaleString()} on ${giftDate} needs a tax receipt`,
        priority: 76, action: "receipt", giftId: g.gift_id,
        totalGiving: parseFloat(g.total_giving) || 0,
      });
    }

    // Receipt/gift mismatch — a gift was edited (amount or date) or
    // deleted after its receipt already issued. See PUT/DELETE /gifts/:id:
    // deliberately never auto-voided, staff reviews and voids+reissues on
    // purpose, since a receipt is a legal record of what was actually
    // sent — not something that should silently change to match an edit.
    // LEFT JOIN (not JOIN) so a deleted gift (g.id IS NULL) is caught too,
    // not just an amount/date edit on a gift that still exists.
    for (const m of mismatched) {
      const reason = m.gift_amount == null
        ? `Receipt #${m.receipt_number}: the gift it was issued for has been deleted, review`
        : `Receipt #${m.receipt_number} no longer matches its gift ($${Number(m.receipt_amount).toLocaleString()} receipted vs. $${Number(m.gift_amount).toLocaleString()} now on the gift), review`;
      upsertItem({
        donorId: m.donor_id, donorName: m.donor_name,
        reason, priority: 70, action: "receipt_mismatch", receiptId: m.receipt_id,
        totalGiving: parseFloat(m.total_giving) || 0,
      });
    }
  }

  // Overdue donor-linked tasks
  for (const t of dueTasks) {
    // Two civil dates compared as civil dates — never an instant, never
    // millisecond arithmetic across a DST boundary. ORG_TZ_SEAM_OK
    const daysOverdue = orgDaysOverdue(t.due, org, today);
    upsertItem({
      donorId: t.donor_id, donorName: t.donor_name,
      reason: `Task: "${t.title}"`,
      priority: 90, action: "call",
      totalGiving: parseFloat(t.total_giving) || 0,
      daysOverdue,
      taskId: t.id, taskTitle: t.title, taskDue: t.due, taskPriority: t.task_priority, taskType: t.task_type,
    });
  }

  // Milestone-ready donors — pending AI-drafted stewardship emails awaiting
  // staff review (see milestone_drafts / retention feature). Unified into
  // the same ranked queue as lapsed/no-contact/overdue-task reasons so this
  // one endpoint is the single source for "needs your attention".
  for (const m of milestoneRows) {
    const milestoneItem = {
      donorId: m.donor_id, donorName: m.donor_name,
      reason: `Milestone email drafted · "${m.subject}" ready for review`,
      priority: 80, action: "milestone",
      totalGiving: parseFloat(m.total_giving) || 0,
      draftId: m.draft_id,
    };
    upsertItem(milestoneItem);
  }

  // At-risk re-engagement drafts — pending, unreviewed AI-drafted emails
  // queued by the 'at_risk' auto-enroll trigger (see computeAtRiskCandidates
  // / autoEnroll below) for a donor who just crossed into the earliest,
  // most-recoverable risk window. These share the milestone_drafts table
  // (milestone_key='at_risk') and so are already caught by the generic
  // bucket above with the generic "Milestone email drafted" reason — this
  // bucket re-upserts the same donor with a distinct reason and a priority
  // just above it (81 > 80) so staff can tell "just flagged today, draft
  // ready" apart from a plain milestone draft or a bare no-contact reason.
  for (const a of atRiskDraftRows) {
    upsertItem({
      donorId: a.donor_id, donorName: a.donor_name,
      reason: "Flagged today: AI-drafted re-engagement email ready for review",
      priority: 81, action: "milestone",
      totalGiving: parseFloat(a.total_giving) || 0,
      draftId: a.draft_id, isLapsing: true,
    });
  }

  // Personal-note reminders — the "write a note" sibling of the milestone
  // drafts above. Priority 82: a hair above milestone-drafted emails (80),
  // since these represent the org's highest-value/most-personal moments by
  // design (see isNoteMoment()).
  for (const n of noteReminderRows) {
    const points = typeof n.talking_points === "string" ? JSON.parse(n.talking_points) : n.talking_points;
    upsertItem({
      donorId: n.donor_id, donorName: n.donor_name,
      reason: "Worth a personal note: see talking points",
      priority: 82, action: "note",
      totalGiving: parseFloat(n.total_giving) || 0,
      reminderId: n.reminder_id, talkingPoints: points || [],
    });
  }

  // At-risk recurring gifts — failed/retrying donor subscriptions. This is
  // real, already-identified revenue actively draining away that the
  // nonprofit would otherwise never notice (see CLAUDE.md "Recurring gift
  // recovery"), so it's folded into the same ranked queue rather than living
  // only on a separate report.
  for (const rs of atRiskSubs) {
    const amountStr = rs.amount != null ? `$${Number(rs.amount).toLocaleString()}/${rs.interval === "year" ? "yr" : "mo"}` : "a recurring gift";
    upsertItem({
      donorId: rs.donor_id, donorName: rs.donor_name,
      reason: `Recurring gift failed · ${amountStr} at risk`,
      priority: 85, action: "recurring",
      totalGiving: parseFloat(rs.total_giving) || 0,
      subscriptionId: rs.stripe_subscription_id,
    });
  }

  // BUILD-45 §6.3 drift wire — a donor who canceled or paused their recurring
  // gift FROM THE PORTAL in the last 7 days is a "needs you today" item. A
  // cancellation the org learns about in minutes is a save opportunity; one it
  // discovers at month-end is a lapse statistic. Outranks the failed-card
  // bucket (85): this donor made a deliberate choice minutes-to-days ago.
  for (const pd of portalDrift) {
    const verb = pd.action === "recurring_cancel" ? "canceled" : "paused";
    const amountStr = pd.amount != null ? `$${Number(pd.amount).toLocaleString()}/${pd.interval === "year" ? "yr" : "mo"}` : "their recurring gift";
    upsertItem({
      donorId: pd.donor_id, donorName: pd.donor_name,
      reason: `${verb === "canceled" ? "Canceled" : "Paused"} ${amountStr} via the portal: reach out today, thank them, learn what changed`,
      priority: 88, action: "call",
      totalGiving: parseFloat(pd.total_giving) || 0,
    });
  }

  // Matching-gift opportunities — a recent donor whose employer has a known
  // matching-gift program (see matchingGifts.js), real dollar upside for a
  // simple ask. Low priority relative to everything above (failed payments,
  // overdue tasks, drafted emails): this is a nice-to-have opportunity, not
  // time-sensitive, so it should never crowd out those. Only considered for
  // donors not already claimed by a higher-priority bucket above — computed
  // as a hard exclusion (not just a priority contest), matching "isn't
  // already flagged for something else."
  const alreadyFlaggedIds = new Set(items.map(i => i.donorId));
  let matchingGiftCount = 0;
  for (const d of employerDonorRows) {
    if (matchingGiftCount >= 5) break;
    if (alreadyFlaggedIds.has(d.id)) continue;
    const match = lookupMatchingGift(d.employer);
    if (!match) continue;
    upsertItem({
      donorId: d.id, donorName: d.name,
      reason: `${match.companyName} matches employee gifts ${match.ratio}: ask about submitting a match request`,
      priority: 30, action: "matching_gift",
      totalGiving: parseFloat(d.total_giving) || 0,
      matchCompany: match.companyName, matchRatio: match.ratio,
    });
    matchingGiftCount++;
  }

  items.sort((a, b) => b.priority - a.priority);
  const top = items.slice(0, 10);
  // SCALE-2: whether each person is still on file (in this org, not deleted),
  // so Home no longer needs the whole donor list, or a second request, to
  // hide a row nothing can act on (a task row is not filtered by deleted_at).
  const onFile = new Set((await query(`SELECT id FROM donors WHERE org_id = ? AND deleted_at IS NULL AND id = ANY(?)`,
    [orgId, top.map(i => i.donorId).filter(Boolean)])).map(r => r.id));
  for (const i of top) i.onFile = !!i.donorId && onFile.has(i.donorId);
  res.json(top);
}));

// Ranked, per-donor drill-down behind the Stewardship Debt headline number —
// every donor with total_giving > 0 has a precise, individually-attributable
// contribution to that aggregate (see computeStewardshipDebtBreakdown), so
// this surfaces it directly instead of leaving it as one opaque figure.
// Capped at a page size since a large org could have hundreds of qualifying
// donors; `count` is the true total so the UI can say "top 50 of 214".
app.get("/dashboard/stewardship-debt/breakdown", requireAuth, OS.cached("debt-breakdown"), wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const scope = req.query.scope === "all" ? "all" : "mine";
  const breakdown = await computeStewardshipDebtBreakdown(orgId, scope === "mine" ? { userId } : {});
  const total = breakdown.reduce((sum, d) => sum + d.contribution, 0);
  const rows = breakdown.slice(0, PAGE_SIZE).map(d => ({
    donorId: d.donorId,
    donorName: d.donorName,
    totalGiving: d.totalGiving,
    daysSinceContact: d.daysSinceContact,
    contribution: Math.round(d.contribution * 10) / 10,
    percentOfTotal: total > 0 ? Math.round((d.contribution / total) * 1000) / 10 : 0,
  }));
  // BUILD-73 Part 2 — was Math.round(total); the headline of a money breakdown.
  res.json({ total: toDollars(toCents(total) || 0), count: breakdown.length, rows });
}));

// Ranked drill-down behind the Retention Rate headline number — the actual
// donors who gave last year but haven't given again this year, i.e. the
// specific list dragging the rate down. Shares computeRetentionRate's exact
// donor-set math (thisYearDonorIds/prevYearDonorIds) so the headline % and
// this list can never disagree: nonRetained.length always equals
// prevYearCount - retained by construction (set difference vs set
// intersection of the same two sets).
app.get("/dashboard/retention/breakdown", requireAuth, OS.cached("retention-breakdown"), wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const PAGE_SIZE = 50;
  const scope = req.query.scope === "all" ? "all" : "mine";
  const retention = await computeRetentionRate(orgId, scope === "mine" ? { userId } : {});
  const nonRetainedIds = [...retention.prevYearDonorIds].filter(id => !retention.thisYearDonorIds.has(id));

  let rows = [];
  if (nonRetainedIds.length) {
    const donorRows = await query(
      `SELECT id, name, last_gift_amount, last_gift_date FROM donors
       WHERE org_id = ? AND deleted_at IS NULL AND id IN (${nonRetainedIds.map(() => "?").join(",")})`,
      [orgId, ...nonRetainedIds]
    );
    // SCALE-1: each date is read once, not once per comparison; the comparator
    // returns the same numbers (NaN included), so the stable sort is unchanged.
    const t = new Map(donorRows.map(d => [d, new Date(d.last_gift_date || 0).getTime()]));
    rows = donorRows
      .sort((a, b) => t.get(b) - t.get(a))
      .slice(0, PAGE_SIZE)
      .map(d => ({
        donorId: d.id,
        donorName: d.name,
        lastGiftAmount: Number(d.last_gift_amount) || 0,
        lastGiftDate: d.last_gift_date,
      }));
  }

  res.json({
    retentionRate: retention.retentionRate,
    thinData: retention.thinData, historyDays: retention.historyDays, floor: retention.floor,
    retained: retention.retained, prevYearCount: retention.prevYearCount,
    year: retention.year, prevYear: retention.prevYear,
    nonRetainedCount: nonRetainedIds.length, rows,
  });
}));

app.get("/dashboard", requireAuth, wrap(async (req, res) => {
  const { orgId } = req.user;
  const urgentTasks = await query(
    "SELECT * FROM tasks WHERE org_id=? AND done=0 AND voided_at IS NULL AND priority='high' ORDER BY due ASC LIMIT 5",
    [orgId]
  );
  const upcomingDeadlines = await query(
    "SELECT * FROM grants WHERE org_id=? AND status!='closed' ORDER BY deadline ASC LIMIT 5",
    [orgId]
  );
  const recentInteractions = (await query(
    `SELECT i.*, d.name as donor_name FROM interactions i
     JOIN donors d ON d.id = i.donor_id
     WHERE i.org_id=? ORDER BY i.date DESC NULLS LAST LIMIT 10`,
    [orgId]
  )).map(SEALED_MAIL.stubInteraction);   // SECURE-3: an org-wide list gets the line
  // FIX-49: the one lapse rule, on the org's day (it read a status nothing wrote).
  const lapsedRule = require("../../shared/numbers/lapse").sql("lapsed", "LEFT(last_gift_date, 10)", orgToday(await orgTz(orgId)), "donors.id");   // ORG_TZ_SEAM_OK (FIX-60: a pledge holds them)
  const lapsedDonors = await query(
    `SELECT * FROM donors WHERE org_id=? AND deleted_at IS NULL AND COALESCE(gift_count, 0) > 0
        AND last_gift_date ~ '^\\d{4}-\\d{2}-\\d{2}' AND ${lapsedRule.sql} ORDER BY last_gift_date ASC LIMIT 5`,
    [orgId, ...lapsedRule.args]
  );
  res.json({ urgentTasks, upcomingDeadlines, recentInteractions, lapsedDonors });
}));

// BUILD-79 Part 6 — an UNNAMED record with zero gifts is not an actionable
// person: six phone numbers once sat in Needs Your Attention with Log call
// buttons. The needs-name tag is the import's flag (Part 5); a human naming
// the record clears it from this predicate the moment the tag is removed.
const namedOrGivingSql = (a = "d") =>
  `NOT (COALESCE(${a}.gift_count, 0) = 0 AND (COALESCE(${a}.tags, '[]')::text LIKE '%needs-name%' OR ${a}.name LIKE 'Unnamed donor%'))`;
}

module.exports = { routers, mount };
