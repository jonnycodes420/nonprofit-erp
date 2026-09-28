// memberCard.js — the member card, drawn once.
//
// BUILD-101 Part 5 drew it for staff, inside routes/crm.js. MEMBERS-2 gives
// the member their own page and their own download of the same card, and a
// second renderer is how the staff copy and the member's copy end up saying
// different things about the same membership. So it lives here and both
// callers require it.
//
// One page: the org's letterhead, the member's name, the level, the date it
// runs through, and the QR the door reads (shared/passCode.js). Held to one
// page by construction.

function renderMemberCardPdf({ orgName, accent, logo, memberName, levelName, expiresOn, memberSince, qrPng = null }) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false });
  return new Promise((resolve, reject) => {
    const chunks = []; doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.addPage();
    const INK = "#0f1a12", SUB = "#5a554f";
    // A wallet-card-sized panel (3.375 x 2.125 in) near the top, to cut out.
    const X = 72, Y = 72, W = 243, H = 153;
    // The QR sits on the right of the card and the text keeps clear of it, so
    // a long name wraps rather than running under the code a scanner reads.
    const QR = qrPng ? 62 : 0;
    const textW = W - 28 - (QR ? QR + 8 : 0);
    doc.roundedRect(X, Y, W, H, 10).lineWidth(1).strokeColor("#e8e4db").stroke();
    doc.rect(X, Y, W, 8).fill(accent || "#0d5c3a");
    if (logo && !qrPng) { try { doc.image(logo, X + W - 58, Y + 16, { fit: [44, 32] }); } catch { /* a logo that will not draw costs the logo, not the card */ } }
    if (qrPng) { try { doc.image(qrPng, X + W - QR - 12, Y + 20, { fit: [QR, QR] }); } catch { /* the same */ } }
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(orgName, X + 14, Y + 20, { width: textW, height: 26, ellipsis: true });
    doc.font("Helvetica").fontSize(8).fillColor(SUB).text("MEMBER", X + 14, Y + 58, { characterSpacing: 1.5 });
    doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(memberName, X + 14, Y + 70, { width: textW, height: 20, ellipsis: true });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(`${levelName} membership`, X + 14, Y + 96, { width: W - 28, height: 14, ellipsis: true });
    doc.font("Helvetica").fontSize(9).fillColor(SUB)
      .text(expiresOn ? `Valid through ${expiresOn}` : "Lifetime member", X + 14, Y + 118, { width: W - 28, height: 12 })
      .text(`Member since ${memberSince}`, X + 14, Y + 131, { width: W - 28, height: 12 });
    doc.end();
  });
}

module.exports = { renderMemberCardPdf };
