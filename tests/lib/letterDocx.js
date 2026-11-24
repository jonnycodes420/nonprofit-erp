// tests/lib/letterDocx.js · LETTERS-1. A made-up Word letter, built in memory:
// a letterhead (a blue logo and the org's name in green Garamond), a body with
// three fields written three ways ([First Name], <<Gift Amount>> and Word's
// own «EventName» merge field) and a text box that cannot carry over.
// Fake names only.
"use strict";
const d = require("docx");
const zlib = require("zlib");

// A 4×2 PNG, solid blue, made by hand so the fixture needs no file.
function bluePng(w = 4, h = 2) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 0x1f; raw[o + 1] = 0x3a; raw[o + 2] = 0xc8; raw[o + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function letterDocx({ textBox = true } = {}) {
  const P = (children, o = {}) => new d.Paragraph({ children, ...o });
  const T = (text, o = {}) => new d.TextRun({ text, ...o });
  const header = new d.Header({ children: [
    P([new d.ImageRun({ type: "png", data: bluePng(), transformation: { width: 96, height: 48 } })], { alignment: d.AlignmentType.CENTER }),
    P([T("Riverbend Literacy Circle", { bold: true, size: 32, color: "0D5C3A", font: "Garamond" })], { alignment: d.AlignmentType.CENTER }),
    P([T("12 Mill Street, Lexington, KY 40507", { size: 18, color: "5A554F", font: "Garamond" })], { alignment: d.AlignmentType.CENTER }),
  ] });
  const body = [
    P([T("Dear [First Name],", { font: "Garamond", size: 24 })], { spacing: { after: 200 } }),
    P([T("Thank you for your gift of ", { font: "Garamond", size: 24 }), T("<<Gift Amount>>", { font: "Garamond", size: 24, bold: true }),
       T(" to ", { font: "Garamond", size: 24 }), new d.SimpleField("MERGEFIELD EventName", "«EventName»"), T(".", { font: "Garamond", size: 24 })],
      { alignment: d.AlignmentType.JUSTIFIED, spacing: { after: 200 } }),
    P([T("Of that, {{deductible_amount}} is deductible.", { font: "Garamond", size: 24 })]),
    P([T("With thanks,", { font: "Garamond", size: 24 })], { spacing: { before: 240 } }),
    P([T("{{signer}}", { font: "Garamond", size: 24 })]),
  ];
  if (textBox) body.push(new d.Textbox({ alignment: d.AlignmentType.LEFT, children: [P([T("Join us next June")])], style: { width: "2in", height: "1in" } }));
  const doc = new d.Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 2160, bottom: 1440, left: 1440, right: 1440, header: 720 } } },
    headers: { default: header }, children: body }] });
  return d.Packer.toBuffer(doc);
}

module.exports = { letterDocx, bluePng };
