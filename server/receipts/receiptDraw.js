// server/receipts/receiptDraw.js · RECEIPTS-1. THE PARTS OF THE RECEIPT PDF THAT NAME THE DONOR
// AND THE GIFT, drawn for renderReceiptPdf (server/boot/helpers-3.js).
//
//   orgLine()     the header band's last line: EIN and the org's address. The org's legal name,
//                 address and EIN live in the header (and the footer's tax line), nowhere else.
//   donorBlock()  the donor's name and, under it, the donor's own mailing address from the
//                 snapshot. Blank when there is none: never the org's address.
//   giftBox()     a gift of money: GIFT DATE · AMOUNT · PAYMENT METHOD, then the goods-or-services
//                 sentence. A gift of property (in-kind, stock): DESCRIPTION OF PROPERTY and
//                 DATE RECEIVED, the goods-or-services sentence, and the line that Steward states
//                 no value. No AMOUNT box (IRS Pub 1771: the donor determines the value).
"use strict";

const oneLine = s => String(s || "").split(/\n+/).map(x => x.trim()).filter(Boolean).join(", ");

function orgLine(snapshot) {
  const ein = `EIN: ${snapshot.orgEin || "Not set"}`;
  const addr = oneLine(snapshot.orgAddress);
  return addr ? `${ein} · ${addr}` : ein;
}

function donorBlock(doc, snapshot, y, C) {
  const { PW, INK, INK3 } = C;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(snapshot.donorName || "Valued Donor", 50, y); y = doc.y + 2;
  const addr = String(snapshot.donorAddress || "").trim();
  if (addr) {
    doc.font("Helvetica").fontSize(9).fillColor(INK3).text(addr, 50, y, { width: PW - 100, lineGap: 1 }); y = doc.y;
  }
  return y + 14;
}

function goodsServices(doc, snapshot, y, C, fmtD) {
  const { PW, INK } = C;
  if (snapshot.paidInAll != null && snapshot.goodsServicesSentence) {
    // HOME-3: Partly a gift. AMOUNT above is the gift part; this says what was paid in all.
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(snapshot.goodsServicesSentence, 50, y, { width: PW - 100, lineGap: 2 });
  } else if (snapshot.quidProQuoDesc) {
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(
      `In exchange for this contribution, ${snapshot.orgLegalName} provided: ${snapshot.quidProQuoDesc} (estimated fair market value ${fmtD(snapshot.quidProQuoValue)}). Only the amount of your contribution in excess of that value, ${fmtD(snapshot.deductibleAmount)}, is tax-deductible.`,
      50, y, { width: PW - 100, lineGap: 2 });
  } else {
    doc.font("Helvetica").fontSize(9).fillColor(INK).text("No goods or services were provided in exchange for this contribution.", 50, y, { width: PW - 100 });
  }
  return doc.y;
}

function giftBox(doc, snapshot, y, C, fmtD) {
  const { PW, INK, INK3, BG, GREEN } = C;
  const nc = snapshot.nonCash;
  if (nc) {
    const descW = PW - 100 - 24 - 150;
    doc.font("Helvetica-Bold").fontSize(11);
    const descH = Math.max(14, doc.heightOfString(nc.description || "", { width: descW }));
    const stockH = nc.stock && nc.stock !== nc.description ? 14 : 0;
    const boxH = 34 + descH + stockH;
    doc.rect(50, y, PW - 100, boxH).fill(BG);
    doc.font("Helvetica").fontSize(7).fillColor(INK3).text("DESCRIPTION OF PROPERTY", 62, y + 10);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(nc.description || "", 62, y + 22, { width: descW });
    if (stockH) doc.font("Helvetica").fontSize(9).fillColor(INK3).text(nc.stock, 62, y + 22 + descH + 2, { width: descW });
    doc.font("Helvetica").fontSize(7).fillColor(INK3).text("DATE RECEIVED", PW - 50 - 150, y + 10);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(snapshot.giftDate, PW - 50 - 150, y + 22, { width: 138 });
    y += boxH + 18;
    y = goodsServices(doc, snapshot, y, C, fmtD) + 8;
    doc.font("Helvetica").fontSize(9).fillColor(INK).text(nc.noValueSentence, 50, y, { width: PW - 100, lineGap: 2 });
    return doc.y + 16;
  }
  doc.rect(50, y, PW - 100, 66).fill(BG);
  doc.font("Helvetica").fontSize(7).fillColor(INK3).text("GIFT DATE", 62, y + 10);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(snapshot.giftDate, 62, y + 22);
  doc.font("Helvetica").fontSize(7).fillColor(INK3).text("AMOUNT", 230, y + 10);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(GREEN).text(fmtD(snapshot.amount), 230, y + 22);
  doc.font("Helvetica").fontSize(7).fillColor(INK3).text("PAYMENT METHOD", 390, y + 10);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(snapshot.paymentMethod || "Not set", 390, y + 22);
  y += 84;
  return goodsServices(doc, snapshot, y, C, fmtD) + 16;
}

module.exports = { orgLine, donorBlock, giftBox };
