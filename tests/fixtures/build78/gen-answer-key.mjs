// BUILD-78 — THE ANSWER KEY GENERATOR for steward-messy-cf.csv. Deliberately
// an INDEPENDENT implementation of the spec's policies (raw bytes + the
// BUILD-78 rules), never the import code under test — same discipline as
// build77/gen-answer-key.mjs, because the original sin was an invariant
// grading its own homework. Regenerate:
//   node tests/fixtures/build78/gen-answer-key.mjs
import fs from "fs";
const FIXTURE = new URL("./steward-messy-cf.csv", import.meta.url).pathname;
const OUT = new URL("./answer-key.json", import.meta.url).pathname;

// windows-1252 decode (independent: TextDecoder, not the product's helper)
const text = new TextDecoder("windows-1252").decode(fs.readFileSync(FIXTURE));

function parseCsv(t) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const all = parseCsv(text);
const header = all[0];
const body = all.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => r.some(c => String(c).trim() !== ""));
const H = {}; header.forEach((h, i) => { if (!(h in H)) H[h] = i; });
const col = (r, name, nth = 0) => {
  // nth handles the duplicate Notes header (nth=1 → the second physical one)
  let seen = -1;
  for (let i = 0; i < header.length; i++) if (header[i] === name && ++seen === nth) return String(r[i] ?? "").trim();
  return "";
};

// ── independent policies (the spec's 1.3 table + BUILD-77 date/money) ──────
const TRUTHY = ["y", "yes", "true", "t", "1", "x", "checked"];
const FALSY = ["n", "no", "false", "f", "0", "unchecked"];
const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
const DIM = [31,28,31,30,31,30,31,31,30,31,30,31];
const okDate = (y,m,d)=>{ if(m<1||m>12||d<1||y<1900||y>2100) return null; const leap=(y%4===0&&y%100!==0)||y%400===0; const mx=m===2&&leap?29:DIM[m-1]; return d<=mx?`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`:null; };
const piv = yy => { const y = 2000 + yy; return y > new Date().getFullYear() ? y - 100 : y; };
function dateOf(raw) {
  const s = String(raw ?? "").trim(); let m;
  if (!s) return null;
  if (/^\d{5}$/.test(s)) { const n=+s; return (n>=10000&&n<60000)? new Date(Date.UTC(1899,11,30)+n*86400000).toISOString().slice(0,10):null; }
  if (m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/)) return okDate(+m[1],+m[2],+m[3]);
  if (m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)) return okDate(+m[3],+m[1],+m[2]);
  if (m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)) return okDate(piv(+m[3]),+m[1],+m[2]);
  if (m=s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/)) { const mo=MON[m[2].toLowerCase()]; return mo?okDate(m[3].length===2?piv(+m[3]):+m[3],mo,+m[1]):null; }
  if (m=s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/)) { const mo=MON[m[1].toLowerCase()]; return mo?okDate(+m[3],mo,+m[2]):null; }
  if (m=s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/)) { const mo=MON[m[2].toLowerCase()]; return mo?okDate(+m[3],mo,+m[1]):null; }
  if (m=s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/)) { const mo=MON[m[1].toLowerCase()]; return mo?okDate(+m[2],mo,1):null; }
  return null;
}
function amountOf(raw) {
  // BUILD-80 Part 1 — the CLOSED grammar, independently restated. The old
  // strip-everything-and-parseFloat policy read "2 tickets" as $2 (4 rows,
  // $8) — a quantity annotation is not money. Accepted shapes only; anything
  // else is unparseable.
  let t = String(raw ?? "").trim();
  if (!t || /^(n\/a|na|tbd|-|—|unknown)$/i.test(t)) return { kind: "blank" };
  if (t.startsWith("'")) t = t.slice(1).trim();
  let sign = 1;
  const paren = t.match(/^\((.*)\)$/);
  if (paren) { t = paren[1].trim(); sign = -1; }
  if (/^CR\s+/i.test(t)) { t = t.replace(/^CR\s+/i, ""); sign = -1; }
  else if (t.startsWith("-")) { t = t.slice(1).trim(); sign = -1; }
  t = t.replace(/^\$\s*/, "").replace(/^[A-Za-z]{3}\s+(?=[\d($])/, "").replace(/\s+dollars?$/i, "").trim();
  if (t.endsWith("-") && sign === 1) { t = t.slice(0, -1).trim(); sign = -1; }
  let mult = 1;
  const km = t.match(/^(\d+(?:\.\d{1,2})?)[kK]$/);
  if (km) { mult = 1000; t = km[1]; }
  let n = null;
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(t)) n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}([\u00A0\u202F ]\d{3})+(,\d{2}|\.\d{1,2})?$/.test(t)) n = parseFloat(t.replace(/[\u00A0\u202F ]/g, "").replace(",", "."));
  else if (/^\d+,\d{2}$/.test(t) && !/^\d{1,3},\d{3}$/.test(t)) n = parseFloat(t.replace(",", "."));
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) n = parseFloat(t.replace(/,/g, ""));
  else if (/^\d+(\.\d{1,2})?$/.test(t)) n = parseFloat(t);
  if (n == null || isNaN(n)) return { kind: "unparseable" };
  const v = sign * mult * n;
  return v === 0 ? { kind: "zero", v: 0 } : { kind: "ok", v };
}

// ── the column axis, per the golden decisions (spec Part 8) ────────────────
const columnAxis = {
  inFile: header.length + 2, // 20 physical header cells + 2 orphan overflow cells on the malformed row
  headerCells: header.length,
  orphanColumns: 2,
  dispositions: {
    core: 8,                 // Donor Name, Email, Phone, Gift Date, Amount, Campaign, Payment Method, Notes(1st)
    custom: 8,               // Board Member, Matching Employer, Preferred Name, In Memory Of, Appeal Code, Soft Credit To, Last Contact, Gift Level
    flag: 1,                 // Deceased? — THE trap; a custom-field offer is a test failure
    discarded: 2,            // Legacy ID, Notes (2nd)
    refused: 3,              // blank header + 2 orphan columns
  },
  customFields: [
    { header: "Board Member",     entity: "donor", type: "checkbox", key: "board_member" },
    { header: "Matching Employer",entity: "donor", type: "text",     key: "matching_employer" },
    { header: "Preferred Name",   entity: "donor", type: "text",     key: "preferred_name" },
    { header: "In Memory Of",     entity: "gift",  type: "text",     key: "in_memory_of" },
    { header: "Appeal Code",      entity: "gift",  type: "text",     key: "appeal_code" },   // high cardinality — must NOT be select
    { header: "Soft Credit To",   entity: "gift",  type: "text",     key: "soft_credit_to" }, // stores as text; creates NO donors, touches NO drift
    { header: "Last Contact",     entity: "donor", type: "date",     key: "last_contact" },  // the mixed column
    { header: "Gift Level",       entity: "donor", type: "select",   key: "gift_level" },
  ],
};

// Gift Level canonical options: first-seen casing per case-fold, scan order
const glIdx = header.indexOf("Gift Level");
const glCanon = new Map();
for (const { r } of body) {
  if (String(r[0] ?? "").trim() === "Donor Name") continue;   // stray header echo never feeds the option scan
  const v = String(r[glIdx] ?? "").trim(); if (!v) continue; const k = v.toLowerCase(); if (!glCanon.has(k)) glCanon.set(k, v);
}

// ── the row axis ───────────────────────────────────────────────────────────
const dispositions = [];
const donors = new Map(); // identity key → { name, deceased, custom:{}, gifts:[] }
for (const { r, line } of body) {
  const name = col(r, "Donor Name"), email = col(r, "Email").toLowerCase();
  const rec = (disposition, reason, dollars) => dispositions.push({ line, disposition, reason: reason || null, dollars: dollars || 0, name: name || email || "(none)" });
  if (name === "Donor Name") { rec("errored", "stray_header_row", 0); continue; }
  if (!name && !email) { rec("errored", "no_donor_identity", 0); continue; }
  const amtInfo = amountOf(col(r, "Amount"));
  const dollars = amtInfo.kind === "ok" ? amtInfo.v : 0;

  // flag column first (the builder's order): Deceased? — unrecognized non-blank refuses
  const dec = col(r, "Deceased?");
  if (dec && !TRUTHY.includes(dec.toLowerCase()) && !FALSY.includes(dec.toLowerCase())
      && !["deceased","do not contact","do not solicit","do not mail","do not email","dnc","dns"].includes(dec.toLowerCase())) {
    rec("errored", "unrecognized_deceased_value", dollars); continue;
  }
  // custom coercions next — a failed value refuses the whole row
  const board = col(r, "Board Member");
  if (board && !TRUTHY.includes(board.toLowerCase()) && !FALSY.includes(board.toLowerCase())) {
    rec("errored", "board_member_invalid", dollars); continue;
  }
  const lc = col(r, "Last Contact");
  if (lc && !dateOf(lc)) { rec("errored", "last_contact_invalid", dollars); continue; }
  const gl = col(r, "Gift Level");
  if (gl && !glCanon.has(gl.toLowerCase())) { rec("errored", "gift_level_invalid", dollars); continue; }

  const key = email.includes("@") ? email : name.toLowerCase();
  if (!donors.has(key)) donors.set(key, { name, deceased: false, custom: {}, giftCustom: [], gifts: [] });
  const d = donors.get(key);
  if (dec && TRUTHY.includes(dec.toLowerCase())) d.deceased = true;
  if (/do not solicit/i.test(col(r, "Notes"))) d.doNotSolicit = true;   // detectNoteMarkers still runs on notes
  // donor custom values: first non-blank per key wins
  const setCf = (k, v) => { if (v !== "" && d.custom[k] === undefined) d.custom[k] = v; };
  if (board) setCf("board_member", TRUTHY.includes(board.toLowerCase()));
  setCf("matching_employer", col(r, "Matching Employer"));
  setCf("preferred_name", col(r, "Preferred Name"));
  if (lc) setCf("last_contact", dateOf(lc));
  if (gl) setCf("gift_level", glCanon.get(gl.toLowerCase()));

  if (amtInfo.kind === "blank") { rec("skipped", "no_amount", 0); continue; }
  if (amtInfo.kind === "unparseable") { rec("errored", "unparseable_amount", 0); continue; }
  if (amtInfo.kind === "zero") { rec("skipped", "zero_amount", 0); continue; }
  const dt = dateOf(col(r, "Gift Date"));
  if (!dt) { rec("errored", "unparseable_date", amtInfo.v); continue; }
  if (dt > new Date().toISOString().slice(0, 10)) { rec("errored", "future_date", amtInfo.v); continue; }
  const gcf = {};
  for (const [k, hdr] of [["in_memory_of", "In Memory Of"], ["appeal_code", "Appeal Code"], ["soft_credit_to", "Soft Credit To"]]) {
    const v = col(r, hdr); if (v) gcf[k] = v;
  }
  d.gifts.push({ date: dt, amount: amtInfo.v, custom: gcf });
  rec("gift", null, amtInfo.v);
}

const sum = p => Math.round(dispositions.filter(p).reduce((s, x) => s + x.dollars, 0) * 100) / 100;
const cnt = p => dispositions.filter(p).length;
const key = {
  generatedAt: new Date().toISOString().slice(0, 10),
  file: { physicalRows: body.length },
  columnAxis,
  giftLevelOptions: [...glCanon.values()],
  buckets: {
    gift:    { rows: cnt(x => x.disposition === "gift"),    dollars: sum(x => x.disposition === "gift") },
    skipped: { rows: cnt(x => x.disposition === "skipped"), dollars: sum(x => x.disposition === "skipped") },
    errored: { rows: cnt(x => x.disposition === "errored"), dollars: sum(x => x.disposition === "errored") },
  },
  reasons: Object.fromEntries([...new Set(dispositions.filter(x => x.reason).map(x => x.reason))].map(rr =>
    [rr, { rows: cnt(x => x.reason === rr), dollars: sum(x => x.reason === rr) }])),
  donorCount: donors.size,
  deceased: [...donors.values()].filter(d => d.deceased).map(d => d.name).sort(),
  doNotSolicitFromNotes: [...donors.values()].filter(d => d.doNotSolicit && !d.deceased).map(d => d.name).sort(),
  boardMembers: [...donors.values()].filter(d => d.custom.board_member === true).length,
  softCreditNonDonors: ["The Harriman Family Trust", "Beacon Community Fund"], // must NOT become donors
  sampleDonors: [...donors.entries()].filter(([, d]) => Object.keys(d.custom).length >= 4).slice(0, 5)
    .map(([k, d]) => ({ key: k, name: d.name, custom: d.custom })),
  sampleGiftCustom: (() => {
    for (const [, d] of donors) for (const g of d.gifts) if (g.custom.appeal_code && g.custom.soft_credit_to)
      return { donor: d.name, date: g.date, amount: g.amount, custom: g.custom };
    for (const [, d] of donors) for (const g of d.gifts) if (g.custom.appeal_code)
      return { donor: d.name, date: g.date, amount: g.amount, custom: g.custom };
    return null;
  })(),
  dispositions,
};
console.log("physicalRows:", key.file.physicalRows, "| columns:", key.columnAxis.inFile);
console.log("buckets:", JSON.stringify(key.buckets));
console.log("reasons:", JSON.stringify(key.reasons));
console.log("donors:", key.donorCount, "| deceased:", key.deceased.length, "| DNS(notes):", key.doNotSolicitFromNotes.length, "| board:", key.boardMembers);
console.log("giftLevelOptions:", key.giftLevelOptions);
if (key.buckets.gift.rows + key.buckets.skipped.rows + key.buckets.errored.rows !== key.file.physicalRows) throw new Error("row axis does not reconcile");
fs.writeFileSync(OUT, JSON.stringify(key, null, 1));
console.log("wrote", OUT);
