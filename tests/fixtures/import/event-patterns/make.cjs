// tests/fixtures/import/event-patterns/make.cjs · FIX-59. One dinner, three lists.
//
// Every name, email and amount is fake. The patterns are the ones seen on a real
// event import on 29 Oct (never its data): the same person spelled two ways on
// the guest list and the seating chart, notes typed into the name column,
// markup and parenthetical notes in names, declined guests, an overfull table,
// attendance marks, an apostrophe in the event's name, and couples written with
// "or" and "and". The ANSWER KEY is computed here from the rows this script
// writes, with the brief's rules applied by hand, never by shared/sheetRead.js
// (the BUILD-77 lesson).
//
//   node tests/fixtures/import/event-patterns/make.cjs   (rewrites the workbook + expected.json)
"use strict";
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "../../../../client/node_modules/xlsx"));
const OUT = __dirname;
const EVENT = "Marigold's Harvest Supper";
const FILE = "Marigold's Harvest Supper.xlsx";

// ── the guest list: one row per invitation, as she typed it ─────────────────
// persons: how many people the row is once read (a couple is two)
// seat: the name as the seating chart writes it, and the table
const ATTENDED = [
  { name: "Tobias Kettering", persons: 1, seat: "Tobias Ketering", table: 1, near: "one letter" },
  { name: "Rosalind Ferreira", persons: 1, seat: "Rosalind Fereira", table: 1, near: "one letter" },
  { name: "Hal Dunmore", persons: 1, seat: "Hal Dunmoore", table: 1, near: "one letter" },
  { name: "Beverly Okonjo", persons: 1, seat: "Bev Okonjo", table: 1, near: "nickname" },
  { name: "Robert Ashdown", persons: 1, seat: "Rob Ashdown", table: 1, near: "nickname" },
  { name: "Susan Brannigan", persons: 1, seat: "Sue Brannigan", table: 1, near: "nickname" },
  { name: "Marisol Quint", persons: 1, seat: "Marisol Quint & Abernathy", table: 1, near: "couple form" },
  { name: "Gideon Pratt", persons: 1, seat: "**Gideon Pratt", table: 1 },                 // markup, stripped: the same name
  { name: "Randolph or Celeste Abara", persons: 2, seat: "Randolph or Celeste Abara", table: 2 },
  { name: "Theo and Lena Marchetti", persons: 2, seat: "Theo and Lena Marchetti", table: 2 },
  { name: "Elizabeth Varga", persons: 1, seat: "Elizabeth Varga", table: 2 },
  { name: "Ada Whitlock", persons: 1, seat: "Ada Whitlock", table: 2, seatNote: "1 Allergy shellfish" },
  { name: "Corwin Bale", persons: 1, seat: "Corwin Bale", table: 2 },
  { name: "Dorothea Penn", persons: 1, seat: "Dorothea Penn", table: 2 },
  { name: "Emil Soto", persons: 1, seat: "Emil Soto", table: 2 },
  { name: "Felicity Grange", persons: 1, seat: "Felicity Grange", table: 2 },
  { name: "Hugo Ramsey", persons: 1, seat: "Hugo Ramsey", table: 2, note: "2 Vegan" },
  { name: "Iris Pemberton", persons: 1, seat: "Iris Pemberton", table: 2 },
  { name: "Jonas Wilde", persons: 1, seat: "Jonas Wilde", table: 2 },
  { name: "Kerry Lusk", persons: 1, seat: "Kerry Lusk", table: 1, note: "1 Medical Gluten" },
  { name: "Lionel Achebe", persons: 1, seat: "Lionel Achebe", table: 3 },
  { name: "Maeve Darrow", persons: 1, seat: "Maeve Darrow", table: 3 },
  { name: "Nadia Fenwick", persons: 1, seat: "Nadia Fenwick", table: 3 },
];
const NO_SHOW = [   // said yes, did not come
  { name: "Oren Blackwood", persons: 1 },
  { name: "Petra Lindgren", persons: 1 },
  { name: "Neil (husband) Martha (daughter) Lyle", persons: 2, clean: "Neil & Martha Lyle", notes: ["husband", "daughter"] },
  { name: "Ivy (send with Harlan's) Brooks", persons: 1, clean: "Ivy Brooks", notes: ["send with Harlan's"] },
  { name: "Quentin Shaw", persons: 1 },
];
const DECLINED = ["Rhea Moss", "Silas Turnbull", "Tamsin Holt", "Una Bexley"].map(name => ({ name, persons: 1 }));
const NO_REPLY = ["Vera Kincaid", "Walter Osei", "Xavier Dunn"].map(name => ({ name, persons: 1 }));

// ── the gifts sheet: Paid Yes is a gift, No a pledge. Names as on the guest list.
const GIFTS = [
  ["Tobias Kettering", 500, "Yes"], ["Beverly Okonjo", 250, "Yes"], ["Robert Ashdown", 1000, "Yes"],
  ["Ada Whitlock", 100, "Yes"], ["Corwin Bale", 250, "Yes"], ["Dorothea Penn", 50, "Yes"],
  ["Jonas Wilde", 1500, "No"], ["Randolph or Celeste Abara", 300, "Yes"],
  ["Oren Blackwood", 200, "Yes"],      // said yes, did not come, gave
  ["Rhea Moss", 100, "Yes"],           // declined, gave anyway
  ["Yusuf Brennan", 75, "Yes"],        // not on the guest list at all
];

const emailOf = n => n.replace(/\(.*?\)/g, "").replace(/\b(or|and)\b|&|\*/g, " ").trim().split(/\s+/).join(".").toLowerCase().replace(/[^a-z.]/g, "") + "@example.test";
const guestAoa = [[`${EVENT} · Guest List`], [], ["Name", "Email", "RSVP", "Attended"]];
for (const g of ATTENDED) {
  guestAoa.push([g.name, emailOf(g.name), "Yes", "X"]);
  if (g.note) guestAoa.push([g.note, "", "", ""]);           // a note typed as a row under its person
}
for (const g of NO_SHOW) guestAoa.push([g.name, emailOf(g.clean || g.name), "Yes", ""]);
for (const g of DECLINED) guestAoa.push([g.name, emailOf(g.name), "Declined", ""]);
for (const g of NO_REPLY) guestAoa.push([g.name, emailOf(g.name), "", ""]);

const seatAoa = [[`${EVENT} · Seating Chart`], [], ["Table", "Guest"]];
for (const t of [1, 2, 3]) for (const g of ATTENDED.filter(x => x.table === t)) {
  seatAoa.push([`Table ${t}`, g.seat]);
  if (g.seatNote) seatAoa.push(["", g.seatNote]);
}
const giftAoa = [["Name", "Amount", "Paid"], ...GIFTS];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guestAoa), "Guest List");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(seatAoa), "Seating Chart");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(giftAoa), "Gifts");
XLSX.writeFile(wb, path.join(OUT, FILE));

// ── the answer key, by hand ─────────────────────────────────────────────────
const sum = a => a.reduce((x, y) => x + y, 0);
const persons = a => sum(a.map(x => x.persons));
const personOf = new Map();   // guest-list name → its persons
for (const g of [...ATTENDED, ...NO_SHOW, ...DECLINED, ...NO_REPLY]) personOf.set(g.name, g.persons);
const came = persons(ATTENDED);
const attendedNames = new Set(ATTENDED.map(g => g.name));
// household-aware: a couple's gift counts both of them as having given
const cameGave = sum(GIFTS.filter(([n]) => attendedNames.has(n)).map(([n]) => personOf.get(n)));
const paid = GIFTS.filter(g => g[2] === "Yes"), owed = GIFTS.filter(g => g[2] === "No");
const tableSizes = {};
for (const g of ATTENDED) tableSizes[`Table ${g.table}`] = (tableSizes[`Table ${g.table}`] || 0) + g.persons;
const near = ATTENDED.filter(g => g.near);
// FIX-58 + FIX-59 (Jonathan, 29 Oct): Registered is each person who said yes or
// came; Invited is the whole list; No reply = Invited − Registered − Declined.
const registered = came + persons(NO_SHOW);
const invited = registered + persons(DECLINED) + persons(NO_REPLY);
// Gave is household-aware (FIX-58): each person with their own gift or pledge,
// and each guest who came whose household gave (both of a couple who came).
const gaveNames = new Set(GIFTS.map(g => g[0]));
const gave = sum([...gaveNames].map(n => attendedNames.has(n) ? personOf.get(n) : 1));
const gaveNotCame = sum([...gaveNames].filter(n => !attendedNames.has(n)).map(() => 1));
const expected = {
  file: FILE,
  eventName: EVENT,
  sheets: { guestListRows: guestAoa.length - 3, seatingRows: seatAoa.length - 3, giftRows: GIFTS.length },
  // every person once, after the near-duplicate questions are answered with their default (Same person)
  persons: persons([...ATTENDED, ...NO_SHOW, ...DECLINED, ...NO_REPLY]) + 1,   // + Yusuf Brennan, gifts only
  // the event's figures, in people (a couple is two). They add up:
  //   invited = registered + declined + noReply; registered = came + saidYesDidntCome;
  //   came = cameGave + cameDidntGive; gave = cameGave + gaveNotCame
  figures: {
    invited,                                      // everyone on the list
    registered,                                   // said yes or came
    declined: persons(DECLINED),
    noReply: invited - registered - persons(DECLINED),
    came,
    saidYesDidntCome: registered - came,          // was "Invited, didn't come"
    gave,
    cameGave,
    gaveNotCame,
    cameDidntGive: came - cameGave,
    checkedIn: came,                              // an imported attendance mark counts as checked in
  },
  note: "Changed after the build, by Jonathan's ruling on 29 Oct when FIX-58 and FIX-59 met: Gave is household-aware (11 -> 12: Celeste Abara came and her household gave), Registered is said yes or came (34 -> 31), and Invited, Declined and No reply are shown. Everything else is as written before the build.",
  money: {
    gifts: paid.length, giftCents: sum(paid.map(g => g[1] * 100)),
    pledges: owed.length, pledgeCents: sum(owed.map(g => g[1] * 100)),
    notYetDepositedAfterYes: 0,                   // "Were these already deposited?" Yes (the default)
  },
  tables: tableSizes,                             // the chart's own sizes: none reads "12 of 10"
  overfullAtDefault: Object.entries(tableSizes).filter(([, n]) => n > 10).map(([t, n]) => ({ table: t, seated: n, over: n - 10 })),
  nearDuplicates: near.map(g => ({ guestList: g.name, seatingChart: g.seat, why: g.near, default: "same" })),
  notesAsRows: [
    ...ATTENDED.filter(g => g.note).map(g => ({ text: g.note, sheet: "Guest List", attachesTo: g.name })),
    ...ATTENDED.filter(g => g.seatNote).map(g => ({ text: g.seatNote, sheet: "Seating Chart", attachesTo: g.name })),
  ],
  namesCleaned: [
    { from: "**Gideon Pratt", name: "Gideon Pratt", note: null },
    ...NO_SHOW.filter(g => g.clean).map(g => ({ from: g.name, name: g.clean, note: g.notes.join("; ") })),
  ],
  couples: [
    { from: "Randolph or Celeste Abara", people: ["Randolph Abara", "Celeste Abara"] },
    { from: "Theo and Lena Marchetti", people: ["Theo Marchetti", "Lena Marchetti"] },
    { from: "Neil (husband) Martha (daughter) Lyle", people: ["Neil Lyle", "Martha Lyle"] },
  ],
  // the questions the preview asks on this file, besides the columns
  questions: ["event (its date: the file has none)", "useEventDate", "pledgeDue", `nearDuplicates (${near.length} pairs, one pass)`, "giftsDeposited (Yes by default)"],
};
fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
console.log(JSON.stringify(expected.figures), expected.persons);
