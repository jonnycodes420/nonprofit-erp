// server/receipts/letterWord.js · LETTERS-1 item 3. THE LETTERS AS A WORD FILE.
//
// "...or download it as a Word document." One .docx, one letter per page,
// every word editable. Each letter is its own section (a section starts a new
// page), so her letterhead repeats on every page as a Word header. A letter
// from her own Word template keeps its layout; a words-only template gets the
// same letterhead, date and window address the PDF draws. The signature image
// sits above the signer's name, as in the PDF. Drawn from the same letters the
// PDF is, so the two files hold the same people and the same words.
"use strict";

const d = require("docx");
const { imageBuffer, SIG } = require("./letterPdf");

const TW = 20;
const typeOf = uri => (/^data:image\/png/.test(uri) ? "png" : "jpg");

function sizeOfImage(buf, fallbackW, fallbackH) {
  try { const s = require("image-size")(buf); return { w: s.width || fallbackW, h: s.height || fallbackH }; } catch { return { w: fallbackW, h: fallbackH }; }
}
function signatureRun(uri) {
  const buf = imageBuffer(uri);
  if (!buf) return null;
  const s = sizeOfImage(buf, SIG.w, SIG.h);
  const k = Math.min(SIG.w / s.w, SIG.h / s.h);
  return new d.ImageRun({ type: typeOf(uri), data: buf, transformation: { width: Math.round(s.w * k * 96 / 72), height: Math.round(s.h * k * 96 / 72) } });
}

const ALIGN = { left: d.AlignmentType.LEFT, center: d.AlignmentType.CENTER, right: d.AlignmentType.RIGHT, justify: d.AlignmentType.JUSTIFIED };

function runsOf(text, look) {
  // A line break inside a field (an address block) is a break in Word too.
  return String(text).split("\n").map((part, i) => new d.TextRun({ text: part, break: i ? 1 : 0, ...look }));
}

function paragraphsOf(blocks, signature) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === "image") {
      const buf = imageBuffer(b.src);
      if (buf) out.push(new d.Paragraph({ alignment: ALIGN[b.align] || ALIGN.left,
        children: [new d.ImageRun({ type: typeOf(b.src), data: buf, transformation: { width: Math.round(b.width * 96 / 72), height: Math.round(b.height * 96 / 72) } })] }));
      continue;
    }
    if (b.type === "table") {
      out.push(new d.Table({
        columnWidths: b.widths.map(w => Math.round(w * TW)),
        borders: d.TableBorders.NONE,
        rows: b.rows.map(row => new d.TableRow({ children: row.cells.map(c => new d.TableCell({
          columnSpan: c.span > 1 ? c.span : undefined,
          borders: { top: { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" } },
          children: (() => { const p = paragraphsOf(c.blocks, signature); return p.length ? p : [new d.Paragraph("")]; })(),
        })) })),
      }));
      continue;
    }
    if (b.signer && signature) { const s = signatureRun(signature); if (s) out.push(new d.Paragraph({ alignment: ALIGN[b.align] || ALIGN.left, children: [s] })); }
    const children = [];
    for (const r of b.runs || []) {
      children.push(...runsOf(r.text, { bold: r.bold, italics: r.italic, underline: r.underline ? {} : undefined, allCaps: r.caps,
        size: r.size ? Math.round(r.size * 2) : undefined, color: r.color ? r.color.replace("#", "") : undefined, font: r.font }));
    }
    const spacing = {};
    if (b.before != null) spacing.before = Math.round(b.before * TW);
    if (b.after != null) spacing.after = Math.round(b.after * TW);
    if (b.line && b.line.mult) { spacing.line = Math.round(b.line.mult * 240); spacing.lineRule = d.LineRuleType.AUTO; }
    if (b.line && b.line.exact) { spacing.line = Math.round(b.line.exact * TW); spacing.lineRule = d.LineRuleType.EXACT; }
    const indent = {};
    if (b.indentLeft) indent.left = Math.round(b.indentLeft * TW);
    if (b.indentRight) indent.right = Math.round(b.indentRight * TW);
    if (b.firstLine > 0) indent.firstLine = Math.round(b.firstLine * TW);
    if (b.firstLine < 0) indent.hanging = Math.round(-b.firstLine * TW);
    out.push(new d.Paragraph({ alignment: ALIGN[b.align] || undefined, spacing, indent, children }));
  }
  return out;
}

// The words-only letter, laid out as the PDF lays it out.
function plainSection(org, L, { dateLine, signature }) {
  const logo = org.logo_data ? imageBuffer(String(org.logo_data).replace(/^data:image\/jpg/, "data:image/jpeg")) : null;
  const head = [];
  if (logo) {
    const s = sizeOfImage(logo, 60, 44); const k = Math.min(60 / s.w, 44 / s.h);
    head.push(new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.ImageRun({ type: typeOf(org.logo_data), data: logo, transformation: { width: Math.round(s.w * k * 96 / 72), height: Math.round(s.h * k * 96 / 72) } })] }));
  }
  head.push(new d.Paragraph({ children: [new d.TextRun({ text: org.display || "", bold: true, size: 26, font: "Helvetica", color: "0F1A12" })] }));
  if (org.receipt_address) head.push(new d.Paragraph({ children: runsOf(org.receipt_address, { size: 17, font: "Helvetica", color: "5A554F" }) }));
  const body = [
    new d.Paragraph({ alignment: d.AlignmentType.RIGHT, spacing: { after: 360 }, children: [new d.TextRun({ text: dateLine, size: 20, font: "Helvetica" })] }),
    new d.Paragraph({ spacing: { after: 480 }, children: runsOf(L.address.join("\n"), { size: 22, font: "Helvetica" }) }),
  ];
  const lines = L.text.split("\n");
  const at = signature && L.signer ? lines.map(s => s.trim()).lastIndexOf(L.signer.trim()) : -1;
  lines.forEach((line, i) => {
    if (i === at) { const s = signatureRun(signature); if (s) body.push(new d.Paragraph({ children: [s] })); }
    body.push(new d.Paragraph({ spacing: { after: 60 }, children: [new d.TextRun({ text: line, size: 23, font: "Times New Roman" })] }));
  });
  return { properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1080, left: 1440, right: 1440, header: 500 } } },
    headers: { default: new d.Header({ children: head }) }, children: body };
}

function layoutSection(L, { signature }) {
  const pg = L.layout.page;
  const body = paragraphsOf(L.layout.body, signature);
  if (L.goodsServices) body.push(new d.Paragraph({ spacing: { before: 200 }, children: runsOf(L.goodsServices, { size: 19, font: "Times New Roman", color: "333333" }) }));
  const section = { properties: { page: { size: { width: 12240, height: 15840 },
    margin: { top: Math.round(pg.top * TW), bottom: Math.round(pg.bottom * TW), left: Math.round(pg.left * TW), right: Math.round(pg.right * TW), header: Math.round(pg.header * TW), footer: Math.round(pg.footer * TW) } } },
    children: body.length ? body : [new d.Paragraph("")] };
  if (L.layout.header.length) section.headers = { default: new d.Header({ children: paragraphsOf(L.layout.header, null) }) };
  if (L.layout.footer.length) section.footers = { default: new d.Footer({ children: paragraphsOf(L.layout.footer, null) }) };
  return section;
}

async function renderLettersDocx(org, letters, { dateLine, signature = null }) {
  const sections = letters.map(L => (L.layout ? layoutSection(L, { signature }) : plainSection(org, L, { dateLine, signature })));
  const doc = new d.Document({ creator: org.display || "Steward", title: "Letters", sections });
  return d.Packer.toBuffer(doc);
}

module.exports = { renderLettersDocx };
