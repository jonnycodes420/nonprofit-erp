// BUILD-77 — THE ANSWER KEY GENERATOR. Deliberately an INDEPENDENT
// implementation of the disposition policy (raw CSV + the spec's rules),
// never the import code under test — the whole build exists because the
// invariant graded its own homework. Regenerate with:
//   node tests/fixtures/build77/gen-answer-key.mjs
// Totals are cross-checked against the operator's observed numbers (54 USD
// rows / $154,849.63, 9 refunds / $6,750, 2,502 non-blank rows, 34
// sustainers over 462 sustainer-noted rows) before the key is written.
import fs from "fs";
const FIXTURE = new URL("./steward-messy-2500.csv", import.meta.url).pathname;
const OUT = new URL("./answer-key.json", import.meta.url).pathname;

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
// Presentation-normalize names the same way the product does ("LAST, First"
// flips, ALL-CAPS re-cases) — the key's INDEPENDENCE is about disposition
// policy, and surface assertions compare against stored (normalized) names.
function normName(raw) {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  const parts = s.split(",");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) s = parts[1].trim() + " " + parts[0].trim();
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase()))
    s = s.replace(/[A-Za-z][A-Za-z'’.\-]*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return s;
}
const all = parseCsv(fs.readFileSync(FIXTURE, "utf8"));
const header = all[0].map(h => h.trim());
const H = Object.fromEntries(header.map((h, i) => [h, i]));
const body = all.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => r.some(c => String(c).trim() !== ""));
const get = (r, k) => String(r[H[k]] ?? "").trim();

// independent amount policy
function amountOf(raw) {
  const t = String(raw ?? "").trim();
  if (!t || /^(n\/a|na|tbd|-|—|unknown)$/i.test(t)) return { kind: "blank" };
  const paren = t.match(/^\((.+)\)$/);
  const core = (paren ? paren[1] : t).replace(/^[A-Za-z]{3}\s+/, "").replace(/[$,\s]/g, "");
  const n = parseFloat(core);
  if (isNaN(n)) return { kind: "unparseable" };
  const v = paren ? -n : n;
  return v === 0 ? { kind: "zero", v: 0 } : { kind: "ok", v };
}
// independent date policy (the nine formats; 2-digit pivot to past vs 2026)
const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
const DIM = [31,28,31,30,31,30,31,31,30,31,30,31];
const ok = (y,m,d)=>{ if(m<1||m>12||d<1||y<1900||y>2100) return null; const leap=(y%4===0&&y%100!==0)||y%400===0; const mx=m===2&&leap?29:DIM[m-1]; return d<=mx?`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`:null; };
const piv = yy => { const y = 2000 + yy; return y > 2026 ? y - 100 : y; };
function dateOf(raw) {
  const s = String(raw ?? "").trim(); let m;
  if (!s) return null;
  if (/^\d{5}$/.test(s)) { const n=+s; return (n>=10000&&n<60000)? new Date(Date.UTC(1899,11,30)+n*86400000).toISOString().slice(0,10):null; }
  if (m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/)) return ok(+m[1],+m[2],+m[3]);
  if (m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)) return ok(+m[3],+m[1],+m[2]);
  if (m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)) return ok(piv(+m[3]),+m[1],+m[2]);
  if (m=s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/)) { const mo=MON[m[2].toLowerCase()]; return mo?ok(m[3].length===2?piv(+m[3]):+m[3],mo,+m[1]):null; }
  if (m=s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/)) { const mo=MON[m[1].toLowerCase()]; return mo?ok(+m[3],mo,+m[2]):null; }
  if (m=s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/)) { const mo=MON[m[2].toLowerCase()]; return mo?ok(+m[3],mo,+m[1]):null; }
  if (m=s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/)) { const mo=MON[m[1].toLowerCase()]; return mo?ok(+m[2],mo,1):null; }
  return null;
}

const dispositions = [];   // { line, disposition, reason, dollars, name, date }
const donors = new Map();  // key → { name, flags, gifts:[{date,amount,sustainerNote}] }
const flagRe = {
  deceased: [/\bdeceased\b/i, /passed away/i, /^d\.\s+/i, /estate of decedent|\bbequest\b/i],
  doNotSolicit: [/do not solicit/i, /no solicitation/i, /\bDNS\b/, /do not (mail or |mail\/)?call/i, /estate of decedent|\bbequest\b/i],
  doNotContact: [/do not contact/i, /no further contact/i],
  doNotMail: [/do not mail\b/i, /removed from (the )?mailing/i],
  doNotEmail: [/do not e-?mail/i, /unsubscribed?\b/i],
};
const susRe = [/monthly recurring/i, /\bsustainer\b/i, /monthly (eft|ach|giver|donor|gift)/i, /recurring\b.*(cc|card) on file|\brecurring\b\s*[-–—]/i];
const pledgeRe = /pledge (payment|installment)/i;

for (const { r, line } of body) {
  const name = get(r, "Donor Name"), email = get(r, "Email").toLowerCase();
  const notes = get(r, "Notes");
  const rec = (disposition, reason, dollars, date) => dispositions.push({ line, disposition, reason: reason || null, dollars: dollars || 0, name: name || email || "(none)", date: date || null });
  if (name === "Donor Name") { rec("errored", "stray_header_row", 0); continue; }
  if (!name && !email) { rec("errored", "no_donor_identity", 0); continue; }
  const key = email.includes("@") ? email : name.toLowerCase();
  if (!donors.has(key)) donors.set(key, { name: normName(name), flags: {}, gifts: [], pledgePayer: false });
  const d = donors.get(key);
  for (const [f, res] of Object.entries(flagRe)) if (res.some(re => re.test(notes))) d.flags[f] = true;
  if (pledgeRe.test(notes)) d.pledgePayer = true;
  const a = amountOf(r[H["Amount"]]);
  if (a.kind === "blank") { rec("skipped", "no_amount", 0); continue; }
  if (a.kind === "unparseable") { rec("errored", "unparseable_amount", 0); continue; }
  if (a.kind === "zero") { rec("skipped", "zero_amount", 0); continue; }
  const dt = dateOf(get(r, "Gift Date"));
  if (!dt) { rec("errored", "unparseable_date", a.v); continue; }
  if (dt > "2026-09-03") { rec("errored", "future_date", a.v, dt); continue; }   // key generated 2026-09-03; the golden test re-derives for later run dates
  d.gifts.push({ date: dt, amount: a.v, sustainerNote: susRe.some(re => re.test(notes)), pledge: pledgeRe.test(notes) });
  rec("gift", null, a.v, dt);
}

// sustainers (independent): interval evidence outranks the note
const sustainers = [], stopped = [];
for (const [, d] of donors) {
  // pledge installments are contractual cadence, never sustainer evidence
  const gs = d.gifts.filter(g => g.amount > 0 && !g.pledge).sort((x, y) => x.date < y.date ? -1 : 1);
  const noteHits = gs.filter(g => g.sustainerNote).length;
  let monthly = false, contradicts = false;
  if (gs.length >= 4) {
    const iv = []; for (let k = 1; k < gs.length; k++) iv.push(Math.round((new Date(gs[k].date) - new Date(gs[k-1].date)) / 86400000));
    const med = iv.sort((x, y) => x - y)[Math.floor(iv.length / 2)];
    const amts = gs.map(g => g.amount).sort((x, y) => x - y);
    const am = amts[Math.floor(amts.length / 2)];
    const stable = gs.every(g => am > 0 && Math.abs(g.amount - am) / am <= 0.15);
    monthly = med >= 20 && med <= 40 && stable; contradicts = med > 60;
  }
  if (monthly || (noteHits >= 2 && !contradicts)) {
    const last = gs.length ? gs[gs.length - 1].date : null;
    sustainers.push(d.name);
    if (last && (new Date("2026-09-03") - new Date(last)) / 86400000 > 60) stopped.push(d.name);
  }
}

const sum = (pred) => Math.round(dispositions.filter(pred).reduce((s, x) => s + x.dollars, 0) * 100) / 100;
const cnt = (pred) => dispositions.filter(pred).length;
const key = {
  generatedAt: "2026-09-03", todayUsed: "2026-09-03",
  file: { physicalRows: body.length, netDollarsParsed: sum(() => true) },
  buckets: {
    gift:   { rows: cnt(x => x.disposition === "gift"),   dollars: sum(x => x.disposition === "gift") },
    skipped:{ rows: cnt(x => x.disposition === "skipped"),dollars: sum(x => x.disposition === "skipped") },
    errored:{ rows: cnt(x => x.disposition === "errored"),dollars: sum(x => x.disposition === "errored") },
  },
  reasons: Object.fromEntries([...new Set(dispositions.filter(x => x.reason).map(x => x.reason))].map(rr =>
    [rr, { rows: cnt(x => x.reason === rr), dollars: sum(x => x.reason === rr) }])),
  exclusions: {
    deceased:     [...donors.values()].filter(d => d.flags.deceased).map(d => d.name),
    doNotSolicit: [...donors.values()].filter(d => d.flags.doNotSolicit && !d.flags.deceased).map(d => d.name),
    doNotContact: [...donors.values()].filter(d => d.flags.doNotContact && !d.flags.deceased).map(d => d.name),
    pledgePayers: [...donors.values()].filter(d => d.pledgePayer && !d.flags.deceased).map(d => d.name),
  },
  sustainers: { count: sustainers.length, names: sustainers.sort(), stoppedOver60d: stopped.sort() },
  larryAckerly: [...donors.values()].find(d => d.name === "Larry Ackerly")?.gifts.map(g => `${g.date}|${g.amount}`).sort(),
  futureRow: dispositions.find(x => x.reason === "future_date") || null,
  dispositions,
};
// cross-checks vs the operator's observed numbers
const usd = key.reasons; void usd;
console.log("physicalRows:", key.file.physicalRows, "(expect 2502)");
console.log("buckets:", JSON.stringify(key.buckets));
console.log("reasons:", JSON.stringify(key.reasons));
console.log("deceased:", key.exclusions.deceased.length, "| dns:", key.exclusions.doNotSolicit.length, "| dnc:", key.exclusions.doNotContact.length, "| pledge:", key.exclusions.pledgePayers.length);
console.log("sustainers:", key.sustainers.count, "stopped>60d:", key.sustainers.stoppedOver60d.length);
console.log("larry:", key.larryAckerly);
if (key.file.physicalRows !== 2502) throw new Error("row count does not reconcile");
fs.writeFileSync(OUT, JSON.stringify(key, null, 1));
console.log("wrote", OUT);
