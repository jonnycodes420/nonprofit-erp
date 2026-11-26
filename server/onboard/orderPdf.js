// server/onboard/orderPdf.js · ORDER-1. THE ORDER AS A PDF, DRAWN FROM ITS SNAPSHOT.
//
// The same snapshot the page showed (order.buildSnapshot) and the signature stored:
// every line and figure is the snapshot's own words, never re-computed here. A signed
// copy carries the stamp "Signed by … on … at … ET", the Terms version, the IP address
// and the SHA-256 of the snapshot. Unsigned, it says so at the foot.
//
// Uncompressed on purpose: the order is one page of text, and a check (or a person with
// a text editor) can read every figure straight out of the file.
"use strict";
const { signedStamp } = require("./order");
const { filledLines } = require("./agreementBlock");

// The agreement's markdown as paragraphs: headings bold, "**" dropped, rules skipped.
function paragraphs(doc, text, W) {
  for (const para of String(text).split(/\n\s*\n/)) {
    const line = para.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s*\n\s*/g, " ").trim();
    if (!line || /^-{3,}$/.test(line)) continue;
    if (/^#{1,3} /.test(line)) doc.moveDown(0.2).font("Helvetica-Bold").fontSize(10.5).fillColor("#0F1A12").text(line.replace(/^#{1,3} /, ""), 56, doc.y, { width: W }).moveDown(0.15);
    else doc.font("Helvetica").fontSize(9).fillColor("#0F1A12").text(line, 56, doc.y, { width: W }).moveDown(0.35);
  }
}

function render(snapshot, sig = null) {
  const PDFDocument = require("pdfkit");
  const at = sig ? new Date(sig.signed_at) : new Date();
  const doc = new PDFDocument({ margin: 56, size: "LETTER", compress: false,
    info: { Title: `Steward order ${snapshot.orderNumber}`, Author: "Steward", CreationDate: at } });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const INK = "#0F1A12", EM = "#0D5C3A", GREY = "#5a554f";
    const W = doc.page.width - 112;
    const label = t => doc.moveDown(0.8).font("Helvetica-Bold").fontSize(8.5).fillColor(GREY).text(t.toUpperCase(), { characterSpacing: 0.8 }).moveDown(0.3);

    doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(`Steward order ${snapshot.orderNumber}`);
    doc.font("Helvetica").fontSize(10).fillColor(GREY).text(`Prepared by ${snapshot.preparedBy} on ${snapshot.preparedOn}.${snapshot.version > 1 ? ` Version ${snapshot.version}.` : ""}`);

    label("Who this is for");
    const who = [["Organization", snapshot.orgName], ["Signing for the organization", `${snapshot.signer.name}${snapshot.signer.title ? `, ${snapshot.signer.title}` : ""}`],
      ["Billing email", snapshot.billingEmail], ["Order", snapshot.orderNumber]];
    for (const [k, v] of who) doc.font("Helvetica").fontSize(9).fillColor(GREY).text(k).font("Helvetica-Bold").fontSize(11).fillColor(INK).text(v).moveDown(0.25);

    label("What you're getting");
    const row = (l, bold) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica-Bold").fontSize(bold ? 12 : 11).fillColor(INK).text(l.label, 56, y, { width: W - 120 });
      const after = doc.y;
      doc.font("Helvetica-Bold").fontSize(bold ? 12 : 11).fillColor(INK).text(l.amount, 56 + W - 110, y, { width: 110, align: "right" });
      doc.y = after;
      doc.font("Helvetica").fontSize(9.5).fillColor(GREY).text(l.detail, 56, doc.y, { width: W - 120 }).moveDown(0.5);
    };
    for (const l of snapshot.lines) row(l, false);
    doc.moveTo(56, doc.y).lineTo(56 + W, doc.y).strokeColor(INK).lineWidth(1.2).stroke().moveDown(0.4);
    row(snapshot.total, true);
    if (snapshot.note) doc.font("Helvetica").fontSize(10).fillColor(EM).text(snapshot.note, 56, doc.y, { width: W }).moveDown(0.3);

    label("The short version of the terms");
    for (const t of snapshot.shortTerms) doc.font("Helvetica").fontSize(10).fillColor(INK).text(`•  ${t}`, 56, doc.y, { width: W });
    doc.moveDown(0.3).fontSize(9.5).fillColor(GREY).text(`This order and the Terms of Service (version ${snapshot.termsVersion}), at stewardapp.dev/terms, are the agreement. Privacy Policy: stewardapp.dev/privacy.`, { width: W });

    // SALES-6: an order made from a quote carries the customer agreement. The web page shows it without
    // its paper signature block; here, once signed, that block is drawn filled in.
    if (snapshot.agreement && snapshot.agreement.text) {
      label(`Customer agreement (version ${snapshot.agreement.version})`);
      paragraphs(doc, snapshot.agreement.text, W);
      if (sig) {
        doc.moveDown(0.4);
        for (const [k, v] of filledLines({ orgName: snapshot.orgName, name: sig.signer_name, title: sig.signer_title, signedAt: sig.signed_at }))
          doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(`${k}: `, 56, doc.y, { continued: true, width: W }).font("Helvetica").text(v);
      }
    }

    label(sig ? "Signed" : "Not signed yet");
    if (sig) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(`${signedStamp(sig.signer_name, sig.signed_at)}.`);
      doc.font("Helvetica").fontSize(10).fillColor(INK).text(`${sig.signer_name}${sig.signer_title ? `, ${sig.signer_title}` : ""} (${sig.signer_email}), for ${snapshot.orgName}.`);
      doc.moveDown(0.4).fontSize(8).fillColor(GREY)
        .text(`Terms version ${sig.terms_version}. IP address ${sig.ip || "not recorded"}. Browser: ${String(sig.user_agent || "not recorded").slice(0, 160)}.`, { width: W })
        .text(`SHA-256 of this order as shown on screen: ${sig.snapshot_sha256}`, { width: W });
    } else {
      doc.font("Helvetica").fontSize(10).fillColor(INK).text("This is a copy to read. It is signed on the order page, by the person named above.", { width: W });
    }
    doc.end();
  });
}

module.exports = { render };
