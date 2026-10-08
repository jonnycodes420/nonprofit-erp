// tests/fixtures/import2/make-notes.js: IMPORT-2. A STAND-IN FOR steward-test-notes-messy.csv.
//
// Jonathan's real notes file was not on this machine when IMPORT-2 was built,
// so this writes one to the brief's key, paired with the real
// steward-test-1000-donors-messy.csv beside it. Seeded, so every run writes the
// same bytes. When the real file arrives it replaces the output and its own key
// replaces key.json; the importer does not know which one it is reading.
//
// THE KEY (from the brief):
//   2,420 rows: 1,910 match by Account Number, 239 by email only, 251 by name
//   only, 20 match nobody. 143 open tasks with due dates (some overdue), 117
//   contain "DO NOT SOLICIT", 120 are HTML, 129 have an empty note. Five date
//   formats, multi-line notes with quotes and commas, blank and placeholder
//   authors, attachment names with no files.
//
//   node tests/fixtures/import2/make-notes.js [anchor YYYY-MM-DD]

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const DONORS = path.join(HERE, "steward-test-1000-donors-messy.csv");
const OUT = path.join(HERE, "steward-test-notes-messy.csv");
const KEY = path.join(HERE, "key.json");
const ANCHOR = process.argv[2] || "2026-10-08";

// ── a seeded PRNG (mulberry32) ─────────────────────────────────────────────
let seed = 0x1a2b3c4d;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── a CSV reader that honours quotes, commas and newlines inside a cell ────
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvCell = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ── the clean people: one id, one name, one email, a plain first name ─────
const raw = parseCsv(fs.readFileSync(DONORS, "utf8").replace(/^﻿/, "")).slice(2).filter(r => r.length > 5);
const byId = new Map();
for (const r of raw) {
  const id = (r[0] || "").trim(); if (!id) continue;
  const p = byId.get(id) || { id, names: new Set(), emails: new Set(), org: false, addr: r[7], city: r[8] };
  p.names.add(`${(r[1] || "").trim()}|${(r[2] || "").trim()}`); p.emails.add((r[5] || "").trim().toLowerCase());
  if ((r[4] || "").trim()) p.org = true;
  byId.set(id, p);
}
const nameCount = new Map(), emailCount = new Map();
for (const p of byId.values()) {
  for (const n of p.names) nameCount.set(n.toLowerCase(), (nameCount.get(n.toLowerCase()) || 0) + 1);
  for (const e of p.emails) if (e) emailCount.set(e, (emailCount.get(e) || 0) + 1);
}
const clean = [...byId.values()].filter(p => {
  if (p.org || p.names.size !== 1 || p.emails.size !== 1) return false;
  // A person the file also lists under a second id (same address book) is
  // folded by the donor import, sometimes under the other row's name, so they
  // are not a fair "matches by name" row.
  const e = [...p.emails][0];
  if (e && emailCount.get(e) > 1) return false;
  const [first, last] = [...p.names][0].split("|");
  return /^[A-Z][a-z]+$/.test(first) && /^[A-Z][a-z]+$/.test(last);
}).map(p => { const [first, last] = [...p.names][0].split("|"); return { ...p, first, last, email: [...p.emails][0] }; });
const withEmail = clean.filter(p => p.email && /@/.test(p.email) && emailCount.get(p.email) === 1);
const uniqueName = clean.filter(p => nameCount.get(`${p.first}|${p.last}`.toLowerCase()) === 1);
shuffle(clean); shuffle(withEmail); shuffle(uniqueName);

// ── what a row says ────────────────────────────────────────────────────────
const KINDS = ["Note", "Phone Call", "Meeting", "Site Visit", "Email", "Letter", "Text Message", "Event Conversation", "Comment"];
const SUBJECTS = ["Catch-up", "Year-end thank you", "Spring appeal follow-up", "Board introduction", "Planned giving question",
  "Gala seating", "Scholarship update", "Volunteer interest", "Matching gift paperwork", "Tour of the new building"];
const BODIES = [
  "Talked about her grandson starting at the academy. Very warm.",
  "Left a voicemail, will try again next week.",
  "He asked about naming opportunities for the new wing, said \"let me talk to my wife first\".",
  "Discussed the capital campaign, timing, and whether a pledge over three years works for them.",
  "Sent the impact report, plus the photos from the spring event, as requested.",
  "Thank-you call for the year-end gift. She mentioned her late husband, Walter, loved the choir.",
  "Interested in volunteering on Saturdays, prefers mornings.",
  "Prefers email only, please, no calls during work hours.",
];
const MULTI = [
  "Met for coffee at the bakery.\nShe said the program \"changed my life, honestly\".\nFollow up in March, re: the endowment.",
  "Notes from the visit:\n- tour went well\n- asked about the roof, costs, and timeline\n- wants a one-pager",
];
const HTML = [
  "<p>Called to thank her for the gift.</p><p>She asked about the <b>scholarship</b> fund &amp; the deadline.</p>",
  "<div>Lunch meeting.<br>Discussed <i>planned giving</i>, will send the brochure.<br/>Very engaged.</div>",
  "<ul><li>Board invite</li><li>Follow up re: matching gift</li></ul><p>&quot;Happy to help&quot; she said.</p>",
];
const AUTHORS = ["Sarah Mitchell", "James Okafor", "Dana Reyes", "Pat Lin", "admin", "", " ", "ADMIN", "Unknown"];
const ATTACH = ["letter-2024.docx", "proposal.pdf", "thank-you-scan.jpg", "visit-notes.docx", "pledge-form.pdf"];

// FIVE DATE FORMATS. The fifth is day-first, and only on days past the 12th,
// so it can never be read month-first (Jonathan's rule, 8 Oct 2026).
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = n => String(n).padStart(2, "0");
const anchor = new Date(ANCHOR + "T12:00:00Z");
function dateOffset(days) { const d = new Date(anchor.getTime() + days * 86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
const iso = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
function fmt(dt, k) {
  if (k === 0) return `${pad(dt.m)}/${pad(dt.d)}/${dt.y}`;
  if (k === 1) return iso(dt);
  if (k === 2) return `${MON[dt.m - 1]} ${dt.d}, ${dt.y}`;
  if (k === 3) return `${dt.d} ${MONTH[dt.m - 1]} ${dt.y}`;
  return `${pad(dt.d)}/${pad(dt.m)}/${dt.y}`;   // day-first; caller guarantees d > 12
}

// ── the rows ───────────────────────────────────────────────────────────────
const N = 2420, BY_ID = 1910, BY_EMAIL = 239, BY_NAME = 251, NOBODY = 20;
const rows = [];
const plan = [...Array(BY_ID).fill("id"), ...Array(BY_EMAIL).fill("email"), ...Array(BY_NAME).fill("name"), ...Array(NOBODY).fill("nobody")];
const flags = shuffle([...Array(N).keys()]);
const openTask = new Set(flags.slice(0, 143));
const dns = new Set(flags.slice(143, 260));                 // 117
const html = new Set(flags.slice(260, 380));                // 120
const empty = new Set(flags.slice(380, 509));               // 129
const doneTask = new Set(flags.slice(509, 569));            // 60 completed tasks
const attach = new Set(flags.slice(569, 669));              // 100 attachment names
const multi = new Set(flags.slice(669, 869));
let ei = 0, ni = 0;
const key = { anchorDate: ANCHOR, rows: N, matchedById: BY_ID, matchedByEmail: BY_EMAIL, matchedByName: BY_NAME, matchNobody: NOBODY,
  openTasks: 143, openTasksOverdue: 0, completedTasks: doneTask.size, doNotSolicit: dns.size, doNotSolicitPeople: 0, html: html.size,
  emptyNote: empty.size, emptyNoteRefused: 0, attachments: attach.size, dayFirstRows: 0, formats: [0, 0, 0, 0, 0],
  byKind: {}, refused: 0 };
const dnsPeople = new Set();
for (let i = 0; i < N; i++) {
  const how = plan[i];
  let p, idCell = "", nameCell = "", emailCell = "";
  if (how === "id") { p = clean[i % clean.length]; idCell = p.id; if (rnd() < 0.5) nameCell = `${p.first} ${p.last}`; }
  else if (how === "email") { p = withEmail[ei++ % withEmail.length]; emailCell = rnd() < 0.3 ? p.email.toUpperCase() : p.email; if (rnd() < 0.4) nameCell = `${p.last}, ${p.first}`; }
  else if (how === "name") { p = uniqueName[ni++ % uniqueName.length]; nameCell = rnd() < 0.5 ? `${p.first} ${p.last}` : `${p.last}, ${p.first}`; }
  else { p = null; const r = i % 3;
    if (r === 0) idCell = `D9${int(1000, 9999)}`;
    else if (r === 1) { nameCell = `${pick(["Zelda", "Quentin", "Marisol", "Ignatius"])} ${pick(["Featherstone", "Oyelaran", "Vandermeer"])}`; }
    else emailCell = `nobody${int(100, 999)}@nowhere-test.org`; }

  let kind = pick(KINDS), status = "", due = "";
  if (openTask.has(i) || doneTask.has(i)) {
    kind = pick(["Task", "Action", "To Do"]);
    status = openTask.has(i) ? pick(["Open", "Not Started", "In Progress"]) : pick(["Completed", "Done"]);
    const dd = dateOffset(openTask.has(i) ? int(-40, 60) : int(-400, -5));
    due = fmt(dd, 1);
    if (openTask.has(i) && iso(dd) < ANCHOR) key.openTasksOverdue++;
  }
  let note = multi.has(i) ? pick(MULTI) : pick(BODIES);
  if (html.has(i)) note = pick(HTML);
  if (dns.has(i)) { note = pick([`DO NOT SOLICIT. ${note}`, `${note} ** DO NOT SOLICIT per her request **`, `do not solicit - family asked`]);
    if (p) dnsPeople.add(p.id); }
  let subject = pick(SUBJECTS);
  if (empty.has(i)) {
    note = pick(["", "", " "]);
    if (rnd() < 0.3) subject = "";
    if (!subject && ["Note", "Comment"].includes(kind) && !status && !attach.has(i) && how !== "nobody") key.emptyNoteRefused++;
  }

  let dt = dateOffset(-int(30, 1500));
  let k = i % 5;
  if (k === 4 && dt.d <= 12) dt = { ...dt, d: dt.d + 13 > 28 ? 28 : dt.d + 13 };
  if (k === 4) key.dayFirstRows++;
  key.formats[k]++;
  key.byKind[kind] = (key.byKind[kind] || 0) + 1;
  rows.push({
    "Account Number": idCell, "Name": nameCell, "Email": emailCell, "Date": fmt(dt, k), "Type": kind,
    "Subject": subject, "Note": note, "Entered By": pick(AUTHORS), "Status": status, "Due Date": due,
    "Attachment": attach.has(i) ? pick(ATTACH) : "",
  });
}
key.doNotSolicitPeople = dnsPeople.size;
const order = shuffle(rows.map((_, i) => i));
const header = Object.keys(rows[0]);
const out = [header.join(","), ...order.map(i => header.map(h => csvCell(rows[i][h])).join(","))].join("\r\n") + "\r\n";
fs.writeFileSync(OUT, out);
fs.writeFileSync(KEY, JSON.stringify(key, null, 2) + "\n");
console.log(`wrote ${N} rows to ${path.relative(process.cwd(), OUT)}; key ${path.relative(process.cwd(), KEY)}`);
console.log(JSON.stringify(key));
