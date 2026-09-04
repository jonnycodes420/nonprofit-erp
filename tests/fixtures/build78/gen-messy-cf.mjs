// BUILD-78 Part 8 — THE CUSTOM-FIELD FIXTURE GENERATOR. Seeded (20260905),
// deterministic, and written as windows-1252 BYTES (the overwhelmingly
// common non-UTF8 nonprofit export encoding) so the mojibake-repair path is
// exercised for real. steward-messy-2500.csv (seed 20260904) is a frozen
// golden and is NOT touched; this file sits beside it in CI.
//
// Every custom column exists because it broke something real or because it
// is the trap (spec Part 8's table). The 22 physical columns:
//   8 core-mappable · 8 custom · 1 exclusion-shaped (Deceased? — THE trap)
//   · Legacy ID + a duplicate Notes header (explicit discards) · 1 blank
//   header · +2 orphan overflow cells on one malformed row.
// Regenerate: node tests/fixtures/build78/gen-messy-cf.mjs
import fs from "fs";
const OUT = new URL("./steward-messy-cf.csv", import.meta.url).pathname;

// mulberry32 — seed 20260905
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260905);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const chance = p => rnd() < p;

const FIRST = ["Aaron","Beth","Carlos","Dana","Elena","Frank","Grace","Hector","Irene","James","Karen","Luis","Marta","Ned","Olga","Pete","Quinn","Rosa","Sam","Tina","Uma","Victor","Wendy","Xavier","Yolanda","Zach","Miriam","Doug","Celia","Bram"];
const LAST = ["Abbott","Barnes","Cortez","Dawson","Ellison","Fuentes","Grady","Hobbs","Iverson","Jamison","Keller","Lozano","Mercer","Nolan","Ortega","Pruitt","Quimby","Rhodes","Sandoval","Tobin","Underhill","Vickers","Wexler","Yancey","Zimmer","Okafor","Petrov","Reyes","Solano","Tran"];
const CITIES = [["Lexington","KY","40507"],["Wilmore","KY","40390"],["Cynthiana","KY","41031"],["Georgetown","KY","40324"],["Richmond","KY","40475"],["Berea","KY","40403"]];
const CAMPAIGNS = ["Spring Appeal 2025","Fall Gala 2025","Year-End 2025","Giving Tuesday 2025",""];
const METHODS = ["Check","Credit Card","Cash","ACH","Venmo","DAF"];
// Matching Employer — accented + smart-quoted values, all windows-1252 encodable.
const EMPLOYERS = ["Café Río Holdings","Muñoz & Sons","O’Brien Financial","Père Marquette Insurance","“Big Blue” Warehouse Co.","Söderberg Analytics","",""];
const GIFT_LEVELS = ["Bronze","Silver","Gold","GOLD","Platinum","platinum","Benefactor","Founder"]; // six levels, two with case variants
const APPEAL_LETTERS = "ABCDEFGHJKMNPQRSTUV";
const NOTE_MARKERS = ["", "", "", "", "", "", "", "", "Monthly recurring", "pledge payment 3 of 12", "Do not solicit", "sent thank-you", "prefers email", "Do not include in vendor mailing"];

const donors = [];
const nDonors = 620;
for (let i = 0; i < nDonors; i++) {
  const fn = pick(FIRST), ln = pick(LAST);
  const [city, state, zip] = pick(CITIES);
  const boardish = chance(0.12);
  donors.push({
    name: `${fn} ${ln}`, first: fn, last: ln,
    email: chance(0.85) ? `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.org` : "",
    phone: chance(0.6) ? `555-${String(1000 + Math.floor(rnd() * 9000))}` : "",
    city, state, zip,
    board: boardish ? pick(["Y", "yes", "TRUE", "x", "1"]) : (chance(0.3) ? pick(["N", "no", "false", "0"]) : ""),
    employer: pick(EMPLOYERS),
    preferred: chance(0.25) ? fn.slice(0, Math.max(2, fn.length - 2)) : "",
    giftLevel: chance(0.7) ? pick(GIFT_LEVELS) : "",
    // Last Contact: ~80% dates in three formats, ~20% garbage (the mixed column)
    lastContact: chance(0.75)
      ? pick([
          () => `${1 + Math.floor(rnd() * 12)}/${1 + Math.floor(rnd() * 27)}/${2023 + Math.floor(rnd() * 3)}`,
          () => `${2023 + Math.floor(rnd() * 3)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}`,
          () => `${pick(["March", "June", "October"])} ${1 + Math.floor(rnd() * 27)}, ${2024 + Math.floor(rnd() * 2)}`,
        ])()
      : (chance(0.55) ? "" : pick(["left message", "n/a", "spoke at gala", "TBD", "see notes"])),
    deceased: chance(0.02) ? pick(["Y", "yes", "TRUE"]) : "",
    legacyId: chance(0.8) ? String(3000 + i) : "",
    giftCount: 1 + Math.floor(rnd() * 4),
  });
}
// the trap-within-the-trap: exactly one donor answers "maybe" to Board Member
donors[37].board = "maybe";
donors[37].giftCount = 1;
// a couple of soft-credit sources that are NOT donors in the file
const softNames = ["The Harriman Family Trust", "Beacon Community Fund", donors[3].name, donors[9].name];

const esc = v => { const t = String(v ?? ""); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const header = ["Donor Name","Email","Phone","Gift Date","Amount","Campaign","Payment Method","Notes",
  "Board Member","Matching Employer","Preferred Name","In Memory Of","Appeal Code","Soft Credit To",
  "Last Contact","Gift Level","Deceased?","Legacy ID","Notes",""];
const lines = [header.map(esc).join(",")];

const dateOf = () => {
  const y = 2023 + Math.floor(rnd() * 3);
  const m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 27);
  return pick([
    `${m}/${d}/${y}`,
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    `${d}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]}-${String(y).slice(2)}`,
  ]);
};

let rowCount = 0;
for (const d of donors) {
  for (let g = 0; g < d.giftCount; g++) {
    rowCount++;
    // amount mess: mostly clean, a few refunds, zeros, "USD" prefixes, garbage
    let amount;
    const r = rnd();
    if (r < 0.02) amount = `(${(25 + Math.floor(rnd() * 200))}.00)`;
    else if (r < 0.035) amount = "$0.00";
    else if (r < 0.05) amount = `USD ${(50 + Math.floor(rnd() * 900))}.00`;
    else if (r < 0.058) amount = pick(["pending", "waived", "2 tickets"]);
    else amount = chance(0.5) ? `$${(10 + Math.floor(rnd() * 490))}.00` : String(10 + Math.floor(rnd() * 490) + (chance(0.3) ? 0.5 : 0));
    // date mess: mostly clean; a couple future-dated
    const date = chance(0.985) ? dateOf() : `12/1/2027`;
    const note = pick(NOTE_MARKERS);
    const inMemory = chance(0.04) ? `In memory of ${pick(FIRST)} ${pick(LAST)}` : "";
    const appeal = chance(0.8) ? `FY${24 + Math.floor(rnd() * 3)}-${pick([...APPEAL_LETTERS])}${pick([...APPEAL_LETTERS])}${100 + Math.floor(rnd() * 900)}` : "";
    const softCredit = chance(0.05) ? pick(softNames) : "";
    const notes2 = chance(0.15) ? `batch ${100 + Math.floor(rnd() * 40)}` : "";
    lines.push([
      d.name, d.email, d.phone, date, amount, pick(CAMPAIGNS), pick(METHODS), note,
      d.board, d.employer, d.preferred, inMemory, appeal, softCredit,
      d.lastContact, d.giftLevel, d.deceased, d.legacyId, notes2, "",
    ].map(esc).join(","));
  }
}
// the malformed row: two orphan cells beyond the 20-column header
rowCount++;
lines.push([
  "Dorothy Overfield", "dorothy.overfield@example.org", "", "4/2/2024", "$120.00", "", "Check", "",
  "", "", "", "", "", "", "", "", "", "", "", "", "OVERFLOW-A", "OVERFLOW-B",
].map(esc).join(","));
// a stray header row echoed mid-file (page-break export artifact)
rowCount++;
lines.push(header.map(esc).join(","));

const text = lines.join("\n") + "\n";
// windows-1252 bytes — José stays José only if the reader repairs encoding.
// Node's latin1 truncates chars above U+00FF, so the cp1252-only characters
// (smart quotes) are mapped to their windows-1252 bytes explicitly first.
const CP1252 = { "\u2018": "\x91", "\u2019": "\x92", "\u201C": "\x93", "\u201D": "\x94", "\u2013": "\x96", "\u2014": "\x97" };
const bytes = Buffer.from(text.replace(/[\u2018\u2019\u201C\u201D\u2013\u2014]/g, ch => CP1252[ch]), "latin1");
fs.writeFileSync(OUT, bytes);
console.log(`wrote ${OUT}: ${rowCount} body rows, ${header.length} header cells (+2 orphan), ${bytes.length} bytes (windows-1252)`);
