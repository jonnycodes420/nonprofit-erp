// tests/fixtures/import/import11/make.cjs · IMPORT-11. A workbook of people and their gifts.
//
// Every name and amount is made up. The answer key is computed here from the
// rows this script writes, never by the reader (the BUILD-77 lesson).
//
//   node tests/fixtures/import/import11/make.cjs
//
// The shape of the 27 Nov stress test: a Read Me sheet, Donors (60 rows keyed
// by Constituent ID), Gifts (136 rows keyed by Constituent ID with no name
// column, then a TOTAL row) and a decoy sheet that is neither.
"use strict";
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "../../../../client/node_modules/xlsx"));
const OUT = __dirname;

const FIRST = ["Alma", "Theo", "Priya", "Jonah", "Lucinda", "Omar", "Beatrice", "Felix", "Harriet", "Marcus", "Ines", "Gordon"];
const LAST = ["Arbuckle", "Brightwater", "Cobblestone", "Dunmore", "Eversleigh"];
const FUNDS = ["General Fund", "Scholarships", "Building"];

const donors = [];
for (let i = 0; i < 60; i++) {
  const first = FIRST[i % FIRST.length], last = LAST[Math.floor(i / FIRST.length)];
  donors.push({ id: `C${String(1001 + i)}`, first, last, email: `${first}.${last}${i}@example.org`.toLowerCase() });
}
// 136 gifts in whole-cent amounts that add to exactly $8,005.00.
const gifts = [];
let cents = 0;
for (let i = 0; i < 136; i++) {
  const d = donors[i % 60];
  const amt = i === 135 ? 800500 - cents : 2500 + (i % 7) * 1000 + (i % 3) * 25;
  cents += amt;
  const m = 1 + (i % 12), day = 1 + (i % 27);
  gifts.push({ id: d.id, date: `2025-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`, cents: amt, fund: FUNDS[i % 3] });
}
if (cents !== 800500) throw new Error("fixture does not foot");
const last = gifts[135].cents;
if (last <= 0) throw new Error("last gift must be positive");

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Read me"], ["This workbook was exported for the move."], ["Donors lists everyone; Gifts lists every gift by Constituent ID."],
]), "Read Me");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Constituent ID", "First Name", "Last Name", "Email"],
  ...donors.map(d => [d.id, d.first, d.last, d.email]),
]), "Donors");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Constituent ID", "Gift Date", "Amount", "Fund"],
  ...gifts.map(g => [g.id, g.date, g.cents / 100, g.fund]),
  ["TOTAL", "", cents / 100, ""],
]), "Gifts");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Fund", "Budget 2026", "Owner"],
  ["General Fund", 12000, "Finance"], ["Scholarships", 5000, "Programs"], ["Building", 20000, "Board"],
]), "Budget lines");
XLSX.writeFile(wb, path.join(OUT, "people-and-gifts.xlsx"));

fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify({
  "people-and-gifts.xlsx": {
    people: donors.length, gifts: gifts.length, giftCents: cents,
    joinedOn: "Constituent ID", setAsideSheets: ["Read Me", "Budget lines"], totalRowSheet: "Gifts",
  },
}, null, 2) + "\n");
console.log("wrote people-and-gifts.xlsx", donors.length, "people", gifts.length, "gifts", cents, "cents");
