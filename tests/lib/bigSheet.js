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

module.exports = { bigPeopleRows, bigPeopleCsv };
