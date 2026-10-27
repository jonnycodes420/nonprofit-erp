// tests/fixtures/import/import4/make.cjs · IMPORT-4. The layered set.
//
// Every name, address and amount is fake. Each file's ANSWER KEY is computed
// here from the rows this script writes, with the brief's rules applied by
// hand, never by shared/sheetRead.js (the BUILD-77 lesson, kept by IMPORT-3).
//
//   node tests/fixtures/import/import4/make.cjs   (rewrites the files + expected.json,
//                                                  and ../event-guest-list-scrubbed.xlsx)
//
// The combined workbook is the 26 Oct shape: a People sheet with a shared ID,
// Invited / RSVP / Attended / Table / Mailing List columns, and a Gifts sheet
// whose Date column is blank, with "Not yet received" and "x 3 years" rows,
// misspelled and swapped names, a placeholder phone on 30 people and a totals row.
"use strict";
const fs = require("fs");
const path = require("path");
const XLSX = require(path.join(__dirname, "../../../../client/node_modules/xlsx"));
const OUT = __dirname;

const FIRST = ["Alma", "Theo", "Priya", "Jonah", "Lucinda", "Omar", "Beatrice", "Felix", "Harriet", "Marcus", "Ines", "Gordon",
  "Tamsin", "Elliot", "Wren", "Desmond", "Rosalind", "Caspian", "Odette", "Barnaby", "Leonie", "Tobias", "Marisol"];
const LAST = ["Arnold", "Bennett", "Castillo", "Dawson", "Ellison", "Fairbanks", "Garner", "Holloway", "Ibarra", "Jennings",
  "Kowalski", "Langford", "Mercer", "Nakamura", "Okafor", "Prescott", "Quintero", "Rasmussen", "Sorensen", "Thackeray",
  "Underhill", "Valdivia", "Whitlock"];
const c = d => Math.round(d * 100);
const sum = a => a.reduce((x, y) => x + y, 0);
const csvCell = v => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = aoa => aoa.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
function writeBook(file, sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa);
    if (s.merges) ws["!merges"] = s.merges;
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, file);
}
const expected = {};

// ── 1 · Finding_Joy_Combined.xlsx ─────────────────────────────────────────
{
  const N = 443;
  const PLACEHOLDER = "(555) 010-0000";
  const people = [];
  for (let i = 1; i <= N; i++) {
    const first = FIRST[i % FIRST.length], last = LAST[(i * 5 + Math.floor(i / FIRST.length)) % LAST.length];
    // every (first, last) pair is unique: i ↦ (i mod 23, (5i + ⌊i/23⌋) mod 23) never repeats under 529
    const couple = i % 37 === 0 && i > 172;            // never among the guests who came
    const firstCell = couple ? `${first} & ${FIRST[(i + 7) % FIRST.length]}` : first;
    const email = i % 9 === 0 ? "" : `${first}.${last}${i}@example.org`.toLowerCase();
    const phone = i % 15 === 1 ? PLACEHOLDER : `(555) ${String(200 + (i % 700)).padStart(3, "0")}-${String(1000 + i).slice(-4)}`;
    const zipLost = i % 50 === 7;
    people.push({
      i, id: `JP-${1000 + i}`, first: firstCell, last, email, phone, couple,
      address: `${100 + i} Harbor Lane`, city: "Boston", state: "MA", zip: zipLost ? "2134" : String(10000 + (i * 37) % 89999).padStart(5, "0"),
      invited: i <= 400, rsvp: i <= 190, attended: i <= 172, table: i <= 172 ? `Table ${1 + (i % 20)}` : "", party: i <= 172 ? 1 + (i % 3) : "",
      mailing: [50, 120, 300].includes(i) ? "Unsubscribed" : i === 210 ? "please remove me" : i % 11 === 0 ? "" : "Yes",
      dnc: i === 334, volunteer: i % 17 === 0, shirt: ["S", "M", "L", "XL", ""][i % 5], dietary: i % 13 === 0 ? "Vegetarian" : i % 29 === 0 ? "Gluten free" : "",
      notes: i === 42 ? "Sat with the Okafors last year" : "",
    });
  }
  // gifts: 100 one-time (donors 1..98, and donors 1 and 2 twice), 6 "x 3 years"
  // received (donors 99..104), 2 "Not yet received" (people 105, 106)
  const ONE = [100, 250, 500, 1000, 50, 2000, 150, 75, 300, 5000, 125, 400];
  const gifts = [];
  const giftDonors = [];
  for (let k = 1; k <= 98; k++) giftDonors.push(k);
  giftDonors.push(1, 2);
  giftDonors.forEach((k, j) => gifts.push({ person: k, amount: ONE[j % ONE.length], freq: "Once", status: "Received" }));
  const target1 = 124290 - 12500;                      // the one-time gifts sum to $111,790
  gifts[gifts.length - 1].amount += target1 - sum(gifts.map(g => g.amount));
  const A = [5000, 2500, 2500, 1000, 1000, 500];
  A.forEach((a, j) => gifts.push({ person: 99 + j, amount: a, freq: "x 3 years", status: "Received" }));
  const B = [50000, 3950];
  B.forEach((b, j) => gifts.push({ person: 105 + j, amount: b, freq: "Once", status: "Not yet received" }));
  const METHODS = ["Check", "Credit", "Online", "Cash", "Stock", "IRA", "DAF", "Online (Miss)", "UNKNOWN", "Check"];
  const byPerson = new Map(people.map(p => [p.i, p]));
  const giftRows = gifts.map((g, j) => {
    const p = byPerson.get(g.person);
    // the Gifts sheet's names are the clipboard's: "Last, First", sometimes
    // misspelled, sometimes first and last swapped. The ID is what links them.
    let name = `${p.last}, ${p.first}`;
    if (j % 25 === 3) name = `${p.last.slice(0, -1)}, ${p.first}`;
    if (j % 31 === 5) name = `${p.last} ${p.first}`;
    return [p.id, name, g.amount, null, METHODS[j % METHODS.length], g.status, g.freq, j % 7 === 0 ? "Scholarships" : "General"];
  });
  const fileMoney = sum(gifts.map(g => g.amount));
  const gaveAt = new Map();
  for (const g of gifts) if (g.status === "Received") gaveAt.set(g.person, (gaveAt.get(g.person) || 0) + g.amount);
  const peopleAoa = [
    ["Finding Joy Dinner · Guest List"], [],
    ["ID", "First", "Last", "Email", "Phone", "Address", "City", "State", "Zip", "Invited", "RSVP", "Attended", "Table", "Party Size",
     "Mailing List", "Do Not Contact", "Volunteer", "Shirt Size", "Dietary", "Gave at dinner", "Notes"],
    ...people.map(p => [p.id, p.first, p.last, p.email || null, p.phone, p.address, p.city, p.state, p.zip,
      p.invited ? "Yes" : null, p.rsvp ? "Yes" : p.invited ? "No" : null, p.attended ? "Yes" : p.rsvp ? "No" : null, p.table || null, p.party || null,
      p.mailing || null, p.dnc ? "Yes" : null, p.volunteer ? "x" : null, p.shirt || null, p.dietary || null,
      gaveAt.get(p.i) || null, p.notes || null]),
  ];
  const giftsAoa = [
    ["ID", "Name", "Amount", "Date", "Method", "Status", "Frequency", "Fund"],
    ...giftRows,
    [null, "TOTAL", fileMoney, null, null, null, null, null],
    [],
    ["Gave at dinner figures are from the clipboard, see Summary."],
  ];
  const summaryAoa = [["Finding Joy Dinner summary"], [], ["Item", "Total"], ["Gave at dinner", 124290], ["Pledged, not yet received", 53950], ["Guests", 172]];
  writeBook(path.join(OUT, "Finding_Joy_Combined.xlsx"), [
    { name: "People", aoa: peopleAoa, merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }] },
    { name: "Gifts", aoa: giftsAoa },
    { name: "Summary", aoa: summaryAoa },
  ]);
  const received = gifts.filter(g => g.status === "Received");
  const notYet = gifts.filter(g => g.status !== "Received");
  expected["Finding_Joy_Combined.xlsx"] = {
    records: N, persons: N + people.filter(p => p.couple).length, households: people.filter(p => p.couple).length,
    donors: new Set(received.map(g => g.person)).size,
    gifts: received.length, giftCents: c(sum(received.map(g => g.amount))), undatedGifts: received.length,
    pledges: A.length + B.length, pledgeOpenCents: c(2 * sum(A) + sum(B)),
    pledgeTotalCents: c(3 * sum(A) + sum(B)),
    fileCents: c(fileMoney), notYetCents: c(sum(notYet.map(g => g.amount))), totalsRowCents: c(fileMoney),
    eventName: "Finding Joy Dinner", invited: people.filter(p => p.invited).length, rsvp: people.filter(p => p.rsvp).length,
    attended: people.filter(p => p.attended).length, optOuts: 4, doNotContact: 1, volunteers: people.filter(p => p.volunteer).length,
    placeholderPhone: PLACEHOLDER, placeholderPeople: people.filter(p => p.phone === PLACEHOLDER).length,
    zipsFixed: people.filter(p => p.zip.length === 4).length,
    columns: { total: 21 + 8 + 2, mapped: 18 + 7, kept: 2, skipped: 1 + 1 + 2 },
    kept: ["Shirt Size", "Dietary"],
    aside: 0,
    // a sample person with every layer: a donor, a guest, a volunteer would be
    // best; JP-1017 gave, came (Table 18) and volunteers
    sample: { id: "JP-1017", gaveCents: c(gaveAt.get(17)), table: "Table 18", volunteer: true },
    pledgeSample: { id: "JP-1099", totalCents: c(15000), receivedCents: c(5000), openCents: c(10000) },
  };
}

// ── 2 · event-guest-list-scrubbed.xlsx, the guest list for the gift sheet ─
// Every person on ../event-gifts-sheet-scrubbed.xlsx, plus 60 who came or were
// asked and gave nothing. Imported before or after the gift sheet, the same
// people result.
{
  const src = path.join(OUT, "..", "event-gifts-sheet-scrubbed.xlsx");
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(src).Sheets.Sheet1, { header: 1, defval: null, raw: true }).slice(1).filter(r => r[0]);
  const guests = [];
  let persons = 0;
  for (const r of rows) {
    const first = String(r[1]).trim(), last = String(r[0]).trim();
    persons += /&/.test(first) ? 2 : 1;
    guests.push({ name: `${first} ${last}`, email: /&/.test(first) ? null : `${first}.${last}@example.net`.toLowerCase(), attended: true });
  }
  for (let k = 0; k < 60; k++) {
    const first = FIRST[(k * 3 + 1) % FIRST.length], last = LAST[(k * 7 + 2) % LAST.length] + "e";   // never a gift-sheet last name
    guests.push({ name: `${first} ${last}`, email: `${first}.${last}${k}@example.net`.toLowerCase(), attended: k < 30 });
    persons += 1;
  }
  const aoa = [["Guest Name", "Email", "Invited", "RSVP", "Attended", "Table", "Guests", "Name Tag"],
    ...guests.map((g, j) => [g.name, g.email, "Yes", g.attended ? "Yes" : "No", g.attended ? "Yes" : "No", g.attended ? String(1 + (j % 14)) : null,
      g.attended ? 1 + (j % 2) : null, g.attended ? "Printed" : null])];
  writeBook(path.join(OUT, "..", "event-guest-list-scrubbed.xlsx"), [{ name: "Guests", aoa }]);
  expected["event-guest-list-scrubbed.xlsx"] = { records: guests.length, persons, attended: guests.filter(g => g.attended).length,
    invited: guests.length, gifts: 0, giftCents: 0, columns: { total: 8, mapped: 8, kept: 0, skipped: 0 },
    giftSheetPersons: persons - 60 };
}

// ── 3 · Volunteers.xlsx: hours and roles ──────────────────────────────────
{
  const aoa = [["Name", "Email", "Phone", "Role", "Hours", "Shifts", "Availability", "Skills"]];
  for (let k = 0; k < 26; k++) {
    const first = FIRST[(k * 5 + 2) % FIRST.length], last = LAST[(k * 3 + 4) % LAST.length] + "s";
    aoa.push([`${first} ${last}`, `${first}.${last}.v${k}@example.com`.toLowerCase(), null, ["Greeter", "Setup", "Kitchen", "Tutor"][k % 4],
      4 + (k % 9), 1 + (k % 4), ["Weekends", "Evenings", "Any"][k % 3], k % 2 ? "Spanish" : null]);
  }
  writeBook(path.join(OUT, "Volunteers.xlsx"), [{ name: "Volunteers", aoa }]);
  expected["Volunteers.xlsx"] = { records: 26, persons: 26, volunteers: 26, donors: 0, gifts: 0, giftCents: 0,
    columns: { total: 8, mapped: 2, kept: 5, skipped: 1 }, hoursTotal: sum(aoa.slice(1).map(r => r[4])) };
}

// ── 4 · Contacts_no_volunteers.csv: people only, no gifts, no volunteer data
{
  const aoa = [["Name", "Email", "Phone", "Newsletter"]];
  for (let k = 0; k < 20; k++) {
    const first = FIRST[(k * 7 + 5) % FIRST.length], last = LAST[(k * 11 + 1) % LAST.length] + "ton";
    aoa.push([`${first} ${last}`, `${first}.${last}.c${k}@example.com`.toLowerCase(), `(555) 300-${String(2000 + k)}`, k === 3 ? "Unsubscribed" : "Yes"]);
  }
  fs.writeFileSync(path.join(OUT, "Contacts_no_volunteers.csv"), toCsv(aoa));
  expected["Contacts_no_volunteers.csv"] = { records: 20, persons: 20, volunteers: 0, donors: 0, gifts: 0, giftCents: 0, optOuts: 1,
    columns: { total: 4, mapped: 4, kept: 0, skipped: 0 } };
}

// ── 5 · ten deliberately ugly files ───────────────────────────────────────
// Each key: persons (records × members), gifts (count, cents, undated), the
// money set aside, and the column account. `fileCents` is every amount cell
// that is not a total line.
const ugly = (name, write, key) => { write(path.join(OUT, name)); expected[name] = { ugly: true, ...key }; };

ugly("u01-merged-title-header-row-6.xlsx", f => {
  const aoa = [["HARBORLIGHT FRIENDS"], ["Spring appeal results"], ["Prepared by the office"], [], [],
    ["Donor", "Gift", "Received", "Appeal"],
    ["Alma Arnold", 100, "Oct 2026", "Spring"], ["Theo Bennett", 250, "03/14/2026", "Spring"],
    ["Priya Castillo", 75, "FY26", "Spring"], ["Jonah Dawson", 40, 46100, "Spring"]];
  writeBook(f, [{ name: "Results", aoa, merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }] }]);
}, { persons: 4, gifts: 4, giftCents: c(465), undatedGifts: 1, asideCents: 0, fileCents: c(465), columns: { total: 4, mapped: 4, kept: 0, skipped: 0 } });

ugly("u02-amount-grammar.csv", f => fs.writeFileSync(f, toCsv([["Name", "Amount", "Date"],
  ["Wren Mercer", "$1,000", "2026-02-01"], ["Felix Okafor", "1k", "2026-02-02"], ["Ines Prescott", "(50.00)", "2026-02-03"],
  ["Gordon Quintero", "in-kind $500", "2026-02-04"], ["Tamsin Rasmussen", "USD 25", "2026-02-05"], ["Elliot Sorensen", "$ 75.50", "2026-02-06"]])),
// a refund line alone makes nobody a record (IMPORT-3), so Ines is not a person
{ persons: 5, gifts: 5, giftCents: c(1000 + 1000 + 500 + 25 + 75.5), undatedGifts: 0, asideCents: c(-50), fileCents: c(1000 + 1000 - 50 + 500 + 25 + 75.5),
  inKind: 1, columns: { total: 3, mapped: 3, kept: 0, skipped: 0 } });

ugly("u03-names-every-way.csv", f => fs.writeFileSync(f, toCsv([["Name", "Amount", "Date"],
  ["Smith, John", 100, "2026-04-01"], ["Mr. & Mrs. Paul Abbott", 200, "2026-04-02"], ["Sherry & Mike Akers", 300, "2026-04-03"],
  ["DR. JANE DOE", 400, "2026-04-04"], ["  mary   o'neil ", 50, "2026-04-05"]])),
{ persons: 1 + 1 + 2 + 1 + 1, households: 2, gifts: 5, giftCents: c(1050), undatedGifts: 0, asideCents: 0, fileCents: c(1050),
  columns: { total: 3, mapped: 3, kept: 0, skipped: 0 } });

ugly("u04-placeholder-contact.csv", f => {
  const aoa = [["Name", "Email", "Phone", "Amount", "Date"]];
  for (let k = 0; k < 12; k++) aoa.push([`${FIRST[k]} ${LAST[k + 5]}`, "info@helpinghands.org", "(555) 010-0000", 20 + k, "2026-05-01"]);
  fs.writeFileSync(f, toCsv(aoa));
}, { persons: 12, gifts: 12, giftCents: c(sum([...Array(12)].map((_, k) => 20 + k))), undatedGifts: 0, asideCents: 0,
  fileCents: c(sum([...Array(12)].map((_, k) => 20 + k))), placeholderEmail: "info@helpinghands.org", columns: { total: 5, mapped: 5, kept: 0, skipped: 0 } });

ugly("u05-please-remove-anywhere.csv", f => fs.writeFileSync(f, toCsv([["Name", "Email", "Amount", "Date", "Do not mail", "Notes"],
  ["Odette Underhill", "odette@example.org", 60, "2026-06-01", null, "please remove me from your list"],
  ["Barnaby Valdivia", "barnaby@example.org", 70, "2026-06-02", "Yes", null],
  ["Leonie Whitlock", "leonie@example.org", 80, "2026-06-03", null, "Lovely evening"]])),
{ persons: 3, gifts: 3, giftCents: c(210), undatedGifts: 0, asideCents: 0, fileCents: c(210), optOuts: 1, doNotMail: 1,
  columns: { total: 6, mapped: 6, kept: 0, skipped: 0 } });

ugly("u06-zips-and-phones.csv", f => fs.writeFileSync(f, toCsv([["First Name", "Last Name", "Zip", "Phone", "Amount", "Date"],
  ["Tobias", "Arnold", "2134", "555.123.4567", 10, "2026-07-01"], ["Marisol", "Bennett", "02134-1234", "+1 (555) 123 4568", 20, "2026-07-02"],
  ["Rosalind", "Castillo", "7030", "5551234569", 30, "2026-07-03"]])),
{ persons: 3, gifts: 3, giftCents: c(60), undatedGifts: 0, asideCents: 0, fileCents: c(60), zips: ["02134", "02134-1234", "07030"],
  columns: { total: 6, mapped: 6, kept: 0, skipped: 0 } });

ugly("u07-two-tables-notes-under.xlsx", f => {
  const aoa = [["Name", "Email", null, "Donor", "Amount", "Date"],
    ["Caspian Dawson", "caspian@example.org", null, "Caspian Dawson", 500, "2026-08-01"],
    ["Odette Ellison", "odette.e@example.org", null, "Odette Ellison", 250, "2026-08-02"],
    ["Leonie Fairbanks", "leonie.f@example.org", null, null, null, null],
    [], [], ["Note: Leonie pledged at the door, see the binder."]];
  writeBook(f, [{ name: "Sheet1", aoa }]);
}, { persons: 3, gifts: 2, giftCents: c(750), undatedGifts: 0, asideCents: 0, fileCents: c(750), columns: { total: 5, mapped: 5, kept: 0, skipped: 0 } });

ugly("u08-subtotals-and-a-short-total.xlsx", f => {
  const aoa = [["Month", "Name", "Amount", "Date"],
    ["January", null, null, null], [null, "Harriet Garner", 100, "2026-01-05"], [null, "Marcus Holloway", 200, "2026-01-09"],
    [null, "Subtotal January", 300, null],
    ["February", null, null, null], [null, "Ines Ibarra", 150, "2026-02-03"], [null, "Gordon Jennings", -50, "2026-02-04"],
    [null, "Subtotal February", 100, null],
    [null, "Grand Total", 400, null]];
  writeBook(f, [{ name: "Ledger", aoa }]);
}, { persons: 3, gifts: 3, giftCents: c(450), undatedGifts: 0, asideCents: c(-50), fileCents: c(400), totalsRowCents: c(400),
  columns: { total: 4, mapped: 3, kept: 0, skipped: 1 } });

ugly("u09-some-dates-blank.csv", f => fs.writeFileSync(f, toCsv([["Name", "Amount", "Date"],
  ["Tamsin Kowalski", 45, "2026-09-01"], ["Elliot Langford", 55, null], ["Wren Nakamura", 65, "2026-09-03"], ["Desmond Okafor", 75, null]])),
{ persons: 4, gifts: 4, giftCents: c(240), undatedGifts: 2, asideCents: 0, fileCents: c(240), columns: { total: 3, mapped: 3, kept: 0, skipped: 0 } });

ugly("u10-many-unknown-columns.csv", f => fs.writeFileSync(f, toCsv([
  ["Name", "Email", "Amount", "Date", "T-shirt", "Allergies", "Favorite program", "Referred by", "Parking pass", "Pronouns", "Locker #", "Bus route"],
  ["Rosalind Prescott", "ros@example.org", 30, "2026-10-01", "M", "Peanuts", "Reading circle", "Odette", "Yes", "she/her", "14", "39"],
  ["Caspian Quintero", "cas@example.org", 40, "2026-10-02", "L", null, "Homework club", null, "No", "he/him", "15", "39"]])),
{ persons: 2, gifts: 2, giftCents: c(70), undatedGifts: 0, asideCents: 0, fileCents: c(70), columns: { total: 12, mapped: 4, kept: 8, skipped: 0 } });

fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
console.log(`wrote ${Object.keys(expected).length} files and expected.json`);
