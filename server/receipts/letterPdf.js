// server/receipts/letterPdf.js · LETTERS-1. ONE PDF, ONE LETTER PER PAGE.
//
// Two kinds of letter, one file:
//   * A WORDS-ONLY TEMPLATE (BUILD-98): Steward's letterhead (the org's name,
//     return address and logo), the date, the address in the #10 window and
//     the body in Times. Moved here verbatim from server/outreach/thanks.js.
//   * HER OWN LETTER (a template uploaded from Word, letterDoc.js): her
//     letterhead, her fonts' nearest faces, her sizes, colours and spacing,
//     filled per donor. Steward adds nothing to the page but the signature.
//
// The signature (item 2): an image above the signer's typed name, in its own
// colours, so a blue-ink signature prints blue. A letter is held to one page:
// what does not fit is cut at the page and never spills onto a second sheet.
"use strict";

const ACK_WINDOW = { x: 0.875 * 72 + 6, y: 2.0 * 72 + 6, w: 4.5 * 72 - 12, h: 1.125 * 72 - 8 };   // = shared/ackLetter.js WINDOW
const SIG = { w: 170, h: 50 };

function imageBuffer(uri) {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(String(uri || ""));
  if (!m) return null;
  try { return Buffer.from(m[2], "base64"); } catch { return null; }
}

const FACE = { Times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  Helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
  Courier: ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"] };
function fontOf(r, faceOf) {
  const f = FACE[faceOf(r.font)] || FACE.Times;
  return f[(r.bold ? 1 : 0) + (r.italic ? 2 : 0)];
}

// ── her own letter ─────────────────────────────────────────────────────────
function drawLayout(doc, layout, { signature, goodsServices, faceOf }) {
  const pg = layout.page;
  const PW = doc.page.width, PH = doc.page.height;
  const left = pg.left, right = PW - pg.right;
  let clipped = false;

  const lineGapOf = (b, size) => {
    if (b.line && b.line.exact) return Math.max(0, b.line.exact - size * 1.16);
    const mult = b.line && b.line.mult ? b.line.mult : 1.08;
    return Math.max(0, size * 1.16 * (mult - 1));
  };
  const sizeOf = b => (b.runs.find(r => r.size) || {}).size || 11;
  const textOf = r => (r.caps ? r.text.toUpperCase() : r.text).replace(/\t/g, "    ");

  // Height of a paragraph at a width, for the footer and the page limit.
  const measure = (b, width) => {
    if (b.type === "image") return Math.min(b.height, 300) + 4;
    if (b.type === "table") return 0;
    const size = sizeOf(b);
    const text = b.runs.map(textOf).join("") || " ";
    doc.font(fontOf(b.runs[0] || {}, faceOf)).fontSize(size);
    return (b.before || 0) + doc.heightOfString(text, { width: Math.max(20, width - (b.indentLeft || 0) - (b.indentRight || 0)), lineGap: lineGapOf(b, size) }) + (b.after || 0);
  };

  const drawBlocks = (blocks, x, width, y, bottom) => {
    for (const b of blocks || []) {
      if (y >= bottom) { clipped = true; break; }
      if (b.type === "image") {
        const buf = imageBuffer(b.src);
        const w = Math.min(b.width, width), h = Math.min(b.height * (w / (b.width || 1)), 300);
        if (y + h > bottom) { clipped = true; break; }
        if (buf) {
          const ix = b.align === "center" ? x + (width - w) / 2 : b.align === "right" ? x + width - w : x;
          try { doc.image(buf, ix, y, { fit: [w, h] }); } catch { /* a picture that will not draw costs the picture, not the letter */ }
        }
        y += h + 4;
        continue;
      }
      if (b.type === "table") {
        const total = b.widths.reduce((t, w) => t + w, 0) || 1;
        for (const row of b.rows) {
          let cx = x, rowBottom = y, col = 0;
          for (const c of row.cells) {
            const span = b.widths.slice(col, col + c.span).reduce((t, w) => t + w, 0) || total / Math.max(1, row.cells.length);
            const cw = width * span / total;
            rowBottom = Math.max(rowBottom, drawBlocks(c.blocks, cx + 2, cw - 4, y, bottom));
            cx += cw; col += c.span;
          }
          y = rowBottom;
        }
        continue;
      }
      // a paragraph
      y += b.before || 0;
      if (b.signer && signature) {
        const buf = imageBuffer(signature);
        if (buf && y + SIG.h <= bottom) {
          const sx = b.align === "center" ? x + (width - SIG.w) / 2 : b.align === "right" ? x + width - SIG.w : x + (b.indentLeft || 0);
          try { doc.image(buf, sx, y, { fit: [SIG.w, SIG.h], align: b.align === "right" ? "right" : b.align === "center" ? "center" : "left", valign: "bottom" }); } catch { /* the typed name still prints */ }
          y += SIG.h + 2;
        }
      }
      const size = sizeOf(b);
      const px = x + (b.indentLeft || 0), pw = Math.max(20, width - (b.indentLeft || 0) - (b.indentRight || 0));
      const runs = b.runs.filter(r => r.text);
      if (!runs.length) { y += size * 1.16 + lineGapOf(b, size) + (b.after || 0); continue; }
      const h = measure({ ...b, before: 0, after: 0 }, width);
      const room = bottom - y;
      if (room < size) { clipped = true; break; }
      const opts = { width: pw, align: b.align || "left", lineGap: lineGapOf(b, size), indent: b.firstLine > 0 ? b.firstLine : 0, height: room, ellipsis: h > room };
      if (h > room) clipped = true;
      runs.forEach((r, i) => {
        doc.font(fontOf(r, faceOf)).fontSize(r.size || size).fillColor(r.color || "#000000");
        const last = i === runs.length - 1;
        if (i === 0) doc.text(textOf(r), px, y, { ...opts, continued: !last, underline: !!r.underline });
        else doc.text(textOf(r), { ...opts, continued: !last, underline: !!r.underline });
      });
      y = Math.min(bottom, y + h) + (b.after || 0);
    }
    return y;
  };

  // The letterhead from the top's header distance; the body below it and the margin.
  const headEnd = drawBlocks(layout.header, left, right - left, pg.header, PH / 2);
  const footH = (layout.footer || []).reduce((t, b) => t + measure(b, right - left), 0);
  const footTop = PH - pg.footer - footH;
  const bodyBottom = Math.min(PH - pg.bottom, footTop - 6);
  let y = drawBlocks(layout.body, left, right - left, Math.max(pg.top, headEnd + 6), bodyBottom);
  // HOME-3: what was received and what is deductible, under every letter that
  // needs it. No template, hers included, can leave it out.
  if (goodsServices) {
    y = drawBlocks([{ type: "paragraph", before: 10, runs: [{ text: goodsServices, size: 9.5, font: "Times", color: "#333333" }] }], left, right - left, y, bodyBottom);
  }
  drawBlocks(layout.footer, left, right - left, footTop, PH - 4);
  return { clipped };
}

// ── the words-only letter (BUILD-98) ──────────────────────────────────────
function drawPlain(doc, org, L, { dateLine, logo, signature }) {
  const INK = "#0f1a12", SUB = "#5a554f";
  const accent = org.brand_accent || "#0d5c3a";
  const PW = doc.page.width;
  // Letterhead: the org's name and return address, top left; the logo right.
  doc.rect(0, 0, PW, 6).fill(accent);
  if (logo) { try { doc.image(logo, PW - 72 - 60, 22, { fit: [60, 44] }); } catch { /* a logo that will not draw costs the logo, not the letter */ } }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(org.display, 72, 26, { width: PW - 220, lineBreak: false });
  if (org.receipt_address) doc.font("Helvetica").fontSize(8.5).fillColor(SUB).text(org.receipt_address, 72, 44, { width: PW - 220 });
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(dateLine, 72, 100, { width: PW - 144, align: "right" });
  // The address, exactly where the window of a #10 envelope is.
  doc.font("Helvetica").fontSize(11).fillColor(INK)
    .text(L.address.join("\n"), ACK_WINDOW.x, ACK_WINDOW.y, { width: ACK_WINDOW.w, height: ACK_WINDOW.h, lineGap: 1 });
  // The body starts below the window and is held to the page: a long
  // letter is cut at the page, never allowed to spill onto a second.
  const top = ACK_WINDOW.y + ACK_WINDOW.h + 40;
  const bottom = doc.page.height - 50;
  const style = { width: PW - 144, lineGap: 3 };
  doc.font("Times-Roman").fontSize(11.5).fillColor(INK);
  // LETTERS-1: the signature goes above the signer's typed name, so the text
  // is cut at the last line that is exactly that name.
  const lines = L.text.split("\n");
  const at = signature && L.signer ? lines.map(s => s.trim()).lastIndexOf(L.signer.trim()) : -1;
  if (at < 0 || !imageBuffer(signature)) {
    doc.text(L.text, 72, top, { ...style, height: bottom - top, ellipsis: true });
    return;
  }
  const before = lines.slice(0, at).join("\n"), after = lines.slice(at).join("\n");
  let y = top;
  if (before) { doc.text(before, 72, y, { ...style, height: bottom - y, ellipsis: true }); y = Math.min(doc.y, bottom); }
  if (y + SIG.h < bottom) {
    try { doc.image(imageBuffer(signature), 72, y + 2, { fit: [SIG.w, SIG.h], valign: "bottom" }); } catch { /* the typed name still prints */ }
    y += SIG.h + 2;
  }
  doc.font("Times-Roman").fontSize(11.5).fillColor(INK).text(after, 72, y, { ...style, height: Math.max(12, bottom - y), ellipsis: true });
}

// letters: [{ address, text, layout?, signer, goodsServices }]
function renderLettersPdf(org, letters, { dateLine, signature = null, faceOf = require("./letterDoc").faceOf } = {}) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 40, left: 72, right: 72 }, autoFirstPage: false });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const logo = org.logo_data && /^data:image\/(png|jpe?g);base64,/.test(org.logo_data) ? imageBuffer(org.logo_data.replace(/^data:image\/jpg/, "data:image/jpeg")) : null;
    for (const L of letters) {
      doc.addPage({ size: "LETTER", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      // pdfkit adds a page when text passes the bottom margin; with margins of
      // zero and every text call held to a height, one letter is one page.
      if (L.layout) drawLayout(doc, L.layout, { signature, goodsServices: L.goodsServices, faceOf });
      else drawPlain(doc, org, L, { dateLine, logo, signature });
    }
    doc.end();
  });
}

module.exports = { renderLettersPdf, imageBuffer, SIG };
