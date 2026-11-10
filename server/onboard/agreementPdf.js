// server/onboard/agreementPdf.js · ONBOARD-1. THE SIGNED ORDER FORM AS A PDF.
// The text is the stored rendered_text, byte for byte (the bytes the SHA-256
// was taken of), followed by the signature block. Nothing is re-rendered.
"use strict";

function render(sig) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 56, size: "LETTER" });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const INK = "#0F1A12", GREY = "#5a554f";
    // Paragraphs, not hard-wrapped lines: the template wraps at 80 columns.
    for (const para of String(sig.rendered_text).split(/\n\s*\n/)) {
      const line = para.replace(/\*\*/g, "").replace(/\s*\n\s*/g, " ").trim();
      if (!line) continue;
      if (/^# /.test(line)) doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(line.slice(2)).moveDown(0.4);
      else if (/^## /.test(line)) doc.moveDown(0.3).font("Helvetica-Bold").fontSize(12).fillColor(INK).text(line.slice(3)).moveDown(0.2);
      else doc.font("Helvetica").fontSize(10).fillColor(INK).text(line).moveDown(0.5);
    }
    const at = new Date(sig.signed_at);
    doc.moveDown(1).font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Signed");
    doc.font("Helvetica").fontSize(10).fillColor(INK)
      .text(`${sig.signer_name}, ${sig.signer_title} (${sig.signer_email})`)
      .text(`${at.toUTCString()}`);
    doc.moveDown(0.4).fontSize(8).fillColor(GREY)
      .text(`Order form version ${sig.agreement_version}. SHA-256 of the text above as shown on screen: ${sig.text_sha256}`);
    doc.end();
  });
}

module.exports = { render };
