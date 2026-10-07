// oldReports.js · REPORTS-5. BRING YOUR OLD REPORTS WITH YOU.
//
// An organisation switching to Steward brings years of reports from its old
// system, often as PDFs. This module is the pure half of that: it reads a
// report's text and table, says what kind of report it is and which system it
// came from (and why, in one line), finds the period it covers, and turns a
// table the person has mapped into HISTORICAL TOTALS.
//
// The rules it keeps:
//   - A historical total is a number the old system printed, for a period and
//     a kind of report. It is never a gift and never a person: Steward does not
//     turn an old report into giving history, and nothing here writes either.
//   - A PDF is read for its TEXT. A PDF that is only pictures of pages (a scan)
//     has no text to read, and is said to be so; Steward does not guess at
//     the numbers in a picture (no OCR).
//   - A table's "Total" line is the file's own sum of the lines above it. It is
//     set aside, never added in a second time, and the import says so.
//
// Pure: no database, no network. pdfjs-dist is loaded only to read a PDF.
"use strict";

const MAX_BYTES = 25 * 1024 * 1024;          // per file, after decoding
const MAX_FILES = 20;                        // per import
const MAX_TABLE_ROWS = 5000;
const TYPES = { csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel", pdf: "application/pdf" };
const TYPES_SENTENCE = "CSV, Excel (.xlsx or .xls) and PDF files, or a .zip of them, up to 25 MB each and 20 files at a time.";

// The kinds of report Steward recognises, and how each one is counted when it
// becomes a historical total.
const KINDS = {
  giving_summary: { label: "Giving summary", giving: true },
  by_fund: { label: "Gifts by fund or campaign", giving: true },
  lybunt: { label: "LYBUNT or SYBUNT list", giving: false },
  retention: { label: "Retention", giving: false },
  top_donors: { label: "Top donors", giving: false },
  board_report: { label: "Board report", giving: false },
  grant_report: { label: "Grant report", giving: false },
  other: { label: "Other", giving: false },
};
const KIND_KEYS = Object.keys(KINDS);

// The systems Steward recognises BY NAME, and the column names their report
// exports use. A name printed in the file wins over a column match.
const SYSTEMS = {
  bloomerang: { label: "Bloomerang", names: [/bloomerang/i],
    columns: ["account number", "account name", "constituent", "last transaction date", "last transaction amount", "transaction number", "appeal", "revenue"] },
  donorperfect: { label: "DonorPerfect", names: [/donor\s*perfect/i],
    columns: ["donor id", "gl code", "gl_code", "solicit code", "solicit_code", "sub solicit code", "gift_date", "gift date", "gift amount", "gift_total", "# of gifts", "no of gifts"] },
  salesforce: { label: "Salesforce", names: [/salesforce|npsp|nonprofit success pack/i],
    columns: ["opportunity name", "close date", "stage", "account name", "primary campaign source", "amount", "record type"] },
  neon: { label: "Neon CRM", names: [/neon\s*(crm|one)?\b/i],
    columns: ["account id", "donation amount", "donation date", "campaign name", "fund", "tender type"] },
  littlegreenlight: { label: "Little Green Light", names: [/little\s*green\s*light|\blgl\b/i],
    columns: ["lgl constituent id", "constituent name", "gift amount", "gift date", "gift category", "lgl gift id"] },
  zeffy: { label: "Zeffy", names: [/zeffy/i],
    columns: ["form name", "payment status", "payment id", "total amount", "campaign"] },
  quickbooks: { label: "QuickBooks", names: [/quick\s*books|\bqbo\b/i],
    columns: ["customer", "memo/description", "num", "split", "class", "account", "transaction type", "debit", "credit", "balance"] },
};
const SYSTEM_KEYS = Object.keys(SYSTEMS);

const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// ── READING A PDF ──────────────────────────────────────────────────────────
// The text of every page, as LINES: pieces of text on the same baseline,
// left to right. A line's cells are the runs separated by a wide gap, which is
// how a printed table puts its columns apart.
async function readPdf(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true,
    isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.filter(i => i.str && i.str.trim())
      .map(i => ({ s: i.str, x: i.transform[4], y: Math.round(i.transform[5]), w: i.width || i.str.length * 5 }));
    // Same baseline within two points is the same line.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2) last.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    pages.push(lines.map(l => {
      l.items.sort((a, b) => a.x - b.x);
      const cells = [];
      let cur = null;
      for (const it of l.items) {
        if (cur && it.x - (cur.x + cur.w) < 12) { cur.s += (it.x - (cur.x + cur.w) > 1.5 ? " " : "") + it.s; cur.w = it.x + it.w - cur.x; }
        else { cur = { s: it.s, x: it.x, w: it.w }; cells.push(cur); }
      }
      return { y: l.y, cells: cells.map(c => ({ text: c.s.trim(), x: c.x })) };
    }));
  }
  const text = pages.map(ls => ls.map(l => l.cells.map(c => c.text).join("  ")).join("\n")).join("\n\f\n");
  return { pages: doc.numPages, lines: pages.flat(), text, scanned: text.replace(/\s/g, "").length < 20 };
}

// A table from a PDF's lines: the first line with three or more cells, at
// least one of them a word, is the header; every following line with the
// same number of cells (or one fewer, an empty first column) is a row.
function tableFromLines(lines) {
  const isNum = t => /^[-(]?\$?\s?[\d,]+(\.\d+)?\)?%?$/.test(String(t).trim());
  // A year is a heading ("2022  2023"), not a number in the table.
  const isYear = t => /^(fy\s*)?(19|20)\d{2}$/i.test(String(t).trim());
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].cells;
    if (h.length < 2 || h.some(c => isNum(c.text) && !isYear(c.text)) || !h.some(c => /[a-z]/i.test(c.text))) continue;
    const rows = [];
    for (let j = i + 1; j < lines.length && rows.length < MAX_TABLE_ROWS; j++) {
      const c = lines[j].cells;
      if (c.length === h.length && c.some(x => isNum(x.text))) rows.push(c.map(x => x.text));
      else if (rows.length && c.length !== h.length) break;
    }
    if (rows.length >= 2) return { headers: h.map(c => c.text), rows };
  }
  return null;
}

// ── WHAT IS IT, AND FROM WHERE ─────────────────────────────────────────────
function guessSystem({ fileName = "", headers = [], text = "" }) {
  const hay = `${fileName}\n${headers.join(" ")}\n${String(text).slice(0, 20000)}`;
  for (const k of SYSTEM_KEYS) {
    if (SYSTEMS[k].names.some(re => re.test(hay))) return { key: k, label: SYSTEMS[k].label, why: `the file names ${SYSTEMS[k].label}` };
  }
  const hs = new Set(headers.map(norm));
  const scored = SYSTEM_KEYS.map(k => ({ k, hits: SYSTEMS[k].columns.filter(c => hs.has(c)) }))
    .filter(x => x.hits.length >= 2).sort((a, b) => b.hits.length - a.hits.length);
  if (scored.length && !(scored[1] && scored[1].hits.length === scored[0].hits.length)) {
    const s = scored[0];
    return { key: s.k, label: SYSTEMS[s.k].label, why: `columns ${s.hits.slice(0, 3).map(h => `"${h}"`).join(", ")} are how ${SYSTEMS[s.k].label} names them` };
  }
  return { key: "spreadsheet", label: "A spreadsheet or another system", why: "no system's name or column names were found" };
}

function guessKind({ fileName = "", headers = [], text = "" }) {
  const hs = headers.map(norm);
  const has = re => hs.some(h => re.test(h));
  const words = `${fileName} ${String(text).slice(0, 4000)}`.toLowerCase();
  const say = (key, why) => ({ key, label: KINDS[key].label, why });
  // The report's own name first: a board report that mentions retention is
  // still a board report.
  if (/lybunt|sybunt|last year but unfortunately not this|some year but unfortunately not this/.test(words)) return say("lybunt", "it says LYBUNT or SYBUNT");
  if (/board report|board of directors|report to the board|executive summary/.test(words)) return say("board_report", "it is addressed to the board");
  if (/grant report|report to the funder|grant award|funder report/.test(words)) return say("grant_report", "it reads as a report to a funder");
  if (/retention report|donor retention|retention rate/.test(words.slice(0, 400)) || has(/retention|retained/)) return say("retention", "it is about retention");
  if (/top\s*\d*\s*donors|largest donors|major donors/.test(words)) return say("top_donors", "it lists top donors");
  if (has(/^(fund|fund name|fund description|gl code|gl_code|designation|campaign|campaign name|appeal|solicit code|solicit_code)$/) && has(/amount|total|giving|revenue|raised/))
    return say("by_fund", "its rows are funds or campaigns with an amount");
  if (has(/last (gift|transaction)|lifetime/) && has(/name|constituent|donor/) && !has(/^(year|month|period)$/))
    return say("lybunt", "it lists people with their last gift and no gift this year");
  if (has(/^(year|fiscal year|month|period|quarter)$/) && has(/amount|total|giving|revenue|raised/))
    return say("giving_summary", "its rows are periods with a total");
  if (/giving summary|total raised|total giving|revenue summary|year in review/.test(words)) return say("giving_summary", "it summarises giving");
  return say("other", "it does not match one of the report kinds Steward knows");
}

// The period: a year printed in the file name, title or text (FY2024 counts),
// or the span of a date column. Calendar years unless the file says fiscal.
function guessPeriod({ fileName = "", headers = [], rows = [], text = "" }) {
  // A year in the file's NAME is the period it was saved as ("lybunt-2024"),
  // and wins over the dates inside it (a LYBUNT's dates are last gifts).
  const named = String(fileName).match(/(?:^|[^0-9])(?:fy\s*)?((?:19|20)\d{2})(?![0-9])/i);
  if (named) { const y = Number(named[1]); return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), why: `the year ${y} in the file name` }; }
  const hay = `${fileName} ${String(text).slice(0, 3000)}`;
  const years = [...hay.matchAll(/(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/g)].map(m => Number(m[1])).filter(y => y >= 1990 && y <= 2100);
  const dateCol = headers.findIndex(h => /date/i.test(h));
  if (dateCol >= 0) {
    const ds = rows.map(r => String(r[dateCol] || "")).map(isoDay).filter(Boolean).sort();
    if (ds.length) return { from: ds[0], to: ds[ds.length - 1], label: `${ds[0]} to ${ds[ds.length - 1]}`, why: "the dates in the file" };
  }
  if (years.length) {
    const counts = {};
    for (const y of years) counts[y] = (counts[y] || 0) + 1;
    const y = Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]);
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y), why: `the year ${y} printed in it` };
  }
  return null;
}
function isoDay(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

// The whole guess, with the one line that says why.
function guessReport(input) {
  const kind = guessKind(input), system = guessSystem(input), period = guessPeriod(input);
  const why = `${kind.label}, from ${system.label}: ${kind.why}, and ${system.why}${period ? `; the period is ${period.label}, from ${period.why}` : "; no period was found, so say which"}.`;
  return { kind: kind.key, system: system.key, systemLabel: system.label, period, why };
}

// ── A CSV, read on the server ──────────────────────────────────────────────
// RFC 4180: quoted cells may hold commas, quotes ("") and line breaks. A UTF-8
// byte-order mark is dropped. Excel files are read in the browser (SheetJS),
// as SHEETS-1 does; a CSV the server can read itself, so it does.
function parseCsv(text) {
  const t = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some(c => c.trim() !== "")) rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  return { headers, rows: rows.slice(1, MAX_TABLE_ROWS + 1).map(r => headers.map((_, i) => (r[i] ?? "").trim())) };
}

// ── THE NUMBERS ────────────────────────────────────────────────────────────
// Money as the old system printed it: "$1,250.50", "(300.00)" (a negative),
// "1250.5". Returns CENTS, or null for a cell that is not an amount.
function cents(v) {
  const t = String(v ?? "").trim().replace(/\s/g, "");
  if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const body = t.replace(/^[-(]|\)$/g, "").replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(body)) return null;
  const [w, f = ""] = body.split(".");
  return (neg ? -1 : 1) * (Number(w) * 100 + Number((f + "00").slice(0, 2)));
}
function count(v) {
  const t = String(v ?? "").trim().replace(/,/g, "");
  return /^\d+$/.test(t) ? Number(t) : null;
}

// A mapped table → historical totals. `mapping` names column indexes:
//   amount (required), label, period (a year or a date per row), gifts, donors.
// A row with no amount is skipped; a "Total" line is the file's own sum and is
// set aside. Returns the rows, the sum in cents, and what was set aside.
function totalsFromTable({ headers = [], rows = [] }, mapping, filePeriod) {
  if (mapping && mapping.wide) return totalsFromWide({ headers, rows }, mapping);
  const col = k => (mapping && Number.isInteger(mapping[k]) && mapping[k] >= 0 && mapping[k] < headers.length ? mapping[k] : -1);
  const A = col("amount"), Lb = col("label"), P = col("period"), G = col("gifts"), D = col("donors");
  if (A < 0) return { ok: false, error: "Say which column holds the amount." };
  const out = [], setAside = [];
  for (const r of rows.slice(0, MAX_TABLE_ROWS)) {
    const label = Lb >= 0 ? String(r[Lb] ?? "").trim() : "";
    const first = String(r[0] ?? "").trim();
    if (/^(grand\s+)?totals?:?$|^sub-?totals?:?$/i.test(label) || /^(grand\s+)?totals?:?$/i.test(first)) { setAside.push({ reason: "total line", row: r, cents: cents(r[A]) }); continue; }
    const c = cents(r[A]);
    if (c === null) { setAside.push({ reason: "no amount", row: r }); continue; }
    let from = filePeriod && filePeriod.from, to = filePeriod && filePeriod.to;
    if (P >= 0) {
      const pv = String(r[P] ?? "").trim();
      const y = pv.match(/^(?:fy\s*)?((?:19|20)\d{2})$/i);
      const d = isoDay(pv);
      if (y) { from = `${y[1]}-01-01`; to = `${y[1]}-12-31`; }
      else if (d) { from = d; to = d; }
    }
    if (!from || !to) { setAside.push({ reason: "no period", row: r }); continue; }
    out.push({ label: label || null, from, to, cents: c, gifts: G >= 0 ? count(r[G]) : null, donors: D >= 0 ? count(r[D]) : null });
  }
  const sum = out.reduce((s, x) => s + x.cents, 0);
  // The file's own Total line, when it has one, is the check: what was pulled
  // in must add up to what the old system printed, to the cent.
  const tl = setAside.find(x => x.reason === "total line" && x.cents !== null && x.cents !== undefined);
  return { ok: true, rows: out, cents: sum, setAside, fileTotal: tl ? tl.cents : null, footsToFile: tl ? tl.cents === sum : null };
}

// A table with the years across the top ("Measure | 2022 | 2023", the way a
// board report prints it). The person says which row is the total raised (and,
// if they like, which rows are gifts and donors); each year column is a period.
function totalsFromWide({ headers = [], rows = [] }, mapping) {
  const row = k => (Number.isInteger(mapping[k]) && mapping[k] >= 0 && mapping[k] < rows.length ? rows[mapping[k]] : null);
  const A = row("amountRow");
  if (!A) return { ok: false, error: "Say which row holds the total raised." };
  const G = row("giftsRow"), D = row("donorsRow");
  const out = [], setAside = [];
  headers.forEach((h, i) => {
    const y = String(h).trim().match(/^(?:fy\s*)?((?:19|20)\d{2})$/i);
    if (!y) return;
    const c = cents(A[i]);
    if (c === null) { setAside.push({ reason: "no amount", row: [h, A[i]] }); return; }
    out.push({ label: String(A[0] || "Total raised").trim(), from: `${y[1]}-01-01`, to: `${y[1]}-12-31`, cents: c,
      gifts: G ? count(G[i]) : null, donors: D ? count(D[i]) : null });
  });
  if (!out.length) return { ok: false, error: "No column is headed with a year, so there is no period to put the numbers in." };
  return { ok: true, rows: out, cents: out.reduce((s, x) => s + x.cents, 0), setAside, fileTotal: null, footsToFile: null };
}

// What a person would map, guessed from the headers.
function guessMapping(headers = []) {
  const find = re => headers.findIndex(h => re.test(norm(h)));
  const m = {};
  const amount = [/^(total|amount|gift amount|gift total|gift_total|total amount|total giving|revenue|raised|total raised|donation amount|prior year total|last year|last year giving)$/, /amount|total|giving|revenue|raised/];
  for (const re of amount) { const i = find(re); if (i >= 0) { m.amount = i; break; } }
  // A name over a code: "Fund Description" before "GL Code".
  for (const re of [/^(fund name|fund description|campaign name|appeal name|account name|constituent name|donor name)$/,
                    /^(fund|campaign|appeal|designation|name|constituent|donor)$/, /^(gl code|gl_code|solicit code|fund code)$/]) {
    const i = find(re); if (i >= 0 && i !== m.amount) { m.label = i; break; }
  }
  const period = find(/^(year|fiscal year|period|month|quarter)$/);
  if (period >= 0) m.period = period;
  const gifts = find(/^(gifts|# of gifts|no of gifts|number of gifts|gift count|count)$/);
  if (gifts >= 0) m.gifts = gifts;
  const donors = find(/^(donors|# of donors|donor count|unique donors)$/);
  if (donors >= 0) m.donors = donors;
  return m;
}

module.exports = { MAX_BYTES, MAX_FILES, TYPES, TYPES_SENTENCE, KINDS, KIND_KEYS, SYSTEMS, SYSTEM_KEYS,
  readPdf, tableFromLines, parseCsv, guessReport, guessKind, guessSystem, guessPeriod, totalsFromTable, guessMapping, cents };
