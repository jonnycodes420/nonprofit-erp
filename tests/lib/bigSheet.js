// tests/lib/bigSheet.js · IMPORT-7. A ONE-SHEET LIST OF MADE-UP PEOPLE, AS BIG
// AS ASKED. Every name, street and email is generated from a seed (no real
// person, no real customer file), so the same call is the same file. Each row
// is a different person: a unique email and a unique first + last name, so the
// matcher has nothing to fold and every row is a person written.
//
//   bigPeopleCsv(25000)                        ~1.9 MB, the exit test's 25k
//   bigPeopleCsv(25000, { notesChars: 1500 })  a 25k file near the 50 MB body
"use strict";

const FIRST = ["Avery", "Brin", "Calder", "Dace", "Elowen", "Farris", "Gale", "Hollis", "Isel", "Jory", "Kestra", "Lark",
  "Merrin", "Nolan", "Orla", "Pell", "Quill", "Rowan", "Sable", "Tamsin", "Ulric", "Vesper", "Wren", "Xan", "Yarrow", "Zell",
  "Ansel", "Bexley", "Corin", "Darby", "Emrys", "Fen", "Greer", "Haddon", "Ives", "Juno", "Kit", "Lio", "Marlo", "Neve"];
const LAST = ["Ashgrove", "Brackwell", "Cindermoor", "Dunlevy", "Eastholm", "Fallowmere", "Greystan", "Harrowgate", "Ivelund",
  "Jessamy", "Kettleburn", "Larchmont", "Mossbridge", "Nethercott", "Oakhaven", "Pellingham", "Quarrington", "Rookwood",
  "Saltmarsh", "Thistlewood", "Underhay", "Vantreese", "Wexcombe", "Yarborough", "Zennor", "Alderney", "Birchley", "Copperfield",
  "Dovecote", "Elmstead", "Fernleigh", "Gorsedene", "Hollowell", "Inchmore", "Juniper", "Kingsmere", "Lindenfield", "Marrowby"];
const STREET = ["Bramble", "Cedar Hollow", "Driftwood", "Elderberry", "Foxglove", "Gullwing", "Heron", "Ironwood", "Juniper", "Kestrel"];
const CITY = [["Marlow Bay", "ME", "04011"], ["Pinecrest", "VT", "05401"], ["Ashby Falls", "NH", "03031"], ["Calder Point", "MA", "01923"]];
const WORDS = "volunteered at the spring fair asked about the youth program met at the open house prefers a call in the evening".split(" ");

// A seeded word of filler, so the 50 MB file is the same file each run.
function filler(n, seed) {
  let out = "", i = seed;
  while (out.length < n) { out += WORDS[i % WORDS.length] + " "; i = (i * 31 + 7) % 9973; }
  return out.slice(0, n).trim();
}
const q = s => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function bigPeopleRows(n, { notesChars = 0 } = {}) {
  const header = ["First Name", "Last Name", "Email", "Phone", "Street", "City", "State", "ZIP"].concat(notesChars ? ["Notes"] : []);
  const rows = [header];
  for (let i = 0; i < n; i++) {
    const f = FIRST[i % FIRST.length], l = LAST[Math.floor(i / FIRST.length) % LAST.length];
    // a number on every name past the first pass, so no two rows are one person
    const tag = Math.floor(i / (FIRST.length * LAST.length));
    const last = tag ? `${l}-${String.fromCharCode(65 + (tag % 26))}${tag}` : l;
    const [city, st, zip] = CITY[i % CITY.length];
    const row = [f, last, `p${i}.${f.toLowerCase()}@bigsheet.example`, `${207 + Math.floor(i / 10000)}-555-${String(i % 10000).padStart(4, "0")}`,
      `${100 + (i % 900)} ${STREET[i % STREET.length]} Lane`, city, st, zip];
    if (notesChars) row.push(filler(notesChars, i));
    rows.push(row);
  }
  return rows;
}
function bigPeopleCsv(n, opts = {}) {
  return bigPeopleRows(n, opts).map(r => r.map(c => q(String(c))).join(",")).join("\n") + "\n";
}

// IMPORT-7 · ONE SHEET OF GIFTS, one row per gift, `people` made-up givers
// spread over `gifts` rows (the shape of a 1,000-donor test file: 1,005 people,
// 5,010 gifts), with a method word on some rows so the gift type is read.
function bigGiftRows(people, gifts) {
  const rows = [["First Name", "Last Name", "Email", "Amount", "Date", "Payment Method", "Fund"]];
  const METHOD = ["Check", "Credit Card", "Stock", "Cash", "ACH"];
  for (let i = 0; i < gifts; i++) {
    const p = i % people;
    const f = FIRST[p % FIRST.length], l = LAST[Math.floor(p / FIRST.length) % LAST.length];
    const tag = Math.floor(p / (FIRST.length * LAST.length));
    const month = 1 + (i % 12), day = 1 + (i % 27), year = 2022 + (i % 4);
    rows.push([f, tag ? `${l}-${tag}` : l, `g${p}.${f.toLowerCase()}@bigsheet.example`, String(25 + (i % 40) * 5),
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, METHOD[i % METHOD.length], i % 3 ? "General" : "Youth Program"]);
  }
  return rows;
}


// IMPORT-8 · THE 1,005-ROW PEOPLE + GIFTS WORKBOOK, made up, shaped like the
// file walked on 3-4 Nov: a People sheet (Do not email, About them, Tags,
// Spouse/Partner) and a Gifts sheet. Its answer key is computed here, from its
// own rows, never from the reader (the BUILD-77 lesson).
//   people       distinct people (1,000)
//   dupRows      extra rows that repeat another row's email (5): 1,005 rows
//   dne          people marked "Do not email: Yes" (36), from the first
//   emailOnly    people whose About note reads "Asked for no more mail, email
//                only" (16): they WANT email; taken after the 36, never one of them
//   gifts        gift rows on the Gifts sheet (5,010), round-robin over people
//   lifetime     a Lifetime column on the People sheet (the sum of their gifts,
//                plus `lifetimeOff` cents on the first person, to flag a difference)
//   household    a Household Name column: people in pairs share one and a street
//   peopleSheet / giftSheet   sheet names
function testWorkbookSheets({ people = 1000, dupRows = 5, dne = 36, emailOnly = 16, gifts = 5010, lifetime = false, lifetimeOff = 0,
  household = false, peopleSheet = "People", giftSheet = "Gifts", seedTag = "wb" } = {}) {
  const P = [];
  for (let i = 0; i < people; i++) {
    const f = FIRST[i % FIRST.length], l = LAST[Math.floor(i / FIRST.length) % LAST.length];
    const tag = Math.floor(i / (FIRST.length * LAST.length));
    const last = tag ? `${l}-${String.fromCharCode(65 + (tag % 26))}${tag}` : l;
    const hh = household ? Math.floor(i / 2) : i;
    const [city, st, zip] = CITY[hh % CITY.length];
    P.push({ i, first: f, last, email: `${seedTag}${i}.${f.toLowerCase()}@workbook.example`,
      phone: `${301 + Math.floor(i / 10000)}-555-${String(i % 10000).padStart(4, "0")}`,
      street: `${100 + (hh % 900)} ${STREET[hh % STREET.length]} Way`, city, st, zip,
      dne: i < dne, emailOnly: i >= dne && i < dne + emailOnly, cents: 0, gifts: 0,
      household: household ? `${LAST[(hh * 7) % LAST.length]} Household ${hh}` : null });
  }
  const G = [["First Name", "Last Name", "Email", "Amount", "Date", "Payment Method", "Fund"]];
  const METHOD = ["Check", "Credit Card", "Cash", "ACH"];
  for (let k = 0; k < gifts; k++) {
    const p = P[k % people];
    const amt = 25 + (k % 40) * 5;
    p.cents += amt * 100; p.gifts++;
    const month = 1 + (k % 12), day = 1 + (k % 27), year = 2022 + (k % 4);
    G.push([p.first, p.last, p.email, String(amt), `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, METHOD[k % METHOD.length], k % 3 ? "General" : "Youth Program"]);
  }
  const head = ["First Name", "Last Name", "Email", "Phone", "Street", "City", "State", "ZIP", "Tags", "Do not email", "About them"]
    .concat(household ? ["Household Name"] : []).concat(lifetime ? ["Lifetime"] : []);
  const rowOf = (p, dup) => {
    const r = [p.first, p.last, p.email, p.phone, p.street, p.city, p.st, p.zip, p.i % 9 === 0 ? "Volunteer; Newsletter" : "",
      p.dne ? "Yes" : (p.i % 2 ? "No" : ""),
      p.emailOnly ? "Asked for no more mail, email only" : (p.i % 11 === 0 ? "Met at the spring fair" : "")];
    if (household) r.push(p.household);
    if (lifetime) r.push(((p.cents + (p.i === 0 ? lifetimeOff : 0)) / 100).toFixed(2));
    if (dup) r[3] = "";   // the repeat row has the email and name, no phone
    return r;
  };
  const rows = [head];
  for (const p of P) rows.push(rowOf(p, false));
  // the repeat rows: the same email as an earlier person, a later line
  const dups = [];
  for (let d = 0; d < dupRows; d++) { const p = P[100 + d * 37]; rows.push(rowOf(p, true)); dups.push(p.email); }
  return {
    sheets: [{ name: peopleSheet, grid: rows }, { name: giftSheet, grid: G }],
    key: { rows: people + dupRows, people, dupEmails: dups, dneEmails: P.filter(p => p.dne).map(p => p.email),
      emailOnlyEmails: P.filter(p => p.emailOnly).map(p => p.email), gifts, giftCents: P.reduce((a, p) => a + p.cents, 0),
      households: household ? Math.ceil(people / 2) : 0, person: P },
  };
}

module.exports = { bigPeopleRows, bigPeopleCsv, bigGiftRows, testWorkbookSheets };
