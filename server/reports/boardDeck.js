// server/reports/boardDeck.js · REPORTS-6 item 3. THE BOARD DECK IN ONE CLICK.
//
// A dated PDF, 16:9, one figure a page, in Steward's type and four colours:
//   cover (the org's name and logo, the day), giving this year so far against
//   the same point last year, retention, the five biggest gifts this quarter,
//   the major-gift pipeline (only when Major Gifts is turned on in the menu),
//   and who to thank or call.
//
// ONE COMPOSITION, as the board pack: composeBoardDeck builds the deck as data
// and renderBoardDeckPdf draws that object. The first two figure pages ARE the
// Board view's numbers: they are read off computeDashboard("board"), the
// function GET /dashboards/board answers with, so the deck and the board view
// cannot disagree. Every other figure is a figureSources.js source, so each
// one opens its rows on screen and foots to them (assertSurfacesAgree's
// reports6 pass reads the numbers back out of the PDF).
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
const INK = "#0F1A12", WHITE = "#FFFFFF", CREAM = "#F0EDE6", EMERALD = "#0D5C3A", BRASS = "#C9A84C", GREY = "#5A554F";
const TOP_N = 5;

function mount(ctx) {
  const { computeDashboard, computeDriftForDonors, computeRetentionRate, figureSources, orgPlanTier, orgRow, orgTime,
    orgToday, orgTz, query, reportHooks, requireAuth, wrap } = ctx;
  const deps = { computeRetentionRate, computeDriftForDonors };

  // Major Gifts is on when the org's menu shows it (navGroups.js DEFAULT_OFF holds it off by default).
  async function majorGiftsOn(org) {
    const N = await import("../../client/src/lib/navGroups.js");
    let saved = org.nav_layout;
    try { if (typeof saved === "string") saved = JSON.parse(saved); } catch { saved = null; }
    const groups = N.orgNavLayout(Array.isArray(saved) ? saved : null);
    for (const g of groups || []) for (const it of g.items || []) {
      const id = typeof it === "string" ? it : it && it.id;
      if (id === "majorgifts") return typeof it === "string" ? true : it.visible !== false && it.hidden !== true;
    }
    return false;
  }

  const metricOf = (board, key) => (board.metrics || []).find(m => m.key === key) || null;
  const pageFig = (m, extra = {}) => m && ({ label: m.label, kind: m.kind, value: m.value, source: m.source || null,
    definition: m.definition, blank: m.blank || null, ...extra });

  async function composeBoardDeck(orgId, { isTeam = false } = {}) {
    const DD = await import("../../shared/displayDate.js");
    const org = await orgRow(orgId);
    const tzOrg = await orgTz(orgId);
    const today = orgToday(tzOrg);                                   // ORG_TZ_SEAM_OK
    const board = await computeDashboard(orgId, "board", { isTeam });
    const pages = [];
    pages.push({ key: "cover", kind: "cover", title: "Board deck", orgName: org.name || "", logo: org.logo_data || null,
      sub: `${board.fiscalYear.fyLabel || board.fiscalYear.label} · as of ${board.asOfLabel}` });

    // 1. Giving this year so far against the same point last year: the Board view's three tiles.
    const ytd = metricOf(board, "revenueThisYear"), ly = metricOf(board, "revenueLastYear"), chg = metricOf(board, "revenueChangePct");
    pages.push({ key: "ytd", kind: "compare", title: "Giving this year so far, against the same point last year",
      sentence: board.answer && board.answer.text ? board.answer.text : null,
      figures: [pageFig(ytd), pageFig(ly), pageFig(chg)].filter(Boolean) });

    // 2. Retention: the Board view's tile, with its two halves.
    const ret = metricOf(board, "retentionRate");
    pages.push({ key: "retention", kind: "single", title: "Retention", figures: [pageFig(ret, { also: ret && ret.also ? ret.also : null })] });

    // 3. The five biggest gifts this quarter.
    const qtr = orgTime.orgPeriodBounds({ ...tzOrg, vocabulary_json: org.vocabulary_json }, "quarter", 0);
    const topSource = { key: "gifts", params: { from: qtr.start, to: today < qtr.end ? today : qtr.end, order: "amount" } };
    const top = await figureSources.figure(orgId, topSource, deps, { page: 1, pageSize: TOP_N });
    pages.push({ key: "topGifts", kind: "list", title: `The ${TOP_N} biggest gifts this quarter`,
      total: { label: `Every gift this quarter, ${DD.displayDate(topSource.params.from)} to ${DD.displayDate(topSource.params.to)}`, kind: "money", value: top.value, source: topSource,
        definition: "Every gift dated in this calendar quarter up to today, added up. The list is the largest of them, biggest first." },
      rows: (top.rows || []).slice(0, TOP_N).map(r => ({ name: r.name, detail: r.dateLabel || "", value: r.amount, kind: "money" })) });

    // 4. The major-gift pipeline, only when Major Gifts is on.
    if (await majorGiftsOn(org)) {
      const stages = await query(
        `SELECT COALESCE(stage, 'none') AS stage FROM donors WHERE org_id = ? AND deleted_at IS NULL AND assigned_to IS NOT NULL GROUP BY 1`, [orgId]);
      const rows = [];
      for (const s of stages) {
        const source = { key: "pipeline-stage", params: { stage: s.stage } };
        const v = await figureSources.figureValue(orgId, source, deps);
        rows.push({ name: s.stage === "none" ? "No stage set" : String(s.stage).replace(/_/g, " ").replace(/^./, c => c.toUpperCase()),
          value: v.value, kind: "count", source });
      }
      rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
      pages.push({ key: "pipeline", kind: "list", title: "The major-gift pipeline", countList: true,
        definition: "Every prospect assigned to an officer, by the stage they are in today.", rows });
    }

    // 5. Who to thank, and who to call.
    const since = await reportHooks.thanksSince(orgId);
    const thankSource = { key: "unthanked", params: { since, to: today } };
    const thank = await figureSources.figure(orgId, thankSource, deps, { page: 1, pageSize: TOP_N });
    const lyb = await reportHooks.run(orgId, "lybunt", {});
    const callRows = [...(lyb.rows || [])].sort((a, b) => (b.priorYearTotal || 0) - (a.priorYearTotal || 0)).slice(0, TOP_N);
    const callFig = lyb.figures && lyb.figures.people ? lyb.figures.people : null;
    pages.push({ key: "thankOrCall", kind: "two", title: "Who to thank, and who to call",
      left: { heading: "Thank", figure: { label: "Gifts not yet thanked", kind: "count", value: thank.value, source: thankSource,
        definition: `Gifts dated since ${DD.displayDate(since)} with no thank-you logged.` },
        rows: (thank.rows || []).slice(0, TOP_N).map(r => ({ name: r.name, detail: r.dateLabel || "", value: r.amount, kind: "money" })) },
      right: { heading: "Call", figure: callFig ? { label: "Gave last year, not yet this year", kind: "count", value: callFig.value, source: callFig.source,
        definition: "LYBUNT: people who gave last fiscal year and have not yet given this one. The names are the five who gave the most last year." } : null,
        rows: callRows.map(r => ({ name: r.name, detail: "gave last year", value: r.priorYearTotal, kind: "money" })) } });

    const definitions = [];
    for (const p of pages) {
      for (const f of [...(p.figures || []), p.total, p.left && p.left.figure, p.right && p.right.figure].filter(Boolean)) {
        if (f.definition && !definitions.some(d => d.label === f.label)) definitions.push({ label: f.label, definition: f.definition });
      }
      if (p.definition) definitions.push({ label: p.title, definition: p.definition });
    }
    return { title: "Board deck", orgName: org.name || "", asOf: today, asOfLabel: DD.displayDate(today), pages, definitions };
  }

  const money = v => "$" + (Math.round((Number(v) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (kind, v) => (v === null || v === undefined ? "None yet" : kind === "money" ? money(v) : kind === "percent" ? `${v}%` : Number(v).toLocaleString("en-US"));

  async function renderBoardDeckPdf(deck) {
    const PDFDocument = require("pdfkit");
    const doc = new PDFDocument({ size: [960, 540], margin: 0, bufferPages: true, compress: false, autoFirstPage: false });
    const chunks = []; doc.on("data", c => chunks.push(c));
    const done = new Promise(r => doc.on("end", r));
    const W = 960, H = 540, L = 64, CW = W - 128;
    const SERIF = "Times-Roman", SANS = "Helvetica", BOLD = "Helvetica-Bold";
    const page = (ground = WHITE) => { doc.addPage({ size: [W, H], margin: 0 }); doc.rect(0, 0, W, H).fill(ground); };
    const title = t => { doc.font(SERIF).fontSize(28).fillColor(INK).text(t, L, 48, { width: CW }); return doc.y + 18; };
    const figureBlock = (f, x, y, w, big = 54) => {
      doc.font(SANS).fontSize(13).fillColor(GREY).text(f.label, x, y, { width: w });
      doc.font(BOLD).fontSize(big).fillColor(f.value === null || f.value === undefined ? GREY : f.kind === "money" || f.kind === "percent" ? EMERALD : INK).text(fmt(f.kind, f.value), x, doc.y + 4, { width: w });
      let yy = doc.y + 6;
      if (f.value === null && f.blank) { doc.font(SANS).fontSize(11).fillColor(GREY).text(f.blank, x, yy, { width: w }); yy = doc.y + 4; }
      if (f.definition) { doc.font(SANS).fontSize(11).fillColor(GREY).text(f.definition, x, yy, { width: w, lineGap: 1.5 }); yy = doc.y; }
      return yy;
    };
    const listRows = (rows, x, y, w, size = 15) => {
      if (!rows.length) { doc.font(SANS).fontSize(13).fillColor(GREY).text("Nobody yet.", x, y, { width: w }); return doc.y; }
      for (const [i, r] of rows.entries()) {
        doc.font(SANS).fontSize(size).fillColor(INK).text(`${i + 1}. ${r.name || "(no name)"}`, x, y, { width: w * 0.55, lineBreak: false, ellipsis: true });
        doc.font(SANS).fontSize(size - 3).fillColor(GREY).text(r.detail || "", x + w * 0.55, y + 2, { width: w * 0.2, lineBreak: false, ellipsis: true });
        doc.font(BOLD).fontSize(size).fillColor(r.kind === "money" ? EMERALD : INK).text(fmt(r.kind, r.value), x + w * 0.75, y, { width: w * 0.25, align: "right", lineBreak: false });
        y += size + 14;
      }
      return y;
    };
    for (const p of deck.pages) {
      if (p.kind === "cover") {
        page(INK);
        const logo = require("./reportPdf").logoBuffer(p.logo);
        if (logo) { try { doc.image(logo, L, 64, { fit: [120, 80] }); } catch { /* the logo is skipped, never the deck */ } }
        doc.font(SANS).fontSize(16).fillColor(BRASS).text(p.orgName, L, 250, { width: CW });
        doc.font(SERIF).fontSize(52).fillColor(WHITE).text(p.title, L, doc.y + 6, { width: CW });
        doc.font(SANS).fontSize(15).fillColor(CREAM).text(p.sub, L, doc.y + 10, { width: CW });
        continue;
      }
      page(p.key === "thankOrCall" ? CREAM : WHITE);
      let y = title(p.title);
      if (p.kind === "compare") {
        const w = (CW - 48) / 3;
        p.figures.forEach((f, i) => figureBlock(f, L + i * (w + 24), y + 10, w, i === 2 ? 40 : 46));
        if (p.sentence) doc.font(SANS).fontSize(14).fillColor(INK).text(p.sentence, L, H - 110, { width: CW });
      } else if (p.kind === "single") {
        const f = p.figures[0];
        let yy = figureBlock(f, L, y + 10, CW * 0.6, 72);
        for (const a of f.also || []) { doc.font(SANS).fontSize(14).fillColor(INK).text(`${a.label}: ${fmt(a.kind || "count", a.value)}`, L, yy + 10, { width: CW }); yy = doc.y; }
      } else if (p.kind === "list") {
        if (p.total) {
          doc.font(SANS).fontSize(12).fillColor(GREY).text(p.total.label, L, y, { width: CW * 0.7 });
          doc.font(BOLD).fontSize(22).fillColor(EMERALD).text(fmt("money", p.total.value), L, doc.y + 2, { width: CW });
          y = doc.y + 18;
        } else if (p.definition) { doc.font(SANS).fontSize(12).fillColor(GREY).text(p.definition, L, y, { width: CW }); y = doc.y + 16; }
        listRows(p.rows, L, y, CW);
      } else if (p.kind === "two") {
        const w = (CW - 48) / 2;
        for (const [i, side] of [p.left, p.right].entries()) {
          const x = L + i * (w + 48);
          doc.font(BOLD).fontSize(18).fillColor(INK).text(side.heading, x, y, { width: w });
          let yy = doc.y + 6;
          if (side.figure) {
            doc.font(SANS).fontSize(12).fillColor(GREY).text(side.figure.label, x, yy, { width: w * 0.7 });
            doc.font(BOLD).fontSize(20).fillColor(INK).text(fmt("count", side.figure.value), x, doc.y + 2, { width: w });
            yy = doc.y + 12;
          }
          listRows(side.rows, x, yy, w, 13);
        }
      }
    }
    // What each number means, then the footer on every page but the cover.
    page(WHITE);
    let y = title("What each number means");
    for (const d of deck.definitions) {
      if (y > H - 70) { page(WHITE); y = title("What each number means, continued"); }
      doc.font(BOLD).fontSize(11).fillColor(INK).text(d.label, L, y, { width: CW });
      doc.font(SANS).fontSize(10).fillColor(GREY).text(d.definition, L, doc.y + 1, { width: CW });
      y = doc.y + 8;
    }
    const range = doc.bufferedPageRange();
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font(SANS).fontSize(9).fillColor(GREY)
        .text(`${deck.orgName} · ${deck.title} · ${deck.asOfLabel} · ${i + 1} of ${range.count}`, L, H - 30, { width: CW, align: "right", lineBreak: false });
    }
    doc.end(); await done;
    return Buffer.concat(chunks);
  }

  const deckFilename = deck => `board-deck-${deck.asOf}.pdf`;
  const isTeamOf = async orgId => orgPlanTier(await orgRow(orgId)) === "team";

  // A GET: the deck is a read, and survives HEAD.
  const app = routers.r1;
  app.get("/board-deck", requireAuth, wrap(async (req, res) => {
    res.json(await composeBoardDeck(req.user.orgId, { isTeam: await isTeamOf(req.user.orgId) }));
  }));
  app.get("/board-deck/pdf", requireAuth, wrap(async (req, res) => {
    const deck = await composeBoardDeck(req.user.orgId, { isTeam: await isTeamOf(req.user.orgId) });
    const pdf = await renderBoardDeckPdf(deck);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${deckFilename(deck)}"`);
    res.setHeader("Content-Length", pdf.length);
    res.end(pdf);
  }));

  reportHooks.composeBoardDeck = composeBoardDeck;
  reportHooks.renderBoardDeckPdf = renderBoardDeckPdf;
  reportHooks.boardDeckFilename = deckFilename;
  reportHooks.boardDeckIsTeam = isTeamOf;
}

module.exports = { routers, mount };
