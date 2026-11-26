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
    // SALES-6: the paper signature block is not drawn blank; it is drawn filled in, below.
    const B = require("./agreementBlock");
    const { body, hadBlock } = B.bodyOf(sig.rendered_text);
    for (const para of String(body).split(/\n\s*\n/)) {
      const line = para.replace(/\*\*/g, "").replace(/\s*\n\s*/g, " ").trim();
      if (!line) continue;
      if (/^# /.test(line)) doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(line.slice(2)).moveDown(0.4);
      else if (/^## /.test(line)) doc.moveDown(0.3).font("Helvetica-Bold").fontSize(12).fillColor(INK).text(line.slice(3)).moveDown(0.2);
      else doc.font("Helvetica").fontSize(10).fillColor(INK).text(line).moveDown(0.5);
    }
    const at = new Date(sig.signed_at);
    if (hadBlock) {
      doc.moveDown(0.6);
      for (const [k, v] of B.filledLines({ orgName: sig.org_name || "", name: sig.signer_name, title: sig.signer_title, signedAt: sig.signed_at }))
        doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(`${k}: `, { continued: true }).font("Helvetica").text(v);
    }
    doc.moveDown(1).font("Helvetica-Bold").fontSize(11).fillColor(INK).text("Signed");
    doc.font("Helvetica").fontSize(10).fillColor(INK)
      .text(`${sig.signer_name}, ${sig.signer_title} (${sig.signer_email})`)
      .text(`${at.toUTCString()}`);
    doc.moveDown(0.4).fontSize(8).fillColor(GREY)
      .text(`Order form version ${sig.agreement_version}. SHA-256 of the text she agreed to: ${sig.text_sha256}${hadBlock ? " (the text as kept, including the blank signature block the page no longer shows; the block above is its filled copy)" : ""}`);
    doc.end();
  });
}

module.exports = { render };
