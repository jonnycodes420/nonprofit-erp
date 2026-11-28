// server/reports/reportPdf.js · REPORTS-6 item 1. A REPORT AS A FILE THAT NEEDS NOBODY TO LOG IN.
//
// One renderer for a saved or standard report: the Download PDF button
// (/saved-reports/:id/pdf), the schedule's preview and the scheduled email's
// attachment all call it with the same run, so the file a board member opens
// is the file the director previewed. Under the org's name and logo: the
// report, the day it was produced, every row the report found, its totals,
// and a last section saying what each column means. No link in it opens
// anything: the PDF is the report.
//
// `compress: false`, as the board pack: the text stays literal in the file,
// so a test reads the numbers back out of it rather than trusting the code
// that wrote them.
"use strict";

const INK = "#0f1a12", GREY = "#5a554f", RULE = "#e8e4db";
const TYPE_WORDS = {
  money: "Dollars and cents, from the gifts on file. A refund comes off the gift it refunds.",
  date: "A day, in your organization's time.",
  number: "A count.",
  count: "A count.",
  pct: "A percentage.",
  bool: "Yes or no.",
};

function logoBuffer(logo) {
  if (!logo || !/^data:image\/(png|jpe?g);base64,/.test(logo)) return null;
  try { return Buffer.from(logo.split(",")[1], "base64"); } catch { return null; }
}

// `report`: { title, question, orgName, logo, producedOnLabel, periodWords?, columns, rows, totals, capped, definitions? }
// `formatCell(v, type)` is the app's rbFormatCell, so a cell reads as it does on screen.
async function renderReportPdf(report, formatCell) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, bufferPages: true, compress: false });
  const chunks = []; doc.on("data", c => chunks.push(c));
  const done = new Promise(r => doc.on("end", r));
  const PW = doc.page.width, L = 36, W = PW - 72;
  const cols = report.columns || [];
  const n = Math.max(cols.length, 1), cw = W / n;
  const logo = logoBuffer(report.logo);
  if (logo) { try { doc.image(logo, PW - L - 60, 30, { fit: [60, 40] }); } catch { /* a logo that will not draw costs the logo */ } }
  doc.font("Helvetica-Bold").fontSize(10).fillColor(GREY).text(report.orgName || "", L, 36, { width: W - 80 });
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(report.title, L, doc.y + 4, { width: W - 80 });
  if (report.question) doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text(report.question, L, doc.y + 2, { width: W - 80 });
  doc.font("Helvetica").fontSize(9).fillColor(GREY)
    .text(`Produced ${report.producedOnLabel}${report.periodWords ? ` · ${report.periodWords}` : ""}`, L, doc.y + 2, { width: W - 80 });
  doc.moveDown(0.8);
  const header = () => {
    const y = doc.y;
    cols.forEach((c, i) => doc.font("Helvetica-Bold").fontSize(8.5).fillColor(INK).text(c.label, L + i * cw, y, { width: cw - 6, lineBreak: false, ellipsis: true }));
    doc.moveTo(L, y + 13).lineTo(L + W, y + 13).strokeColor(RULE).stroke(); doc.y = y + 17;
  };
  header();
  for (const r of report.rows || []) {
    if (doc.y > doc.page.height - 60) { doc.addPage(); header(); }
    const y = doc.y;
    cols.forEach((c, i) => doc.font("Helvetica").fontSize(8.5).fillColor(INK)
      .text(formatCell(r[c.key], c.type), L + i * cw, y, { width: cw - 6, lineBreak: false, ellipsis: true }));
    doc.y = y + 13;
  }
  const t = report.totals || { count: (report.rows || []).length, sums: [] };
  const totalLine = `${Number(t.count || 0).toLocaleString("en-US")} ${t.count === 1 ? "row" : "rows"}`
    + (t.sums && t.sums.length ? " · " + t.sums.map(s => `${s.label} ${formatCell(s.cents / 100, "money")}`).join(" · ") : "")
    + (report.capped ? ` · the first ${(report.rows || []).length.toLocaleString("en-US")} are printed` : "");
  doc.moveDown(0.5).font("Helvetica-Bold").fontSize(9).fillColor(INK).text(totalLine, L, doc.y, { width: W });

  // ── WHAT EACH COLUMN MEANS ──
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("What this report means", L, 40, { width: W });
  let y = doc.y + 8;
  const defs = [
    ...(report.definitions || []),
    ...cols.map(c => ({ label: c.label, definition: c.definition || TYPE_WORDS[c.display || c.type] || "As it reads on the report in Steward." })),
    ...(t.sums && t.sums.length ? [{ label: "Totals", definition: "Every row the report found, added up to the cent in the database, not only the rows printed." }] : []),
  ];
  for (const d of defs) {
    if (y > doc.page.height - 70) { doc.addPage(); y = 40; }
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(d.label, L, y, { width: W });
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(d.definition, L, doc.y + 1, { width: W });
    y = doc.y + 8;
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY)
      .text(`${report.orgName || ""} · ${report.title} · produced ${report.producedOnLabel} · page ${i + 1} of ${range.count}`,
        L, doc.page.height - 26, { width: W, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end(); await done;
  return Buffer.concat(chunks);
}

const pdfFilename = (title, day) => `${(String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report")}-${day}.pdf`;

module.exports = { renderReportPdf, pdfFilename, logoBuffer };
