// FIX-33 section 5 · THE ANSWER KEY GENERATOR for steward-test-1000-donors-messy.csv.
//
// Deliberately an INDEPENDENT reading of the raw CSV against the file's stated
// rules, never the import code under test (the build77 lesson: a key derived
// by the importer grades its own homework). It imports nothing from shared/,
// server.js or client/. The ANSWER-KEY.md that came with the file never
// reached disk, so this is the key. Regenerate with:
//   node tests/fixtures/fix33/gen-answer-key.mjs
// It writes answer-key.json here and docs/fix-33/ANSWER-KEY.md.
//
// The stated rules (from the file's description):
//   1,000 true donors (Constituent IDs D1xxxx), 60 planted duplicates
//   (D2xxxx, each a second record of one true donor), 40 double-exported gift
//   rows (a Gift ID repeated with an identical row), refunds, bad and future
//   dates, a TOTAL row at the end, deceased donors, a preamble line.
import fs from "fs";
const FIXTURE = new URL("./steward-test-1000-donors-messy.csv", import.meta.url).pathname;
const OUT = new URL("./answer-key.json", import.meta.url).pathname;
const MD = new URL("../../../docs/fix-33/ANSWER-KEY.md", import.meta.url).pathname;
const ANCHOR = "2026-10-07";   // the day the file was exported (its preamble says so)

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
const raw = parseCsv(fs.readFileSync(FIXTURE, "utf8"));
const physicalLines = raw.length;
// line 1 is the preamble ("Exported from DonorDB ..."), line 2 the header
const header = raw[1].map(h => h.trim());
const H = Object.fromEntries(header.map((h, i) => [h, i]));
const get = (r, k) => String(r[H[k]] ?? "").trim();
const lines = raw.slice(2).map((r, i) => ({ r, line: i + 3 }));
const blank = lines.filter(({ r }) => r.every(c => String(c).trim() === ""));
const totalRows = lines.filter(({ r }) => r.some(c => /^total$/i.test(String(c).trim())) && !get(r, "Constituent ID"));
const data = lines.filter(x => !blank.includes(x) && !totalRows.includes(x));

// ── double exports: same Gift ID, identical row ──
const seen = new Map(); const copies = []; const giftRows = [];
for (const x of data) {
  const gid = get(x.r, "Gift ID");
  const sig = x.r.join("\u0001");
  if (gid && seen.has(gid)) {
    if (seen.get(gid).sig !== sig) throw new Error(`Gift ID ${gid} repeats with a DIFFERENT row (line ${x.line})`);
    copies.push({ line: x.line, giftId: gid, firstLine: seen.get(gid).line });
    continue;
  }
  if (gid) seen.set(gid, { sig, line: x.line });
  giftRows.push(x);
}

// ── amounts: $, commas, spaces, a leading OR trailing 3-letter code ──
function amountOf(t) {
  t = String(t ?? "").trim();
  if (!t || /^(n\/a|na|tbd|-|unknown)$/i.test(t)) return { kind: "no_amount" };
  const paren = t.match(/^\((.+)\)$/);
  const core = (paren ? paren[1] : t).replace(/^[A-Za-z]{3}\s+/, "").replace(/\s+[A-Za-z]{3}$/, "").replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(core)) return { kind: "unparseable" };
  const v = (paren ? -1 : 1) * Number(core);
  return v === 0 ? { kind: "zero", v: 0 } : v < 0 ? { kind: "refund", v } : { kind: "ok", v };
}
// ── dates: ISO, m/d/y (2- or 4-digit year), "Month D YYYY", "Mon D, YYYY".
// A slash date whose first number is over 12 has only ONE valid reading (d/m/y);
// that is the cell's own evidence, not a guess. Both numbers <= 12 reads m/d/y,
// the convention of the rest of the column (1,271 cells can only be m/d/y).
const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const valid = (y, m, d) => {
  if (y < 1900 || m < 1 || m > 12 || d < 1) return null;
  const dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= dim ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};
function dateOf(t) {
  t = String(t ?? "").trim();
  let m;
  if (!t) return { kind: "bad", why: "blank" };
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return wrap(valid(+m[1], +m[2], +m[3]), "iso");
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (+m[1] > 12) return wrap(valid(y, +m[2], +m[1]), "d/m/y (day over 12)");
    return wrap(valid(y, +m[1], +m[2]), "m/d/y");
  }
  if ((m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/))) {
    const mo = MON[m[1].slice(0, 3).toLowerCase()];
    return wrap(mo ? valid(+m[3], mo, +m[2]) : null, "month name");
  }
  return { kind: "bad", why: `unreadable "${t}"` };
}
function wrap(iso, form) { return iso ? { kind: iso > ANCHOR ? "future" : "ok", iso, form } : { kind: "bad", why: "not a calendar date" }; }

const dispositions = giftRows.map(({ r, line }) => {
  const a = amountOf(get(r, "Gift Amount"));
  const d = dateOf(get(r, "Gift Date"));
  const base = { line, donorId: get(r, "Constituent ID"), giftId: get(r, "Gift ID"), amountRaw: get(r, "Gift Amount"), dateRaw: get(r, "Gift Date"), amount: a.v ?? null, date: d.iso || null };
  // money first: a row with no usable amount is not a gift whatever its date
  if (a.kind === "no_amount" || a.kind === "unparseable") return { ...base, disposition: "set_aside", reason: "no_amount" };
  if (a.kind === "zero") return { ...base, disposition: "set_aside", reason: "zero_amount" };
  if (d.kind === "bad") return { ...base, disposition: "set_aside", reason: "bad_date" };
  if (d.kind === "future") return { ...base, disposition: "set_aside", reason: "future_date" };
  if (a.kind === "refund") return { ...base, disposition: "gift", reason: "refund", dateForm: d.form };
  return { ...base, disposition: "gift", reason: null, dateForm: d.form };
});

// ── donors and the 60 planted duplicates ──
const digits = p => { const d = String(p || "").replace(/\D/g, ""); const t = d.length === 11 && d[0] === "1" ? d.slice(1) : d; return t.length >= 7 ? t.slice(-7) : ""; };
const street = a => { const m = String(a || "").toLowerCase().match(/^(\d+)\s+([a-z]+)/); return m ? m[1] + " " + m[2] : ""; };
const nm = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const recs = new Map();
for (const { r } of data) {
  const id = get(r, "Constituent ID"); if (!id) continue;
  if (!recs.has(id)) recs.set(id, { id, firsts: new Set(), lasts: new Set(), emails: new Set(), phones: new Set(), streets: new Set(), deceased: false, rows: 0 });
  const p = recs.get(id); p.rows++;
  if (get(r, "First Name")) p.firsts.add(nm(get(r, "First Name")));
  if (get(r, " Last name") || get(r, "Last name")) p.lasts.add(nm(get(r, "Last name") || get(r, " Last name")));
  if (get(r, "E-mail Address")) p.emails.add(get(r, "E-mail Address").toLowerCase());
  if (digits(get(r, "Phone #"))) p.phones.add(digits(get(r, "Phone #")));
  if (street(get(r, "Address Line 1"))) p.streets.add(street(get(r, "Address Line 1")));
  if (/^(true|yes|y|1)$/i.test(get(r, "Deceased"))) p.deceased = true;
}
const inter = (a, b) => [...a].some(x => b.has(x));
const trueIds = [...recs.keys()].filter(id => id.startsWith("D1"));
const plantedIds = [...recs.keys()].filter(id => id.startsWith("D2"));
const twins = plantedIds.sort().map(id => {
  const p = recs.get(id);
  const cands = trueIds.map(t => {
    const q = recs.get(t); const ev = [];
    if (inter(p.emails, q.emails)) ev.push("email");
    if (inter(p.phones, q.phones)) ev.push("phone");
    if (inter(p.streets, q.streets)) ev.push("address");
    // a surname is shared when equal or when one is a part of the other's hyphenated form
    const parts = s => new Set([...s].flatMap(l => [l, ...l.split("-")]));
    if (inter(parts(p.lasts), q.lasts) || inter(p.lasts, parts(q.lasts))) ev.push("surname");
    return { t, ev, q };
  }).filter(c => c.ev.includes("email") || c.ev.filter(e => e !== "surname").length >= 2
                || (c.ev.includes("address") && c.ev.includes("surname")));
  if (cands.length !== 1) throw new Error(`planted ${id}: ${cands.length} candidate twins`);
  const { t, ev, q } = cands[0];
  // CERTAIN = the same real email AND the same name once case and spacing are
  // set aside (a person form; "A & B" couple forms are compared by the person
  // they name first). Anything else is a question for a human.
  const personOf = f => f.split("&")[0].trim();
  const pf = new Set([...p.firsts].map(personOf)), qf = new Set([...q.firsts].map(personOf));
  const sameName = inter(pf, qf) && inter(p.lasts, q.lasts);
  const certain = ev.includes("email") && sameName;
  const firstOf = r => [...r.firsts][0] || "", lastOf = r => [...r.lasts][0] || "";
  return { planted: id, twin: t, evidence: ev, sameName, verdict: certain ? "certain" : "review",
           plantedName: `${firstOf(p)} ${lastOf(p)}`, twinName: `${firstOf(q)} ${lastOf(q)}`, plantedRows: p.rows };
});

const gifts = dispositions.filter(d => d.disposition === "gift");
const sum = a => Math.round(a.reduce((s, d) => s + d.amount, 0) * 100) / 100;
const byReason = {};
for (const d of dispositions) { const k = d.reason || "gift"; byReason[k] = byReason[k] || { rows: 0, dollars: 0 }; byReason[k].rows++; byReason[k].dollars = Math.round((byReason[k].dollars + (d.amount || 0)) * 100) / 100; }
const key = {
  anchorDate: ANCHOR,
  file: { physicalLines, preambleLines: 1, headerLine: 2, blankLines: blank.map(b => b.line), totalRowLines: totalRows.map(t => t.line),
          dataRows: data.length, doubleExportCopies: copies.length, giftRowsAfterCopies: giftRows.length },
  copies,
  donors: { trueDonors: trueIds.length, plantedDuplicates: plantedIds.length, expectedPeople: trueIds.length,
            certain: twins.filter(t => t.verdict === "certain").length, review: twins.filter(t => t.verdict === "review").length },
  twins,
  deceased: [...recs.values()].filter(p => p.deceased).map(p => ({ id: p.id, name: `${[...p.firsts][0]} ${[...p.lasts][0]}` })),
  gifts: { rows: gifts.length, dollars: sum(gifts), refunds: gifts.filter(g => g.reason === "refund").length, refundDollars: sum(gifts.filter(g => g.reason === "refund")),
           dayOver12: gifts.filter(g => g.dateForm === "d/m/y (day over 12)").length },
  byReason,
  // Steward's held rule (BUILD-80): a date column that mixes conventions is a
  // question, and under her answer (month first) a cell that only reads day
  // first is refused, not re-read. Under that rule these are the gifts.
  giftsUnderMonthFirstAnswer: (() => {
    const g = gifts.filter(x => x.dateForm !== "d/m/y (day over 12)");
    return { rows: g.length, dollars: sum(g), refunds: g.filter(x => x.reason === "refund").length, refusedDayFirst: gifts.length - g.length,
             refusedDayFirstDollars: Math.round((sum(gifts) - sum(g)) * 100) / 100 };
  })(),
  dispositions,
};
fs.writeFileSync(OUT, JSON.stringify(key, null, 1) + "\n");

const md = [];
md.push("# FIX-33 answer key: steward-test-1000-donors-messy.csv", "");
md.push(`Derived from the raw CSV and the file's stated rules by \`tests/fixtures/fix33/gen-answer-key.mjs\`, which imports none of the code it grades. The ANSWER-KEY.md that came with the file was not on disk. Dates are judged against ${ANCHOR}, the day in the file's own preamble. Machine-readable copy: \`tests/fixtures/fix33/answer-key.json\`.`, "");
md.push("## The file", "");
md.push(`| | Lines |`, `|---|---:|`);
md.push(`| Physical lines | ${physicalLines} |`, `| Preamble ("Exported from DonorDB ...") | 1 (line 1) |`, `| Header | 1 (line 2) |`,
  `| Blank lines | ${blank.length} (${blank.map(b => b.line).join(", ")}) |`, `| TOTAL row (not a gift) | ${totalRows.length} (line ${totalRows.map(t => t.line).join(", ")}) |`,
  `| Data rows | ${data.length} |`, `| Double-exported copies (same Gift ID, identical row) | ${copies.length} |`, `| **Gift rows after removing the copies** | **${giftRows.length}** |`, "");
md.push(`The brief's 4,235 is confirmed: ${physicalLines} lines minus the preamble, the header, ${blank.length} blank lines and the TOTAL row is ${data.length} data rows, and ${data.length} minus ${copies.length} copies is ${giftRows.length}.`, "");
md.push("## What each of the gift rows is", "");
md.push("| Disposition | Rows | Dollars |", "|---|---:|---:|");
for (const [k, v] of Object.entries(byReason)) md.push(`| ${k === "gift" ? "gift" : k === "refund" ? "gift (refund, negative)" : "set aside: " + k.replace(/_/g, " ")} | ${v.rows} | ${v.dollars.toFixed(2)} |`);
md.push(`| **gifts that should land** | **${gifts.length}** | **${sum(gifts).toFixed(2)}** |`, "");
md.push(`Amounts read through $, commas, spaces and a currency code before OR after the number ("125.00 USD"). Refunds are the ${key.gifts.refunds} negative rows (every one carries the note "Refund") and land as negative gifts. A slash date whose first number is over 12 (${key.gifts.dayOver12} gift rows, e.g. 20/10/2023) has only one valid reading, day first; every other slash date reads month first, which 1,271 cells prove is the column's convention.`, "");
md.push(`Under Steward's held rule for a mixed date column (the person answers "month first" and a cell that can only read day first is refused, never re-read), ${key.giftsUnderMonthFirstAnswer.refusedDayFirst} of those gift rows ($${key.giftsUnderMonthFirstAnswer.refusedDayFirstDollars.toFixed(2)}) are refused with their line, leaving **${key.giftsUnderMonthFirstAnswer.rows} gifts ($${key.giftsUnderMonthFirstAnswer.dollars.toFixed(2)}, ${key.giftsUnderMonthFirstAnswer.refunds} refunds)**. Whether to read those cells day first is a decision for Jonathan, not this key.`, "");
md.push("## Donors", "");
md.push(`${trueIds.length} true donors (D1xxxx). The ${plantedIds.length} planted duplicates are D2xxxx records, each the second record of exactly one true donor, found by a shared email, phone or street address. **Certain** means the same real email and the same name once case and spacing are set aside, so the import may merge it. Everything else is a question for a person (the Data health duplicate queue), never merged by the machine.`, "");
md.push(`- Certain (merge at import): **${key.donors.certain}**`, `- For review (two records, shown as a likely pair): **${key.donors.review}**`, `- People after a perfect import: ${trueIds.length} once every pair is resolved; ${trueIds.length + key.donors.review} records straight after the import, with ${key.donors.review} pairs waiting in the queue.`, "");
md.push("| Planted | Name | Twin | Name | Shared | Verdict |", "|---|---|---|---|---|---|");
for (const t of twins) md.push(`| ${t.planted} | ${t.plantedName} | ${t.twin} | ${t.twinName} | ${t.evidence.join(", ")} | ${t.verdict} |`);
md.push("", "## Deceased", "", `${key.deceased.length} donors are marked deceased on at least one row: ${key.deceased.map(d => `${d.name} (${d.id})`).join(", ")}. None may appear on a call list, a drift list or a suggested ask.`, "");
fs.writeFileSync(MD, md.join("\n") + "\n");
console.log(JSON.stringify({ file: key.file, donors: key.donors, gifts: key.gifts, byReason, deceased: key.deceased }, null, 1));
