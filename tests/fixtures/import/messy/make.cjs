// tests/fixtures/import/messy/make.cjs · IMPORT-3. The messy set.
//
// Twenty-seven files the way real organisations keep them, every name fake.
// Each file's ANSWER KEY is computed here from the rows this script writes,
// with the brief's rules applied by hand, never by shared/sheetRead.js: a
// reader that graded its own homework is how BUILD-77 shipped a bad import.
//
//   node tests/fixtures/import/messy/make.cjs     (rewrites the files + expected.json)
"use strict";
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "../../../../client/node_modules/xlsx"));
const OUT = __dirname;

const FIRST = ["Alma", "Theo", "Priya", "Jonah", "Lucinda", "Omar", "Beatrice", "Felix", "Harriet", "Marcus", "Ines", "Gordon", "Tamsin", "Elliot", "Wren", "Desmond"];
const LAST = ["Arnold", "Bennett", "Castillo", "Dawson", "Ellison", "Fairbanks", "Garner", "Holloway", "Ibarra", "Jennings", "Kowalski", "Langford", "Mercer", "Nakamura", "Okafor", "Prescott"];
const person = i => ({ first: FIRST[i % 16], last: LAST[(i * 7 + 3) % 16] });
const mail = p => `${p.first}.${p.last}@example.org`.toLowerCase();
const AMTS = [25, 50, 100, 250, 500, 1000, 75, 150, 35, 2000, 300, 125];
const amt = i => AMTS[i % AMTS.length];
const iso = (m, d, y = 2026) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const us = (m, d, y = 2026) => `${m}/${d}/${y}`;
const sum = a => a.reduce((x, y) => x + y, 0);
const c = d => Math.round(d * 100);
const csvCell = v => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (aoa, d = ",") => aoa.map(r => r.map(csvCell).join(d)).join("\n") + "\n";
function serial(isoDate) { return Math.round(Date.parse(isoDate + "T00:00:00Z") / 86400000 + 25569); }

const files = [];
const add = (name, write, expect, answers) => files.push({ name, write, expect, answers: answers || {} });
function writeBook(file, sheets, bookType) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa, { cellDates: true });
    if (s.merges) ws["!merges"] = s.merges;
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, path.join(OUT, file), bookType ? { bookType } : undefined);
}
// the answer key's own vocabulary, written from the brief
const key = o => ({ people: 0, households: 0, organizations: 0, gifts: 0, giftCents: 0, pledges: 0, pledgeCents: 0, aside: 0, ...o });

// 1 · the event sheet (the scrubbed fixture, read raw here and keyed by the brief's rules)
{
  const src = path.join(OUT, "..", "event-gifts-sheet-scrubbed.xlsx");
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(src).Sheets.Sheet1, { header: 1, defval: null, raw: true }).slice(1).filter(r => r[0]);
  let gifts = 0, giftC = 0, pledges = 0, pledgeC = 0, people = 0, households = 0;
  for (const r of rows) {
    const joint = /&/.test(String(r[1] || ""));
    people += joint ? 2 : 1; households += joint ? 1 : 0;
    const done = String(r[5] || "").trim().toLowerCase();
    const paid = done === "yes" || done === "";          // the blank one is answered "paid"
    const multi = /x\s*3\s*years/i.test(String(r[4] || ""));
    if (multi) { pledges++; pledgeC += c(r[6]); if (paid) { gifts++; giftC += c(r[2]); } }
    else if (paid) { gifts++; giftC += c(r[2]); } else { pledges++; pledgeC += c(r[2]); }
  }
  add("01-event-gifts-sheet.xlsx", f => fs.copyFileSync(src, f),
    key({ people, households, gifts, giftCents: giftC, pledges, pledgeCents: pledgeC, totalsMatch: 2, monthly: 1 }),
    { date: "2026-10-22", eventName: "Finding Joy Dinner", linkEvent: true, rows: { "Sheet1:26": "gift" } });
}

// 2 · Salesforce NPSP opportunity export
{
  const H = ["Opportunity ID", "Opportunity Name", "Contact: First Name", "Contact: Last Name", "Contact: Email", "Amount", "Close Date", "Stage", "Payment Method"];
  const rows = []; let g = 0, gc = 0, p = 0, pc = 0, aside = 0;
  for (let i = 0; i < 12; i++) {
    const pp = person(i), stage = i % 6 === 4 ? "Pledged" : i === 9 ? "Closed Lost" : "Closed Won";
    rows.push([`0065e00000${100 + i}AbC`, `${pp.last} Donation ${us(3, i + 1)}`, pp.first, pp.last, mail(pp), amt(i), iso(3, i + 1), stage, i % 2 ? "Check" : "Credit Card"]);
    if (stage === "Closed Won") { g++; gc += c(amt(i)); } else if (stage === "Pledged") { p++; pc += c(amt(i)); } else aside++;
  }
  // the Closed Lost row is set aside, and its person (who gave nothing else) is not made a record
  add("02-salesforce-npsp-opportunities.csv", f => fs.writeFileSync(f, toCsv([H, ...rows])),
    key({ people: 11, gifts: g, giftCents: gc, pledges: p, pledgeCents: pc, aside }));
}

// 3 · Bloomerang transactions
{
  const H = ["Account Number", "First Name", "Last Name", "Email", "Date", "Amount", "Fund", "Campaign", "Method", "Type"];
  const rows = []; let gc = 0;
  for (let i = 0; i < 10; i++) { const pp = person(i + 20); rows.push([String(1000 + i), pp.first, pp.last, mail(pp), us(9, i + 1), amt(i + 1), "General Fund", "Fall Appeal", ["Credit Card", "Check", "Cash", "ACH"][i % 4], "Donation"]); gc += c(amt(i + 1)); }
  add("03-bloomerang-transactions.csv", f => fs.writeFileSync(f, toCsv([H, ...rows])), key({ people: 10, gifts: 10, giftCents: gc }));
}
// 4 · DonorPerfect gift export (gift_type carries the method code)
{
  const H = ["donor_id", "first_name", "last_name", "email", "gift_date", "amount", "gl_code", "solicit_code", "gift_type"];
  const rows = []; let gc = 0;
  for (let i = 0; i < 9; i++) { const pp = person(i + 3); rows.push([String(500 + i), pp.first, pp.last, mail(pp), us(8, i + 2), amt(i + 2).toFixed(2), "UNR", "SPRING26", ["CC", "CK", "CASH"][i % 3]]); gc += c(amt(i + 2)); }
  // people: rows 7,8 reuse person 3+7=10 → names repeat? person(i+3) for i 0..8 → 9 distinct (first index mod 16)
  add("04-donorperfect-gifts.csv", f => fs.writeFileSync(f, toCsv([H, ...rows])), key({ people: 9, gifts: 9, giftCents: gc }));
}
// 5 · Little Green Light gifts
{
  const H = ["LGL Constituent ID", "First name", "Last name", "Email address", "Gift date", "Gift amount", "Gift type", "Payment type", "Campaign", "Fund"];
  const rows = []; let gc = 0;
  for (let i = 0; i < 8; i++) { const pp = person(i + 5); rows.push([String(88000 + i), pp.first, pp.last, mail(pp), iso(7, i + 3), amt(i + 4), "Gift", ["Check", "Credit card", "Cash", "Stock"][i % 4], "Annual Fund 2026", "Operations"]); gc += c(amt(i + 4)); }
  add("05-little-green-light-gifts.csv", f => fs.writeFileSync(f, toCsv([H, ...rows])), key({ people: 8, gifts: 8, giftCents: gc }));
}
// 6 · QuickBooks deposit detail report (title rows, a section, subtotal and total)
{
  const aoa = [["Harborview Food Pantry"], ["Deposit Detail"], ["January - October 2026"], [],
    ["", "Date", "Transaction Type", "Num", "Customer", "Memo/Description", "Clr", "Amount"], ["Checking"]];
  let gc = 0;
  for (let i = 0; i < 7; i++) { const pp = person(i + 9); aoa.push(["", us(10, i + 1), i === 3 ? "Sales Receipt" : "Deposit", String(2100 + i), `${pp.last}, ${pp.first}`, "Donation", "R", amt(i + 6)]); gc += c(amt(i + 6)); }
  aoa.push(["", us(10, 9), "Transfer", "2199", "Harborview Savings Account", "Move to savings", "R", 400]);
  aoa.push(["Total for Checking", "", "", "", "", "", "", gc / 100 + 400]);
  aoa.push([]); aoa.push(["TOTAL", "", "", "", "", "", "", gc / 100 + 400]);
  add("06-quickbooks-deposit-detail.xlsx", f => writeBook(path.basename(f), [{ name: "Deposit Detail", aoa }]),
    key({ people: 7, gifts: 7, giftCents: gc, aside: 1, totalsMatch: 2 }));
}
// 7 · PayPal activity download
{
  const H = ["Date", "Time", "TimeZone", "Name", "Type", "Status", "Currency", "Gross", "Fee", "Net", "From Email Address", "To Email Address", "Transaction ID"];
  const rows = []; let gc = 0, aside = 0;
  for (let i = 0; i < 8; i++) { const pp = person(i + 2); const g = amt(i + 3); rows.push([us(10, i + 1), "09:1" + i + ":00", "EDT", `${pp.first} ${pp.last}`, "Donation Payment", "Completed", "USD", g.toFixed(2), (-(g * 0.0289 + 0.49)).toFixed(2), (g - g * 0.0289 - 0.49).toFixed(2), mail(pp), "give@harborview.example.org", "8XY" + (1000 + i)]); gc += c(g); }
  rows.push([us(10, 12), "10:00:00", "EDT", "", "General Withdrawal", "Completed", "USD", "-500.00", "0.00", "-500.00", "", "", "9AB0001"]); aside++;
  rows.push([us(10, 13), "10:30:00", "EDT", "Wren Okafor", "Donation Payment", "Refunded", "USD", "40.00", "0.00", "40.00", "wren.okafor@example.org", "give@harborview.example.org", "9AB0002"]); aside++;
  add("07-paypal-activity.csv", f => fs.writeFileSync(f, toCsv([H, ...rows])), key({ people: 8, gifts: 8, giftCents: gc, aside }));
}
// 8 · Venmo statement (title rows, leading empty column, "+ $25.00")
{
  const aoa = [["Account Statement - (@harborview-pantry) "], ["Account Activity"],
    ["", "ID", "Datetime", "Type", "Status", "Note", "From", "To", "Amount (total)", "Amount (tip)", "Amount (tax)", "Amount (fee)", "Tax Rate", "Tax Exempt", "Funding Source", "Destination", "Beginning Balance", "Ending Balance", "Statement Period Venmo Fees", "Terminal Location", "Year to Date Venmo Fees", "Disclaimer"]];
  let gc = 0;
  for (let i = 0; i < 6; i++) { const pp = person(i + 11); aoa.push(["", String(4100000000 + i), `2026-10-0${i + 1}T14:2${i}:10`, "Payment", "Complete", "for the pantry", `${pp.first} ${pp.last}`, "Harborview Pantry", `+ $${amt(i)}.00`, "", "", "", "0", "", "Venmo balance", "", "", "", "", "Venmo", "", ""]); gc += c(amt(i)); }
  aoa.push(["", "4100000099", "2026-10-09T09:00:00", "Standard Transfer", "Issued", "", "", "", "- $300.00", "", "", "", "0", "", "", "Bank ****1234", "", "", "", "Venmo", "", ""]);
  add("08-venmo-statement.csv", f => fs.writeFileSync(f, toCsv(aoa)), key({ people: 6, gifts: 6, giftCents: gc, aside: 1 }));
}
// 9 · Givebutter transactions
{
  const H = ["Transaction ID", "First Name", "Last Name", "Email", "Phone", "Address 1", "City", "State", "Zip Code", "Amount", "Fee", "Fee Covered", "Date", "Campaign Title", "Method", "Status"];
  const rows = []; let gc = 0;
  for (let i = 0; i < 7; i++) { const pp = person(i + 6); rows.push(["GB" + (7000 + i), pp.first, pp.last, mail(pp), `(504) 555-01${10 + i}`, `${100 + i} Magnolia St`, "Mobile", "AL", "36602", amt(i + 5), "1.20", "Yes", `2026-09-${10 + i} 18:00:00`, "Back to School", ["card", "ach", "paypal"][i % 3], "succeeded"]); gc += c(amt(i + 5)); }
  add("09-givebutter-transactions.csv", f => fs.writeFileSync(f, toCsv([H, ...rows])), key({ people: 7, gifts: 7, giftCents: gc }));
}
// 10 · a title row, the header on row 4
{
  const aoa = [["Harborview Food Pantry Donations"], ["Prepared for the board, October 2026"], [], ["Name", "Email", "Amount", "Date"]];
  let gc = 0;
  for (let i = 0; i < 6; i++) { const pp = person(i + 1); aoa.push([`${pp.first} ${pp.last}`, mail(pp), amt(i + 7), iso(6, i + 10)]); gc += c(amt(i + 7)); }
  add("10-title-row-header-on-row-4.xlsx", f => writeBook(path.basename(f), [{ name: "Donations", aoa }]), key({ people: 6, gifts: 6, giftCents: gc }));
}
// 11 · subtotals per month
{
  const aoa = [["Name", "Date", "Amount"]]; let gc = 0, n = 0;
  for (const [m, label] of [[7, "July"], [8, "August"], [9, "September"]]) {
    aoa.push([label]); let sub = 0;
    for (let i = 0; i < 3; i++) { const pp = person(n + 4); aoa.push([`${pp.first} ${pp.last}`, us(m, i + 5), amt(n)]); sub += amt(n); gc += c(amt(n)); n++; }
    aoa.push(["Subtotal", "", sub]); aoa.push([]);
  }
  aoa.push(["Grand Total", "", gc / 100]);
  add("11-subtotals-per-month.xlsx", f => writeBook(path.basename(f), [{ name: "By month", aoa }]), key({ people: 9, gifts: 9, giftCents: gc, totalsMatch: 4 }));
}
// 12 · "Last, First" in one column, with one couple
{
  const rows = [["Donor", "Gift", "Date"]]; let gc = 0;
  for (let i = 0; i < 5; i++) { const pp = person(i + 8); rows.push([`${pp.last}, ${pp.first}`, amt(i), iso(5, i + 1)]); gc += c(amt(i)); }
  rows.push(["Holloway, Walt & Renee", 500, iso(5, 20)]); gc += 50000;
  add("12-last-first-one-column.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 7, households: 1, gifts: 6, giftCents: gc }));
}
// 13 · "Mr. & Mrs." names
{
  const rows = [["Name", "Amount", "Date"], ["Mr. and Mrs. Walt Arnold", 250, iso(4, 2)], ["Dr. Priya Shah", 100, iso(4, 3)], ["Mr. & Mrs. Theo Castillo", 500, iso(4, 4)], ["Walt and Suzanna Dunmore", 75, iso(4, 5)], ["Margaret Chen", 60, iso(4, 6)]];
  // households: Arnold (one named + spouse by title), Castillo (same), Dunmore (two named)
  add("13-mr-and-mrs-names.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 6, households: 3, gifts: 5, giftCents: c(985) }));
}
// 14 · amounts as text with dollar signs
{
  const rows = [["Name", "Donation", "Date"], ["Alma Arnold", "$1,000.00", "2026-03-01"], ["Theo Bennett", "$250", "2026-03-02"], ["Priya Castillo", "1k", "2026-03-03"], ["Jonah Dawson", "$ 75", "2026-03-04"], ["Omar Ellison", "1,250.50", "2026-03-05"]];
  add("14-amounts-as-text.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 5, gifts: 5, giftCents: c(1000 + 250 + 1000 + 75 + 1250.5) }));
}
// 15 · dates as Excel serials
{
  const rows = [["Name", "Email", "Amount", "Gift Date"]]; let gc = 0;
  for (let i = 0; i < 6; i++) { const pp = person(i + 10); rows.push([`${pp.first} ${pp.last}`, mail(pp), amt(i + 2), serial(iso(2, i + 3))]); gc += c(amt(i + 2)); }
  add("15-excel-serial-dates.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 6, gifts: 6, giftCents: gc, dates: rows.slice(1).map((r, i) => iso(2, i + 3)) }));
}
// 16 · dates like "Oct 22" (no year)
{
  const rows = [["Name", "Amount", "Date"], ["Felix Garner", 100, "Oct 22"], ["Harriet Holloway", 50, "Sep 5"], ["Marcus Ibarra", 250, "Mar 3"], ["Ines Jennings", 40, "Aug 30"]];
  add("16-dates-without-years.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 4, gifts: 4, giftCents: c(440) }));
}
// 17 · two tables side by side
{
  const aoa = [["Spring Appeal", "", "", "", "Fall Appeal"], ["Name", "Amount", "Date", "", "Name", "Amount", "Date"]];
  let gc = 0;
  for (let i = 0; i < 5; i++) { const a = person(i), b = person(i + 8); aoa.push([`${a.first} ${a.last}`, amt(i), iso(4, i + 1), "", `${b.first} ${b.last}`, amt(i + 5), iso(10, i + 1)]); gc += c(amt(i)) + c(amt(i + 5)); }
  add("17-two-tables-side-by-side.xlsx", f => writeBook(path.basename(f), [{ name: "Appeals", aoa }]), key({ people: 10, gifts: 10, giftCents: gc }));
}
// 18 · one tab per year (the same people give across years)
{
  const sheets = []; let gc = 0, n = 0;
  for (const y of [2024, 2025, 2026]) {
    const aoa = [["Name", "Email", "Amount", "Date"]];
    for (let i = 0; i < 4; i++) { const pp = person(i); aoa.push([`${pp.first} ${pp.last}`, mail(pp), amt(n), iso(12, 10 + i, y > 2025 ? 2025 : y)]); gc += c(amt(n)); n++; }
    sheets.push({ name: String(y), aoa });
  }
  // 2026's tab holds gifts made in early 2026
  sheets[2].aoa = sheets[2].aoa.map((r, i) => (i ? [r[0], r[1], r[2], iso(1, 10 + i, 2026)] : r));
  add("18-one-tab-per-year.xlsx", f => writeBook(path.basename(f), sheets), key({ people: 4, gifts: 12, giftCents: gc }));
}
// 19 · a mailing list with no gifts
{
  const rows = [["First Name", "Last Name", "Address", "City", "State", "ZIP", "Email"]];
  for (let i = 0; i < 10; i++) { const pp = person(i + 30); rows.push([pp.first, pp.last, `${20 + i} Dauphin St`, "Mobile", "AL", "36602", mail(pp)]); }
  add("19-mailing-list-no-gifts.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 10, kind: "people" }));
}
// 20 · a pledge list
{
  const rows = [["Name", "Email", "Pledge Amount", "Pledge Date"]]; let pc = 0;
  for (let i = 0; i < 5; i++) { const pp = person(i + 12); rows.push([`${pp.first} ${pp.last}`, mail(pp), amt(i + 9), iso(9, 15 + i)]); pc += c(amt(i + 9)); }
  add("20-pledge-list.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 5, pledges: 5, pledgeCents: pc }));
}
// 21 · one person's monthly gifts on every row
{
  const rows = [["Name", "Date", "Amount", "Method"]];
  for (let m = 1; m <= 10; m++) rows.push(["Margaret Chen", iso(m, 15), 50, "Credit"]);
  add("21-one-person-monthly-gifts.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 1, gifts: 10, giftCents: c(500) }));
}
// 22 · a tab-separated export
{
  const rows = [["Full Name", "Email", "Amount", "Date"]]; let gc = 0;
  for (let i = 0; i < 5; i++) { const pp = person(i + 14); rows.push([`${pp.first} ${pp.last}`, mail(pp), amt(i + 3), iso(1, i + 20)]); gc += c(amt(i + 3)); }
  add("22-tab-separated.tsv", f => fs.writeFileSync(f, toCsv(rows, "\t")), key({ people: 5, gifts: 5, giftCents: gc }));
}
// 23 · merged name cells in an old .xls (a family with two gifts)
{
  const aoa = [["Name", "Amount", "Date"], ["Alma Fairbanks", 100, iso(6, 1)], [null, 200, iso(6, 15)], ["Theo Garner", 50, iso(6, 2)], ["Priya Holloway", 75, iso(6, 3)]];
  add("23-merged-name-cells.xls", f => writeBook(path.basename(f), [{ name: "Gifts", aoa, merges: [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }] }], "biff8"),
    key({ people: 3, gifts: 4, giftCents: c(425) }));
}
// 24 · blank rows, a margin note, a "prepared by" line under the table
{
  const aoa = [[], ["Name", "Email", "Amount", "Date", null, null, null, "call Tuesday about the match"], ["Desmond Kowalski", "desmond@example.org", 300, iso(8, 1)], [],
    ["Wren Langford", "wren@example.org", 150, iso(8, 2)], [], [], ["Elliot Mercer", "elliot@example.org", 80, iso(8, 3)], [], [], ["Prepared by Allie, Oct 2026"]];
  add("24-blank-rows-and-margin-notes.xlsx", f => writeBook(path.basename(f), [{ name: "Sheet1", aoa }]), key({ people: 3, gifts: 3, giftCents: c(530) }));
}
// 25 · organisations, a family and Anonymous in the name column
{
  const rows = [["Donor Name", "Amount", "Date", "Method"], ["First Baptist Church of Mobile", 1000, iso(5, 5), "Check"], ["Arnold Family Foundation", 5000, iso(5, 6), "Foundation"],
    ["The Bennett Family", 250, iso(5, 7), "Check"], ["Rotary Club of Wilmore", 500, iso(5, 8), "Check"], ["Anonymous", 100, iso(5, 9), "Cash"], ["Tamsin Nakamura", 60, iso(5, 10), "Online"]];
  add("25-organizations-and-families.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 6, organizations: 3, gifts: 6, giftCents: c(6910) }));
}
// 26 · a Google Sheets download of a giving form
{
  const rows = [["Timestamp", "Your name", "Email address", "Gift amount", "How would you like to give?"]]; let gc = 0;
  for (let i = 0; i < 5; i++) { const pp = person(i + 15); rows.push([`9/${i + 1}/2026 12:0${i}:00`, `${pp.first} ${pp.last}`, mail(pp), `$${amt(i + 1)}`, i % 2 ? "Check" : "Card"]); gc += c(amt(i + 1)); }
  add("26-google-sheets-form.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ people: 5, gifts: 5, giftCents: gc }));
}
// 27 · a column nobody can name: it must stop at "Help me with these"
{
  const rows = [["Name", "Amount", "Date", "Code"], ["Alma Ibarra", 100, iso(3, 1), "A1"], ["Theo Jennings", 200, iso(3, 2), "B7"], ["Priya Kowalski", 300, iso(3, 3), "C2"]];
  add("27-unknown-column-needs-help.csv", f => fs.writeFileSync(f, toCsv(rows)), key({ stopsAtHelp: true, helpColumns: ["Code"] }));
}

if (require.main === module) {
  const expected = {};
  for (const f of files) { f.write(path.join(OUT, f.name)); expected[f.name] = { expect: f.expect, answers: f.answers }; }
  fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
  console.log(`wrote ${files.length} files + expected.json`);
}
module.exports = { files };
