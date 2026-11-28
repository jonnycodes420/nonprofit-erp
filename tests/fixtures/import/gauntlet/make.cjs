// tests/fixtures/import/gauntlet/make.cjs · IMPORT-13. A MESSY MIGRATION, IN ORDER.
//
// The shape of the 27 Nov import stress gauntlet: one org's move, file after
// file, graded against an answer key built from the rows this script writes,
// never by the reader (the IMPORT-3 pattern). Every name, email and amount is
// made up ("@stress.test" is a reserved-style domain nobody mails).
//
//   node tests/fixtures/import/gauntlet/make.cjs
//
//   Pass 1  contacts                 20 people, then a "TOTAL CONTACTS: 20" footer
//   Pass 2  gifts that must match    37 gifts + 1 refund; set aside: a resent ST-001,
//                                    "next Friday", a refund with no gift to match
//   Pass 3  an overlapping re-export 13 gifts already here, ST-001 resent at $999,
//                                    three no-ID $125 twins (two already here), 5 new
//   Pass 4  a three-sheet workbook   People, Gifts, Pledges (Wanda Pryce's $900)
//   Pass 5  the three ugly fixtures  a deceased and a do-not-contact note, three
//                                    email-only rows, a "TOTAL CONTACTS: 3" footer
//   Pass 6  the scale file           2,500 rows, 500 names, 493 creatable people:
//                                    donor 250's five rows read "not a date", and
//                                    donors 491-496 have no amount
//   Pass 7  the full re-import       passes 2, 3, 5 and 6 again: nothing is created
//   Pass 8  undo everything          back to the exact baseline
"use strict";
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "../../../../client/node_modules/xlsx"));
const OUT = __dirname;

const csvCell = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (name, rows) => fs.writeFileSync(path.join(OUT, name), rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n");
const money = c => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
const sum = a => a.reduce((n, x) => n + x, 0);

// ── Pass 1 · contacts ────────────────────────────────────────────────────────
const PEOPLE = ["Amelia Hart", "Rita Calloway", "Bram Whitlock", "Cora Fenn", "Dmitri Ashgrove", "Elsie Marrow", "Fergus Pell",
  "Greta Hollin", "Hugo Tamsin", "Iris Quayle", "Jasper Orlov", "Kit Saffron", "Lionel Brede", "Mabel Croft", "Nell Ottery",
  "Osric Vane", "Pippa Lorne", "Quentin Ash", "Rosalind Teague", "Silas Warrick"].map(n => {
  const [first, last] = n.split(" ");
  return { name: n, first, last, email: `${first}.${last}@stress.test`.toLowerCase() };
});
const who = n => PEOPLE.find(p => p.name === n);
writeCsv("pass1-contacts.csv", [["First Name", "Last Name", "Email", "City"],
  ...PEOPLE.map((p, i) => [p.first, p.last, p.email, ["Ashby", "Brookfield", "Carver"][i % 3]]),
  ["TOTAL CONTACTS: 20", "", "", ""]]);

// ── Pass 2 · gifts that must match ──────────────────────────────────────────
const G_HDR = ["Gift ID", "Donor Name", "Email", "Gift Date", "Amount", "Fund", "Notes"];
const giftRow = (id, p, date, cents, note = "") => [id, p.name, p.email, date, money(cents), "General", note];
const p2 = [];
const p2gifts = [];   // what lands: { id, who, date, cents }
for (let i = 1; i <= 34; i++) {
  const id = `ST-${String(i).padStart(3, "0")}`;
  let p = PEOPLE[(i - 1) % PEOPLE.length], date = `2025-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`, cents = 5000 + (i % 9) * 2500;
  if (i === 1) { p = who("Amelia Hart"); date = "2026-01-15"; cents = 25000; }
  if (i === 10) { p = who("Rita Calloway"); date = "2026-03-01"; cents = 10000; }
  if (i === 11) { p = who("Rita Calloway"); date = "2026-04-01"; cents = 4500; }
  if (i === 2) p = who("Bram Whitlock");
  if (i === 33 || i === 34) date = "";   // two blank dates: undated gifts that land
  if (p.name === "Rita Calloway" && i !== 10 && i !== 11) p = who("Silas Warrick");
  if (p.name === "Cora Fenn") p = who("Quentin Ash");   // Cora's only row is the unmatched refund
  p2.push(giftRow(id, p, date, cents));
  p2gifts.push({ id, who: p.name, date: date || null, cents });
}
const ND1 = { name: "New Donor One", email: "new.donor.one@stress.test" };
p2.push(giftRow("ST-001", who("Amelia Hart"), "2026-01-15", 25000, "resent by the old system"));   // a repeated ID: lands once
p2.push(giftRow("ST-040", who("Bram Whitlock"), "next Friday", 50000));                           // unreadable date: set aside by default
p2.push(giftRow("", ND1, "2026-02-02", 12500));                                                   // no-ID twins: both count
p2.push(giftRow("", ND1, "2026-02-02", 12500));
p2.push(giftRow("ST-041", ND1, "2026-05-05", 12500));
p2gifts.push({ id: null, who: ND1.name, date: "2026-02-02", cents: 12500 }, { id: null, who: ND1.name, date: "2026-02-02", cents: 12500 },
  { id: "ST-041", who: ND1.name, date: "2026-05-05", cents: 12500 });
p2.push(giftRow("", who("Rita Calloway"), "2026-04-10", -4500, "refund"));   // refunds ST-011
p2.push(giftRow("", who("Cora Fenn"), "2026-06-01", -3000, "refund"));       // no gift to match: set aside
writeCsv("pass2-gifts.csv", [G_HDR, ...p2]);

// ── Pass 3 · an overlapping re-export ───────────────────────────────────────
const p3 = [];
for (const g of p2gifts.filter(g => g.id && +g.id.slice(3) >= 20 && +g.id.slice(3) <= 32)) p3.push(giftRow(g.id, PEOPLE.find(p => p.name === g.who), g.date || "", g.cents));
p3.push(giftRow("ST-001", who("Amelia Hart"), "2026-01-15", 99900));   // changed since the last import
for (let k = 0; k < 3; k++) p3.push(giftRow("", ND1, "2026-02-02", 12500));   // three twins, two already here: one lands
const p3new = [["ST-050", "Hugo Tamsin", 20000], ["ST-051", "Iris Quayle", 30000], ["ST-052", "Kit Saffron", 15000], ["ST-053", "Mabel Croft", 25000], ["ST-054", "Osric Vane", 20000]];
for (const [id, n, c] of p3new) p3.push(giftRow(id, who(n), "2026-07-07", c));
writeCsv("pass3-reexport.csv", [G_HDR, ...p3]);

// ── Pass 4 · a three-sheet workbook ─────────────────────────────────────────
const W = [["W-01", "Wanda", "Pryce"], ["W-02", "Xavier", "Holt"], ["W-03", "Yolanda", "Briggs"], ["W-04", "Zeb", "Carrow"]]
  .map(([id, first, last]) => ({ id, first, last, name: `${first} ${last}`, email: `${first}.${last}@stress.test`.toLowerCase() }));
const wGifts = [["W-01", "2025-09-01", 10000], ["W-01", "2025-10-01", 10000], ["W-02", "2025-09-15", 5000], ["W-03", "2025-11-11", 7500], ["W-04", "2025-12-01", 2500], ["W-04", "2026-01-05", 2500]];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Constituent ID", "First Name", "Last Name", "Email"], ...W.map(w => [w.id, w.first, w.last, w.email])]), "People");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Gift ID", "Constituent ID", "Gift Date", "Amount"], ...wGifts.map(([id, d, c], i) => [`WG-${i + 1}`, id, d, c / 100])]), "Gifts");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Pledge ID", "Constituent ID", "Pledge Date", "Pledge Amount", "Status"], ["WP-1", "W-01", "2025-09-01", 900, "Open"]]), "Pledges");
XLSX.writeFile(wb, path.join(OUT, "pass4-workbook.xlsx"));

// ── Pass 5 · the three ugly fixtures in one file ────────────────────────────
const p5 = [["Name", "Email", "Amount", "Date", "Notes"],
  ["Ottoline Brack", "ottoline.brack@stress.test", "$60.00", "2026-03-03", "Deceased - family asked us to stop mail"],
  ["Percival Moon", "percival.moon@stress.test", "$75.00", "2026-03-04", "Do not contact, per his daughter"],
  ["Leah Sandoval", "leah.sandoval@stress.test", "$80.00", "2026-03-05", ""],
  ["", "orphan@stress.test", "$45.00", "2026-03-06", ""],
  ["", "orphan2@stress.test", "$20.00", "2026-03-07", ""],
  ["", "orphan3@stress.test", "$15.00", "2026-03-08", ""],
  ["TOTAL CONTACTS: 3", "", "", "", ""]];
writeCsv("pass5-ugly.csv", p5);

// ── Pass 6 · the scale file ─────────────────────────────────────────────────
const p6 = [["Donor Name", "Email", "Gift Date", "Amount"]];
const scale = { rows: 0, gifts: 0, cents: 0, people: 0, unreadable: [], noAmount: 0 };
for (let i = 1; i <= 500; i++) {
  const nnn = String(i).padStart(3, "0");
  const name = `QAIMP Scale Donor ${nnn}`, email = `qaimp.scale.${nnn}@stress.test`;
  let gave = false;
  for (let k = 0; k < 5; k++) {
    scale.rows++;
    if (i === 250) { p6.push([name, email, "not a date", "$40.00"]); scale.unreadable.push({ line: scale.rows + 1, cents: 4000 }); continue; }
    if (i >= 491 && i <= 496) { p6.push([name, email, `2025-0${1 + k}-10`, ""]); scale.noAmount++; continue; }
    const cents = 1000 + ((i * 7 + k * 3) % 90) * 100;
    p6.push([name, email, `2025-${String(1 + ((i + k) % 12)).padStart(2, "0")}-${String(1 + (k * 5)).padStart(2, "0")}`, money(cents)]);
    scale.gifts++; scale.cents += cents; gave = true;
  }
  if (gave) scale.people++;
}
writeCsv("pass6-scale.csv", p6);

// ── The answer key ──────────────────────────────────────────────────────────
const byWho = {};
const add = (n, c) => { byWho[n] = (byWho[n] || 0) + c; };
for (const g of p2gifts) add(g.who, g.cents);
add("Rita Calloway", -4500);
const p3lands = [{ who: ND1.name, cents: 12500 }, ...p3new.map(([, n, c]) => ({ who: n, cents: c }))];
for (const g of p3lands) add(g.who, g.cents);
const key = {
  pass1: { people: PEOPLE.length, totalRowLine: PEOPLE.length + 2 },
  pass2: { gifts: p2gifts.length, giftCents: sum(p2gifts.map(g => g.cents)), undated: p2gifts.filter(g => !g.date).length,
           refunds: 1, refundCents: -4500, repeatedIdLines: [36], unreadable: [{ line: 37, words: "next Friday", cents: 50000 }],
           unmatchedRefunds: [{ line: 42, who: "Cora Fenn", cents: -3000 }], newPeople: [ND1.name] },
  pass3: { rows: p3.length, alreadyHere: 13, changed: [{ id: "ST-001", wasCents: 25000, fileCents: 99900 }], lands: p3lands.length, landsCents: sum(p3lands.map(g => g.cents)) },
  pass4: { people: W.length, gifts: wGifts.length, giftCents: sum(wGifts.map(g => g[2])), pledges: 1, pledgeCents: 90000, pledger: "Wanda Pryce" },
  pass5: { gifts: 3, giftCents: 21500, emailOnly: ["orphan@stress.test", "orphan2@stress.test", "orphan3@stress.test"], emailOnlyCents: 8000,
           flagNotes: [{ who: "Ottoline Brack", flag: "deceased" }, { who: "Percival Moon", flag: "doNotContact" }], totalRowLine: 8 },
  pass6: { rows: scale.rows, gifts: scale.gifts, giftCents: scale.cents, people: scale.people, unreadable: scale.unreadable, noAmountRows: scale.noAmount,
           unreadableWho: "QAIMP Scale Donor 250" },
  lifetimes: { "Amelia Hart": byWho["Amelia Hart"], "Rita Calloway": byWho["Rita Calloway"], "New Donor One": byWho["New Donor One"] },
};
if (key.lifetimes["Rita Calloway"] !== 10000 || key.lifetimes["New Donor One"] !== 50000 || key.pass3.landsCents !== 122500 || key.pass2.gifts !== 37) throw new Error("the key does not foot to the brief");
if (key.pass6.people !== 493 || key.pass6.rows !== 2500) throw new Error("the scale key is not 493 of 2,500");
// lines are the file's own (header is line 1)
if (p2[key.pass2.repeatedIdLines[0] - 2][0] !== "ST-001" || p2[36 - 1][3] !== "next Friday" || p2[42 - 2][1] !== "Cora Fenn") throw new Error("pass 2 lines moved");
fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(key, null, 2) + "\n");
console.log("wrote the gauntlet:", Object.keys(key).join(", "));
