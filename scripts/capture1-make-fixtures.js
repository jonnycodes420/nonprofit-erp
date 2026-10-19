// scripts/capture1-make-fixtures.js · CAPTURE-1. THE FAKE DOCUMENTS.
//
// Writes the committed fixtures in tests/fixtures/capture1/: three checks, a
// deposit slip, a pledge form, a donor-advised fund grant letter and an
// address-change note. Every one is plainly fake: "SAMPLE - NOT A REAL CHECK"
// across each check's face, a bank that does not exist, and a MICR line made
// of FAKE_ROUTING and FAKE_ACCOUNT, numbers that exist only so the test can
// prove they never reach a column, a log or an audit row.
//
// Deterministic: the same script writes the same bytes (no dates from the
// clock, PDF metadata pinned). Run: node scripts/capture1-make-fixtures.js
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const PDFDocument = require("pdfkit");

const OUT = path.join(__dirname, "..", "tests", "fixtures", "capture1");
const FAKE_ROUTING = "011000015";
const FAKE_ACCOUNT = "000123456789";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function under1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], "hundred"); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")); }
  else if (n > 0 || !out.length) out.push(ONES[n]);
  return out.join(" ");
}
// "One thousand five hundred and 00/100", the way a person writes a check.
function words(cents) {
  const d = Math.floor(cents / 100), c = cents % 100;
  const parts = [];
  if (d >= 1000) parts.push(under1000(Math.floor(d / 1000)), "thousand");
  if (d % 1000 || !parts.length) parts.push(under1000(d % 1000));
  const s = parts.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1) + " and " + String(c).padStart(2, "0") + "/100";
}
const money = c => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FIXTURES = {
  "check-1.png": { kind: "check", payer: "Margaret A. Lindqvist", address: "18 Alder Lane, Portland ME 04102", cents: 25000, memo: "Building Fund", number: "1043", date: "10/12/2026" },
  "check-2.png": { kind: "check", payer: "Desmond & Ruth Okafor", address: "7 Pier Street, South Portland ME 04106", cents: 150000, memo: "for the boathouse", number: "2210", date: "10/13/2026" },
  "check-3.png": { kind: "check", payer: "Hollis Tran", address: "302 Fore Street Apt 4, Portland ME 04101", cents: 7500, memo: "", number: "318", date: "10/14/2026" },
  "deposit-slip.png": { kind: "deposit_slip", cents: 182500, lines: ["check-1.png", "check-2.png", "check-3.png"] },
  "pledge-form.pdf": { kind: "pledge", donorName: "Sarah Miller", email: "sarah.miller@example.org", cents: 500000,
    fundName: "Building Fund", frequency: "quarterly", installments: 4, startDate: "2026-11-01" },
  "daf-letter.pdf": { kind: "daf_grant", fundOrg: "Example Charitable Gift Fund", fundAddress: "PO Box 5500, Example City, MA 02100",
    cents: 200000, advisorName: "James Whitford", fundName: "General Operating", grantNumber: "EX-2026-48817", date: "October 9, 2026" },
  "address-change.png": { kind: "address_change", donorName: "Ana Ruiz", line1: "44 Harbor View Rd", city: "Portland", state: "ME", postal: "04101" },
};
for (const f of Object.values(FIXTURES)) if (f.cents && f.kind === "check") f.words = words(f.cents);

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = "Helvetica, Arial, DejaVu Sans, sans-serif";

function checkSvg(f) {
  // MICR: transit symbols drawn as the letters the E-13B font would show as
  // marks; the digits are exactly the fake numbers.
  const micr = `T${FAKE_ROUTING}T  ${FAKE_ACCOUNT}U  ${f.number}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="540">
  <rect width="1200" height="540" fill="#f4f1e6"/>
  <rect x="10" y="10" width="1180" height="520" fill="none" stroke="#7a8a7e" stroke-width="3"/>
  <text x="600" y="300" font-family="${FONT}" font-size="52" font-weight="700" fill="#c9a84c" fill-opacity="0.28" text-anchor="middle" transform="rotate(-8 600 300)">SAMPLE - NOT A REAL CHECK</text>
  <text x="40" y="60" font-family="${FONT}" font-size="24" font-weight="700" fill="#0f1a12">${esc(f.payer)}</text>
  <text x="40" y="88" font-family="${FONT}" font-size="18" fill="#0f1a12">${esc(f.address)}</text>
  <text x="1150" y="60" font-family="${FONT}" font-size="24" fill="#0f1a12" text-anchor="end">${f.number}</text>
  <text x="840" y="120" font-family="${FONT}" font-size="18" fill="#0f1a12">Date</text>
  <text x="900" y="120" font-family="${FONT}" font-size="24" fill="#0f1a12">${f.date}</text>
  <line x1="895" y1="126" x2="1150" y2="126" stroke="#0f1a12"/>
  <text x="40" y="190" font-family="${FONT}" font-size="16" fill="#0f1a12">PAY TO THE</text>
  <text x="40" y="210" font-family="${FONT}" font-size="16" fill="#0f1a12">ORDER OF</text>
  <text x="140" y="208" font-family="${FONT}" font-size="26" fill="#0f1a12">Harborlight Youth Collective</text>
  <line x1="135" y1="215" x2="900" y2="215" stroke="#0f1a12"/>
  <rect x="930" y="172" width="220" height="48" fill="#ffffff" stroke="#0f1a12"/>
  <text x="945" y="206" font-family="${FONT}" font-size="28" fill="#0f1a12">$ ${money(f.cents)}</text>
  <text x="40" y="275" font-family="${FONT}" font-size="26" font-style="italic" fill="#0f1a12">${esc(f.words)}</text>
  <line x1="35" y1="282" x2="1030" y2="282" stroke="#0f1a12"/>
  <text x="1040" y="280" font-family="${FONT}" font-size="18" fill="#0f1a12">DOLLARS</text>
  <text x="40" y="350" font-family="${FONT}" font-size="20" font-weight="700" fill="#0f1a12">First Example Bank</text>
  <text x="40" y="374" font-family="${FONT}" font-size="15" fill="#0f1a12">Sample City, Nowhere 00000</text>
  <text x="40" y="440" font-family="${FONT}" font-size="18" fill="#0f1a12">MEMO</text>
  <text x="110" y="440" font-family="${FONT}" font-size="22" fill="#0f1a12">${esc(f.memo)}</text>
  <line x1="105" y1="446" x2="560" y2="446" stroke="#0f1a12"/>
  <path d="M700 440 C 740 400, 770 460, 810 420 S 880 450, 930 415 S 1010 440, 1060 425" fill="none" stroke="#1c2e6b" stroke-width="2.5"/>
  <line x1="690" y1="446" x2="1150" y2="446" stroke="#0f1a12"/>
  <text x="40" y="505" font-family="Courier New, Courier, monospace" font-size="30" letter-spacing="3" fill="#0f1a12">${micr}</text>
</svg>`;
}

function slipSvg(slip) {
  const rows = slip.lines.map((n, i) => {
    const f = FIXTURES[n];
    return `<text x="60" y="${250 + i * 44}" font-family="${FONT}" font-size="22" fill="#0f1a12">Check ${f.number}  ${esc(f.payer)}</text>
  <text x="840" y="${250 + i * 44}" font-family="${FONT}" font-size="22" fill="#0f1a12" text-anchor="end">${money(f.cents)}</text>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560">
  <rect width="900" height="560" fill="#ffffff"/>
  <rect x="10" y="10" width="880" height="540" fill="none" stroke="#7a8a7e" stroke-width="3"/>
  <text x="450" y="300" font-family="${FONT}" font-size="54" font-weight="700" fill="#c9a84c" fill-opacity="0.25" text-anchor="middle" transform="rotate(-10 450 300)">SAMPLE - NOT A REAL SLIP</text>
  <text x="60" y="70" font-family="${FONT}" font-size="28" font-weight="700" fill="#0f1a12">DEPOSIT SLIP</text>
  <text x="60" y="104" font-family="${FONT}" font-size="20" fill="#0f1a12">First Example Bank</text>
  <text x="60" y="150" font-family="${FONT}" font-size="20" fill="#0f1a12">Harborlight Youth Collective   Date 10/15/2026</text>
  <text x="60" y="205" font-family="${FONT}" font-size="18" font-weight="700" fill="#0f1a12">CHECKS</text>
  <text x="840" y="205" font-family="${FONT}" font-size="18" font-weight="700" fill="#0f1a12" text-anchor="end">AMOUNT</text>
  ${rows}
  <line x1="60" y1="400" x2="840" y2="400" stroke="#0f1a12"/>
  <text x="60" y="440" font-family="${FONT}" font-size="24" font-weight="700" fill="#0f1a12">TOTAL DEPOSIT</text>
  <text x="840" y="440" font-family="${FONT}" font-size="24" font-weight="700" fill="#0f1a12" text-anchor="end">$ ${money(slip.cents)}</text>
</svg>`;
}

function noteSvg(f) {
  const hand = "Bradley Hand, Segoe Print, Comic Sans MS, cursive";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
  <rect width="900" height="600" fill="#fbf7ea"/>
  <rect x="12" y="12" width="876" height="576" fill="none" stroke="#c9a84c" stroke-width="2"/>
  <text x="70" y="120" font-family="${hand}" font-size="34" fill="#1c2e6b">Dear Harborlight friends,</text>
  <text x="70" y="200" font-family="${hand}" font-size="32" fill="#1c2e6b">Please update my address:</text>
  <text x="110" y="270" font-family="${hand}" font-size="32" fill="#1c2e6b">${esc(f.donorName)}</text>
  <text x="110" y="320" font-family="${hand}" font-size="32" fill="#1c2e6b">${esc(f.line1)}</text>
  <text x="110" y="370" font-family="${hand}" font-size="32" fill="#1c2e6b">${esc(f.city)} ${f.state} ${f.postal}</text>
  <text x="70" y="460" font-family="${hand}" font-size="30" fill="#1c2e6b">Thank you! Ana</text>
  <text x="450" y="560" font-family="${FONT}" font-size="16" fill="#7a8a7e" text-anchor="middle">SAMPLE NOTE FOR A DEMONSTRATION</text>
</svg>`;
}

const png = svg => sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer();

// pdfkit with pinned metadata, so the bytes are the same every run.
function pdf(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 64, compress: true,
      info: { Title: "Sample", Author: "Steward fixtures", CreationDate: new Date("2026-10-01T00:00:00Z"), ModDate: new Date("2026-10-01T00:00:00Z") } });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    draw(doc);
    doc.end();
  });
}

function pledgePdf(f) {
  return pdf(doc => {
    doc.font("Helvetica-Bold").fontSize(20).text("Harborlight Youth Collective");
    doc.font("Helvetica").fontSize(14).text("Pledge form").moveDown(0.3);
    doc.fontSize(10).fillColor("#7a6a2a").text("SAMPLE FORM FOR A DEMONSTRATION").fillColor("#000").moveDown(1.2);
    doc.fontSize(12);
    const row = (k, v) => { doc.font("Helvetica-Bold").text(k, { continued: true }).font("Helvetica").text("  " + v).moveDown(0.5); };
    row("Name:", f.donorName);
    row("Email:", f.email);
    row("I pledge:", "$" + money(f.cents));
    row("Designation:", f.fundName);
    row("Payment schedule:", `Paid ${f.frequency}, ${f.installments} payments of $${money(f.cents / f.installments)}`);
    row("First payment:", "November 1, 2026");
    doc.moveDown(1).text(`${f.donorName} pledges $${money(f.cents)} to the ${f.fundName}, paid ${f.frequency}, starting ${f.startDate}.`);
    doc.moveDown(2).text("Signature: ______________________________     Date: October 10, 2026");
  });
}

function dafPdf(f) {
  return pdf(doc => {
    doc.font("Helvetica-Bold").fontSize(18).text(f.fundOrg);
    doc.font("Helvetica").fontSize(11).text(f.fundAddress);
    doc.fontSize(10).fillColor("#7a6a2a").text("SAMPLE LETTER FOR A DEMONSTRATION. NOT A REAL GRANT.").fillColor("#000").moveDown(1.5);
    doc.fontSize(12).text(f.date).moveDown(1);
    doc.text("Harborlight Youth Collective").text("Portland, ME").moveDown(1);
    doc.text("Dear Friends,").moveDown(0.6);
    doc.text(`We are pleased to enclose a grant of $${money(f.cents)} from ${f.fundOrg}, recommended by our account holder ${f.advisorName}. ` +
      `The grant is designated for ${f.fundName}. Grant number ${f.grantNumber}.`).moveDown(0.6);
    doc.text("No goods or services were provided in exchange for this grant. Please do not send a tax receipt to the advisor; " +
      "the grant is a gift from the fund.").moveDown(1.2);
    doc.text("Sincerely,").moveDown(0.4).text("Grants Administration").text(f.fundOrg);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const written = [];
  for (const [name, f] of Object.entries(FIXTURES)) {
    let buf;
    if (f.kind === "check") buf = await png(checkSvg(f));
    else if (f.kind === "deposit_slip") buf = await png(slipSvg(f));
    else if (f.kind === "address_change") buf = await png(noteSvg(f));
    else if (f.kind === "pledge") buf = await pledgePdf(f);
    else if (f.kind === "daf_grant") buf = await dafPdf(f);
    if (buf.length > 300 * 1024) throw new Error(`${name} is ${buf.length} bytes, over 300 KB`);
    fs.writeFileSync(path.join(OUT, name), buf);
    written.push(`${name} ${buf.length}B`);
  }
  console.log("[fixtures] capture-1: " + written.join(", "));
}

module.exports = { FAKE_ROUTING, FAKE_ACCOUNT, FIXTURES, words, OUT };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
