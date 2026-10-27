// tests/fixtures/import/fix52/make.cjs · FIX-52. The 27 Oct event workbook's
// SHAPE, with fake names, addresses and amounts.
//
//   node tests/fixtures/import/fix52/make.cjs   (rewrites event-workbook-shape.xlsx
//                                                and expected.json)
//
// Three sheets, as the real one had:
//   People      a title in row 1, the sheet's own counts in rows 3 to 6
//               ("People 443", "Invited 422", "RSVP'd 230", "Attended (checked
//               in) 172"), then the header and one row per household or person.
//               Some rows are couples ("Pat & Sam Lee"). "3-year total",
//               "Dinner gift total" and "Gave at dinner" are per-person totals.
//   Gifts       one row per gift: the person's ID, the name, an amount and a
//               Status ("Paid" / "Not yet paid"). No dates.
//   Check these review notes about about a quarter of the same people:
//               "Person", "What to check", "How matched". Some of the names are
//               spelled the way the matcher saw them, not the way People has them.
//
// The ANSWER KEY is computed here from the rows this script writes, never by
// shared/sheetRead.js (the BUILD-77 rule).
"use strict";
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "../../../../client/node_modules/xlsx"));
const OUT = __dirname;

const FIRST = ["Rowan", "Imogen", "Silas", "Petra", "Anselm", "Clio", "Dorian", "Esme", "Florian", "Greer", "Hollis", "Ida",
  "Jasper", "Kit", "Linnea", "Magnus", "Nell", "Orrin", "Pia", "Quill", "Rhea", "Soren", "Tilda", "Ulric", "Vida"];
const LAST = ["Abernathy", "Blackwood", "Calloway", "Delacroix", "Eastwick", "Fennimore", "Galloway", "Hartigan", "Islington",
  "Jessup", "Kingsley", "Lockhart", "Merriweather", "Northcott", "Ogilvie", "Pembrook", "Quimby", "Radcliffe", "Stanhope",
  "Thornbury", "Upton", "Vandermeer", "Wexley", "Yardley", "Zeller"];
const c = d => Math.round(d * 100);
const sum = a => a.reduce((x, y) => x + y, 0);

const N = 443;
const people = [];
for (let i = 1; i <= N; i++) {
  // (i mod 25, (7i + ⌊i/25⌋) mod 25) is unique for i < 625
  const first = FIRST[i % 25], last = LAST[(i * 7 + Math.floor(i / 25)) % 25];
  const couple = i % 25 === 0 || i === 41 || i === 61;
  const partner = FIRST[(i + 11) % 25];
  people.push({
    i, id: `HL-${2000 + i}`, first, last, couple, partner,
    name: couple ? `${first} & ${partner} ${last}` : `${first} ${last}`,
    email: i % 8 === 0 ? "" : `${first}.${last}.${i}@example.org`.toLowerCase(),
    phone: `(555) ${String(300 + (i % 600)).padStart(3, "0")}-${String(2000 + i).slice(-4)}`,
    invited: i <= 422, rsvp: i <= 230, attended: i <= 172,
    table: i <= 172 ? 1 + (i % 22) : null, party: i <= 230 ? (couple ? 2 : 1 + (i % 2)) : null,
  });
}
const byI = new Map(people.map(p => [p.i, p]));

// gifts: 63 paid (people 1..55, and 1..8 twice), 43 not yet paid (people 40..82)
const PAID_AMTS = [250, 500, 1000, 100, 750, 1500, 300, 200, 2500, 400, 125, 600];
const OPEN_AMTS = [1000, 2500, 500, 5000, 750, 1500, 250, 3000, 2000, 1200];
const paid = [];
for (let k = 1; k <= 55; k++) paid.push({ person: k });
for (let k = 1; k <= 8; k++) paid.push({ person: k });
paid.forEach((g, j) => { g.amount = PAID_AMTS[j % PAID_AMTS.length]; });
paid[paid.length - 1].amount += 45340 - sum(paid.map(g => g.amount));
const open = [];
for (let k = 40; k <= 82; k++) open.push({ person: k });
open.forEach((g, j) => { g.amount = OPEN_AMTS[j % OPEN_AMTS.length]; });
open[open.length - 1].amount += 78950 - sum(open.map(g => g.amount));
if (paid.some(g => g.amount <= 0) || open.some(g => g.amount <= 0)) throw new Error("an amount went non-positive");

// one gift sheet, the paid and the unpaid interleaved by person
const gifts = [...paid.map(g => ({ ...g, status: "Paid" })), ...open.map(g => ({ ...g, status: "Not yet paid" }))]
  .sort((a, b) => a.person - b.person || (a.status === b.status ? 0 : a.status === "Paid" ? -1 : 1));
const paidBy = new Map(), allBy = new Map();
for (const g of gifts) {
  allBy.set(g.person, (allBy.get(g.person) || 0) + g.amount);
  if (g.status === "Paid") paidBy.set(g.person, (paidBy.get(g.person) || 0) + g.amount);
}

const peopleAoa = [
  ["Harbor Lights Gala 2026 · Guest list"],
  [],
  ["People", N],
  ["Invited", people.filter(p => p.invited).length],
  ["RSVP'd", people.filter(p => p.rsvp).length],
  ["Attended (checked in)", people.filter(p => p.attended).length],
  [],
  ["ID", "Name", "Email", "Phone", "Party size", "Table", "Invited", "RSVP'd", "Attended", "3-year total", "Dinner gift total", "Gave at dinner"],
  ...people.map(p => [p.id, p.name, p.email || null, p.phone, p.party, p.table, p.invited ? "Yes" : "No", p.rsvp ? "Yes" : p.invited ? "No" : null,
    p.attended ? "Yes" : null,
    // three years of the person's giving: more than the dinner, never a gift
    allBy.has(p.i) ? allBy.get(p.i) * 3 : null, allBy.get(p.i) || null, paidBy.get(p.i) || null]),
];
const giftsAoa = [
  ["ID", "Name", "Amount", "Status"],
  ...gifts.map(g => { const p = byI.get(g.person); return [p.id, p.name, g.amount, g.status]; }),
];
// "Check these": a quarter as many rows as People, about people already listed
const checkRows = [];
for (let i = 3; i <= N && checkRows.length < Math.round(N / 4); i += 4) {
  const p = byI.get(i);
  const misspelt = checkRows.length % 5 === 2;
  // the matcher's report writes "Last, First"
  const firstPart = p.couple ? `${p.first} & ${p.partner}` : p.first;
  const shown = misspelt ? `${p.last.slice(0, -1)}, ${p.first}` : `${p.last}, ${firstPart}`;
  checkRows.push([shown,
    ["Two emails on file", "Party size looks high", "No table but RSVP'd yes", "Name spelled two ways", "Gift and pledge both listed"][checkRows.length % 5],
    misspelt ? "Similar name" : ["Email", "Name", "ID"][checkRows.length % 3]]);
}
const checkAoa = [["Person", "What to check", "How matched"], ...checkRows];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(peopleAoa);
ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
XLSX.utils.book_append_sheet(wb, ws, "People");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(giftsAoa), "Gifts");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(checkAoa), "Check these");
XLSX.writeFile(wb, path.join(OUT, "event-workbook-shape.xlsx"));

const giverSet = new Set(paid.map(g => g.person));
const pledgeOnly = new Set(open.map(g => g.person).filter(k => !giverSet.has(k)));
const persons = p => (p.couple ? 2 : 1);
const expected = {
  file: "event-workbook-shape.xlsx",
  // the sheet's own figures, by row
  people: N, invited: people.filter(p => p.invited).length, rsvp: people.filter(p => p.rsvp).length, attended: people.filter(p => p.attended).length,
  // the people those rows are (a couple's row is two)
  persons: sum(people.map(persons)), couples: people.filter(p => p.couple).length,
  rows: N + gifts.length + checkRows.length,
  giftRows: gifts.length,
  gifts: paid.length, giftCents: c(sum(paid.map(g => g.amount))),
  pledges: open.length, pledgeCents: c(sum(open.map(g => g.amount))),
  fileCents: c(sum(gifts.map(g => g.amount))),
  checkRows: checkRows.length,
  donorRecords: giverSet.size, pledgerOnlyRecords: pledgeOnly.size,
  donorIds: [...giverSet].map(k => byI.get(k).id), pledgerOnlyIds: [...pledgeOnly].map(k => byI.get(k).id),
  notesColumns: ["What to check", "How matched"],
};
fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
console.log(JSON.stringify({ ...expected, donorIds: expected.donorIds.length, pledgerOnlyIds: expected.pledgerOnlyIds.length }));
