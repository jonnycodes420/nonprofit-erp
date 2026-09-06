// Pure, JSX/React-free import-shape detection + transaction grouping — kept in a
// lib (like client/src/lib/money.js) so the Node suite can unit-test it directly
// (tests/import-shape.test.js dynamic-imports it). Donors.jsx imports these so
// there is ONE source of truth for the year-column pattern + the "group a raw
// gift ledger into donors + their individual gifts" logic.
//
// The three shapes a real nonprofit export takes:
//  - aggregate:   one row per donor, with Total Given / Last Gift columns.
//  - transaction: one row per GIFT, donor name/email repeated across many rows.
//  - wide:        one row per donor, with year columns (2022, 2023 Gift, …).

export const YEAR_HDR_PAT = /(19|20)\d{2}|fy[\s_-]?\d{2,4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s\-]+(19|20)\d{2}/i;

// B2 (BUILD-26) — normalize a messy imported name for the preview (shown, still
// fully editable before submit). Three safe transforms: collapse whitespace,
// flip a single "Last, First" → "First Last", and re-case a name ONLY when the
// whole string is entirely upper or entirely lower (ELEANOR FITZGERALD →
// Eleanor Fitzgerald); any internal mixed case is preserved verbatim (McKinney,
// O'Brien, van der Berg). Roman-numeral suffixes stay upper. MUST stay in
// lock-step with normalizeName in server.js (tests/name-normalize.test.js parity).
const _ROMAN_SUFFIX = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|x)$/i;
const _CORP_SUFFIX = /^(inc|llc|l\.l\.c|llp|ltd|co|corp|company|foundation|fdn|trust|fund|society|assn|association|partners|group|plc|gmbh|nfp)\.?$/i;
const _titleCaseWord = w => _ROMAN_SUFFIX.test(w)
  ? w.toUpperCase()
  : w.toLowerCase().replace(/(^|[’'\-.])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
export function normalizeName(raw) {
  if (raw == null) return raw;
  let s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return s;
  const parts = s.split(",");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim() && !_CORP_SUFFIX.test(parts[1].trim()))
    s = parts[1].trim() + " " + parts[0].trim();
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const allUpper = letters && letters === letters.toUpperCase();
  const allLower = letters && letters === letters.toLowerCase();
  if (allUpper || allLower) s = s.replace(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*/g, w => _titleCaseWord(w));
  return s;
}

const numlike = v => {
  if (v === null || v === undefined || v === "") return false;
  return !isNaN(parseFloat(String(v).replace(/[$,\s]/g, "")));
};

// ── Cell normalizers (moved here from Donors.jsx, BUILD-58 Part 2, so the
// pure gift-ledger builder below can use them and the Node suite can test the
// whole pipeline) ───────────────────────────────────────────────────────────
// BUILD-77 Part 2 — EXPLICIT formats only, and NO fallback of any kind.
// The old version ended in `new Date(s)` — the native parser — which is
// PLATFORM-DEPENDENT: Chrome refused "03-16-2020" (so the caller's
// `|| today` fallback stamped the gift with today's UTC date and un-drifted
// the donor) while Node parsed it fine, so no server-side test could ever
// see the browser's failure. A gift with an unparseable date is an ERROR
// with its line number, never a gift dated today.
//
// Supported (the messy-file nine, each matched explicitly):
//   m/d/yyyy · m/d/yy · mm-dd-yyyy · yyyy-mm-dd · yyyy/mm/dd ·
//   "March 4, 2024" · "14 February 2024" · dd-Mon-yy (and dd-Mon-yyyy) ·
//   bare Excel serials (5-digit int, epoch 1899-12-30) · "Mar 2024" (day 1)
// Ambiguous two-digit years resolve to the PAST: 5/12/99 is 1999, never
// 2099 (pivot on the current year — a 2-digit year later than "now" is the
// previous century). Calendar-validated: 2/30 and 13/1 are errors, not
// best-effort guesses.
const MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function validCivil(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const max = m === 2 && leap ? 29 : DAYS_IN_MONTH[m - 1];
  return d <= max && y >= 1900 && y <= 2100;
}
function pivotYear2(yy, currentYear) {
  // resolve to the past: the latest century that keeps the year ≤ current
  const cc = Math.floor(currentYear / 100) * 100;
  const y = cc + yy;
  return y > currentYear ? y - 100 : y;
}
const civil = (y, m, d) => validCivil(y, m, d)
  ? { value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, warn: null }
  : null;
// BUILD-80 Part 2 — normalizeDate grows opts.dayFirst (the COLUMN's slash
// convention, decided by inferDateConvention's evidence, never per cell) and
// the real-world formats the v2 report refused 1,211 rows over: ISO datetimes
// with a Z (civil date is the DATE PART — the BUILD-75 seam says a gift date
// never timezone-converts, so 2025-06-13T03:00:00Z is 13 June, not 12),
// compact 20240315, dotted 2024.03.15, ordinal "March 15th, 2024", and a
// trailing " 0:00" time on slash dates. Excel epoch artifacts (12/31/1899,
// 1/1/1900 and serials 0/1) are refused BY NAME: they are how a spreadsheet
// says "no date", never a gift date.
export function normalizeDate(val, opts = {}) {
  const currentYear = opts.currentYear || new Date().getFullYear();
  const dayFirst = !!opts.dayFirst;
  if (val === null || val === undefined || val === "") return { value: null, warn: null };
  if (val instanceof Date) {
    return isNaN(val) ? { value: null, warn: "invalid date" } : { value: val.toISOString().split("T")[0], warn: null };
  }
  let s = String(val).trim();
  if (!s) return { value: null, warn: null };
  let m, r;
  // trailing time-of-day on any format ("5/3/23 0:00", "2024-03-15 14:30:00")
  s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[APap]\.?[Mm]\.?)?$/, "");
  // Excel epoch artifacts — a spreadsheet's zero, not a gift date
  if (/^(12\/31\/1899|31\/12\/1899|0?1\/0?1\/1900|1900-01-01|1899-12-3[01])$/.test(s)) {
    return { value: null, warn: `'${String(val).trim()}' is the Excel epoch — a spreadsheet's blank, not a gift date` };
  }
  // compact yyyymmdd
  if (m = s.match(/^(\d{4})(\d{2})(\d{2})$/)) {
    if (+m[1] >= 1900 && +m[1] <= 2100 && (r = civil(+m[1], +m[2], +m[3]))) return r;
    return { value: null, warn: `couldn't parse date '${s}'` };
  }
  // dotted yyyy.mm.dd
  if (m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/)) {
    if (r = civil(+m[1], +m[2], +m[3])) return r;
    return { value: null, warn: `not a real calendar date '${s}'` };
  }
  // Excel serial — 5-digit day count from 1899-12-30 (Lotus epoch, bug and all)
  if (/^\d{5}$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 10000 && n < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return { value: d.toISOString().split("T")[0], warn: null };
    }
    return { value: null, warn: `couldn't parse date '${s}'` };
  }
  // yyyy-mm-dd / yyyy/mm/dd
  if (m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/)) {
    if (r = civil(+m[1], +m[2], +m[3])) return r;
    return { value: null, warn: `not a real calendar date '${s}'` };
  }
  // m/d/yyyy and mm-dd-yyyy — or d/m/yyyy when the COLUMN said day-first.
  // No per-cell fallback in either direction: under the wrong convention an
  // impossible month is an ERROR, which is exactly the evidence the column
  // scan counts. Refusing 828 rows and silently misdating 688 more is the
  // worst outcome, and it is what a per-cell parser produces.
  if (m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)) {
    if (r = dayFirst ? civil(+m[3], +m[2], +m[1]) : civil(+m[3], +m[1], +m[2])) return r;
    return { value: null, warn: `not a real calendar date '${s}'` };
  }
  // m/d/yy (or d/m/yy day-first) — two-digit year pivots to the past
  if (m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/)) {
    const y2 = pivotYear2(+m[3], currentYear);
    if (r = dayFirst ? civil(y2, +m[2], +m[1]) : civil(y2, +m[1], +m[2])) return r;
    return { value: null, warn: `not a real calendar date '${s}'` };
  }
  // dd-Mon-yy / dd-Mon-yyyy ("4-Mar-24")
  if (m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/)) {
    const mon = MONTH_NUM[m[2].toLowerCase()];
    const y = m[3].length === 2 ? pivotYear2(+m[3], currentYear) : +m[3];
    if (mon && (r = civil(y, mon, +m[1]))) return r;
    return { value: null, warn: `couldn't parse date '${s}'` };
  }
  // "March 4, 2024" / "Mar 4 2024" / "March 15th, 2024" (ordinal suffix)
  if (m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) {
    const mon = MONTH_NUM[m[1].toLowerCase()];
    if (mon && (r = civil(+m[3], mon, +m[2]))) return r;
    return { value: null, warn: `couldn't parse date '${s}'` };
  }
  // "14 February 2024"
  if (m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/)) {
    const mon = MONTH_NUM[m[2].toLowerCase()];
    if (mon && (r = civil(+m[3], mon, +m[1]))) return r;
    return { value: null, warn: `couldn't parse date '${s}'` };
  }
  // "Jan 2023" / "January 2023" — first of the month
  if (m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/)) {
    const mon = MONTH_NUM[m[1].toLowerCase()];
    if (mon && (r = civil(+m[2], mon, 1))) return r;
  }
  return { value: null, warn: `couldn't parse date '${s}'` };
}

// BUILD-80 Part 1 — the CLOSED money grammar. The old parser stripped every
// non-digit and hoped: "2\u00A0000,00" (French-Canadian Excel, non-breaking-
// space thousands + comma decimal) became 200000 — a $2,000 gift imported as
// $200,000, led the thank-you queue, and inflated "In your file" by $1.5M.
// "$1,5000" parsed as 15000, "1e3" as 1000, "500 (pledge)" as 500, "$25O.00"
// as 25, "500.00-" (SAP trailing minus) as POSITIVE 500. Every accepted shape
// is now explicit; everything else is an error with its line number.
//
// Accepted: $1,000.00 · 1,000 · 1000 · 1000.5 · $ 250 · USD 750.00 ·
//   '1000.00 (Excel text apostrophe) · (500.00) · -$500.00 · 500.00-
//   (trailing minus) · CR 500.00 (credit → negative) · 2.5k · 250 dollars ·
//   1.250,00 (dot thousands, comma decimal) · 2\u00A0000,00 / 2 000,00
//   (space thousands) · 2000,00 (bare comma decimal) · trailing tab/space.
// Refused, by design: 1e3 (a scientific-notation amount in a donor file is a
//   spreadsheet accident, not a gift), $1,5000, 500 (pledge), 1,000.00.,
//   bare $, one hundred, 100..00, $25O.00, and any shape not listed above.
//
// `convention` on the result names a non-US shape that was applied
// ("comma-decimal" | "space-thousands") so the summary can say how many
// amounts were read under which convention. opts.convention === "eu" resolves
// the genuinely ambiguous shapes (1.250 with no decimals, 1,000 in an
// all-European column) — never guessed per cell, only applied when the
// COLUMN's evidence says so (inferAmountConvention).
// BUILD-80 Part 2.2 — the DATE column has a convention, decided at the
// column level from impossible-month evidence. Scan every slash/dash-format
// cell: a first component above 12 is impossible as a month (day-first
// evidence); a second component above 12 is impossible as a day-first month
// (month-first evidence). One-sided evidence decides the whole column; both
// sides non-zero means the column genuinely mixes conventions and the mapper
// must ask a human, showing examples; no evidence defaults to US and says so.
export function inferDateConvention(values = []) {
  let slashCells = 0, dayFirstEvidence = 0, monthFirstEvidence = 0;
  const dayFirstExamples = [], monthFirstExamples = [];
  for (const v of values) {
    const s = String(v ?? "").trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[APap]\.?[Mm]\.?)?$/, "");
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
    if (!m) continue;
    // Excel epoch artifacts (12/31/1899, 1/1/1900) are a spreadsheet's blank,
    // not evidence for either convention — normalizeDate refuses them by name.
    if (/^(12[\/\-]31[\/\-]1899|31[\/\-]12[\/\-]1899|0?1[\/\-]0?1[\/\-]1900|00[\/\-]00[\/\-]0000)$/.test(s)) continue;
    slashCells++;
    const first = +m[1], second = +m[2];
    if (first > 12 && second <= 12) { dayFirstEvidence++; if (dayFirstExamples.length < 3) dayFirstExamples.push(s); }
    else if (second > 12 && first <= 12) { monthFirstEvidence++; if (monthFirstExamples.length < 3) monthFirstExamples.push(s); }
  }
  const convention = dayFirstEvidence > 0 && monthFirstEvidence === 0 ? "dmy"
    : monthFirstEvidence > 0 && dayFirstEvidence === 0 ? "mdy"
    : dayFirstEvidence > 0 && monthFirstEvidence > 0 ? "mixed"
    : "default-mdy";
  return { slashCells, dayFirstEvidence, monthFirstEvidence, dayFirstExamples, monthFirstExamples, convention };
}

export function normalizeMoney(val, opts = {}) {
  if (val === null || val === undefined || val === "") return { value: null, warn: null, blank: true };
  if (typeof val === "number" && !isNaN(val)) return { value: val, warn: null };
  let s = String(val).replace(/[\t\u00A0 ]+$/, "").replace(/^[\t ]+/, "").trim();
  // BUILD-77 Part 3 — deliberate blanks ("", "n/a", "TBD", "-") are a
  // DIFFERENT disposition than an unparseable amount: skipped, not errored.
  if (!s || /^(n\/a|na|tbd|-|—|unknown)$/i.test(s)) return { value: null, warn: null, blank: true };
  const refuse = () => ({ value: null, warn: `couldn't parse amount '${String(val).trim()}'` });
  if (s.startsWith("'")) s = s.slice(1).trim();                      // Excel forcing text
  let sign = 1, negMarks = 0;
  const paren = s.match(/^\((.*)\)$/);                               // accounting negative
  if (paren) { s = paren[1].trim(); sign = -1; negMarks++; }
  if (/^CR\s+/i.test(s)) { s = s.replace(/^CR\s+/i, ""); sign = -1; negMarks++; }  // credit
  if (s.startsWith("-")) { s = s.slice(1).trim(); if (negMarks++) return refuse(); sign = -1; }
  s = s.replace(/^\$\s*/, "");
  // Currency-code prefixes: "USD 750.00" is how QuickBooks and half the
  // legacy CRMs export money. 54 such rows ($154,849.63) vanished from a
  // real file without a trace — the exact silent loss BUILD-77 Part 3 found.
  s = s.replace(/^[A-Za-z]{3}\s+(?=[\d($])/, "");
  s = s.replace(/\s+dollars?$/i, "").trim();
  if (s.endsWith("-")) { s = s.slice(0, -1).trim(); if (negMarks++) return refuse(); sign = -1; }
  let kMult = 1;
  const km = s.match(/^(\d+(?:\.\d{1,2})?)[kK]$/);
  if (km) { kMult = 1000; s = km[1]; }
  if (!s) return refuse();

  const eu = opts.convention === "eu";
  let num = null, convention = null;
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) {                        // 1.250,00 — European
    num = parseFloat(s.replace(/\./g, "").replace(",", "."));
    convention = "comma-decimal";
  } else if (/^\d{1,3}([\u00A0\u202F ]\d{3})+(,\d{2}|\.\d{1,2})?$/.test(s)) {  // 2 000,00 — space thousands
    num = parseFloat(s.replace(/[\u00A0\u202F ]/g, "").replace(",", "."));
    convention = "space-thousands";
  } else if (/^\d+,\d{2}$/.test(s) && !/^\d{1,3},\d{3}$/.test(s)) { // 2000,00 — bare comma decimal
    num = parseFloat(s.replace(",", "."));
    convention = "comma-decimal";
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) {            // 1,000.00 — US grouped
    if (eu && !s.includes(".")) { num = parseFloat(s.replace(",", ".")); convention = "comma-decimal"; }
    else num = parseFloat(s.replace(/,/g, ""));
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {                          // 1000 / 1000.5 — plain
    num = parseFloat(s);
  } else if (eu && /^\d{1,3}(\.\d{3})+$/.test(s)) {                  // 1.250 in an all-EU column
    num = parseFloat(s.replace(/\./g, ""));
    convention = "comma-decimal";
  } else {
    return refuse();
  }
  if (num == null || isNaN(num)) return refuse();
  const out = { value: sign * kMult * num, warn: null };
  if (convention) out.convention = convention;
  return out;
}

// BUILD-80 Part 1.2 — scan an amount COLUMN for its number-format convention
// before parsing it. Evidence, not hope: any cell shaped d.ddd,dd is European;
// any cell with a space (or NBSP) between digit groups is space-thousands; a
// column can carry several conventions at once (two donors pasted from two
// systems into one report) and each cell's own shape decides, so what this
// returns is the EVIDENCE for the summary lines ("12 amounts used a comma
// decimal and were read as such") plus `columnConvention: "eu"` only when the
// comma-decimal evidence is uncontradicted (no US-decimal cell) — that is the
// only case where the ambiguous shapes (1.250 / 1,000) may be read European.
export function inferAmountConvention(values = []) {
  let commaDecimal = 0, spaceThousands = 0, usDecimal = 0, plain = 0;
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (!s || !/\d/.test(s)) continue;
    if (/\d[\u00A0\u202F ]\d{3}/.test(s)) spaceThousands++;
    else if (/\d{1,3}(\.\d{3})+,\d{2}/.test(s) || (/\d,\d{2}$/.test(s) && !/\d,\d{3}/.test(s))) commaDecimal++;
    else if (/\.\d{1,2}$/.test(s)) usDecimal++;
    else plain++;
  }
  return {
    commaDecimal, spaceThousands, usDecimal, plain,
    columnConvention: commaDecimal > 0 && usDecimal === 0 ? "eu" : "us",
  };
}

export function normalizeEmail(val) {
  if (!val) return { value: null, warn: null };
  const s = String(val).trim();
  if (!s) return { value: null, warn: null };
  const lower = s.toLowerCase();
  if (!lower.includes("@") || !lower.includes(".") || lower.length < 5)
    return { value: lower, warn: `invalid email '${s}'` };
  return { value: lower, warn: null };
}

// ── BUILD-58 Part 2 — deceased / do-not-contact flag columns ───────────────
// The single most damaging silent discard the hostile import found: a
// Deceased=Y or Do Not Contact=TRUE column landed the donor as a normal
// solicitable record. These probes are deliberately anchored (no "Deceased
// Spouse Name" false positives); values parse through parseBoolFlag.
const DECEASED_HDR = /^(is\s+)?deceased\??$/i;
const DNC_HDR = /^(do\s*not\s*(contact|solicit|mail|email)|dns|dnc|no\s*(contact|solicitation)|opt(ed)?[\s-]*out)\??$/i;
export function detectFlagColumns(headers = []) {
  const hs = headers.map(h => String(h));
  return {
    deceasedCol: hs.find(h => DECEASED_HDR.test(h.trim())) || "",
    doNotContactCol: hs.find(h => DNC_HDR.test(h.trim())) || "",
  };
}
export function parseBoolFlag(val) {
  const s = String(val == null ? "" : val).trim().toLowerCase();
  if (!s) return false;
  return ["y", "yes", "true", "t", "1", "x", "deceased", "do not contact", "do not solicit", "dnc", "dns", "checked"].includes(s);
}

// ── BUILD-58 Part 2 — THE CLASS FIX: every column accounted for, by name ───
// classifyColumns(headers, mapping, deliberatelyIgnored) → the import summary
// tells the person who ran it exactly what happened to every column:
//   mapped        — imported, with the field it landed in
//   ignored       — the importer KNOWS the column and chose to skip it
//                   (year columns in Import-both, a consumed match-key column)
//   unrecognized  — nobody knows what this is; it was NOT imported
// A silently-discarded column is now impossible: it shows up in one of the
// three lists or the arithmetic assert in the suite fails.
export function classifyColumns(headers = [], mapping = {}, deliberatelyIgnored = []) {
  const ignoredSet = new Set(deliberatelyIgnored.map(h => String(h)));
  const mapped = [], ignored = [], unrecognized = [];
  for (const h of headers.map(x => String(x))) {
    const field = mapping[h];
    if (field) mapped.push({ header: h, field });
    else if (ignoredSet.has(h)) ignored.push(h);
    else unrecognized.push(h);
  }
  return { mapped, ignored, unrecognized };
}

// ── BUILD-58 Part 2 — encoding: never store mojibake ───────────────────────
// A windows-1252 CSV ("José Muñoz") read as UTF-8 stores permanent "Jos�"
// corruption. Try strict UTF-8 first; on any invalid byte fall back to
// windows-1252 (the overwhelmingly common non-UTF8 nonprofit export
// encoding). Strips a UTF-8 BOM.
export function decodeSpreadsheetBytes(bytes) {
  return decodeSpreadsheetBytesDetailed(bytes).text;
}

// BUILD-79 Part 1.4 — decode strictly; on failure repair ONLY the offending
// LINES as windows-1252 and report them. The old whole-file fallback corrupted
// MIXED files: one CP1252 byte anywhere re-decoded every valid UTF-8 name in
// the file into mojibake ("García" → "GarcÃ­a"). Real report exports mix
// encodings line by line (different source systems feeding one report), so the
// repair is per line. Never emits U+FFFD.
export function decodeSpreadsheetBytesDetailed(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) start = 3;
  const body = start ? buf.subarray(start) : buf;
  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    return { text: strict.decode(body), cp1252Lines: [] };
  } catch {
    // split on \n at the BYTE level so line numbers survive the repair
    const lines = [];
    let lineStart = 0;
    for (let i = 0; i <= body.length; i++) {
      if (i === body.length || body[i] === 0x0A) {
        lines.push(body.subarray(lineStart, i));
        lineStart = i + 1;
      }
    }
    // Within a failed line, repair BYTE RUNS: real report exports mix
    // encodings inside one line (a CP1252 "Garc\xEDa" cell beside a valid
    // UTF-8 "García" cell) — decoding the whole line as CP1252 would corrupt
    // the valid cell. Valid UTF-8 sequences decode as UTF-8; only the invalid
    // bytes decode as windows-1252.
    const cp1252 = new TextDecoder("windows-1252");
    const repairLine = (lineBytes) => {
      const out = [];
      let i = 0;
      while (i < lineBytes.length) {
        const b = lineBytes[i];
        let len = b < 0x80 ? 1 : (b & 0xE0) === 0xC0 ? 2 : (b & 0xF0) === 0xE0 ? 3 : (b & 0xF8) === 0xF0 ? 4 : 0;
        let valid = len > 0 && i + len <= lineBytes.length;
        if (valid && len > 1) {
          for (let j = 1; j < len; j++) if ((lineBytes[i + j] & 0xC0) !== 0x80) { valid = false; break; }
          if (valid) { try { strict.decode(lineBytes.subarray(i, i + len)); } catch { valid = false; } }
        }
        if (valid) { out.push(strict.decode(lineBytes.subarray(i, i + len))); i += len; }
        else { out.push(cp1252.decode(lineBytes.subarray(i, i + 1))); i += 1; }
      }
      return out.join("");
    };
    const cp1252Lines = [];
    const out = lines.map((lineBytes, idx) => {
      try {
        return strict.decode(lineBytes);
      } catch {
        cp1252Lines.push(idx + 1); // 1-based physical line number
        return repairLine(lineBytes);
      }
    });
    return { text: out.join("\n"), cp1252Lines };
  }
}

// ── BUILD-79 Part 1 — the report-export layer: find the header by EVIDENCE,
// show the chrome, count records once ─────────────────────────────────────

// A line-aware RFC-4180 record parser. Papa can't report which PHYSICAL line a
// record started on once quoted fields carry embedded newlines — and every
// chrome/refusal report in this layer speaks in line numbers, so the parser
// must know them. Handles quotes, escaped quotes ("") and \r\n.
export function parseCsvRecords(text) {
  const records = [];
  let cells = [], cell = "", inQuotes = false, line = 1, recordLine = 1, sawAny = false;
  const pushCell = () => { cells.push(cell); cell = ""; };
  const pushRecord = () => { pushCell(); records.push({ cells, line: recordLine }); cells = []; sawAny = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      inQuotes = true; sawAny = true;
    } else if (ch === ",") {
      pushCell(); sawAny = true;
    } else if (ch === "\n") {
      pushRecord(); line++; recordLine = line;
    } else if (ch === "\r") {
      // swallow; \r\n ends the record at the \n
    } else {
      cell += ch; sawAny = true;
    }
  }
  if (sawAny || cell !== "" || cells.length) pushRecord();
  return records;
}

// The header vocabulary — a candidate row earns points per cell matching one
// of these (word-boundary, case-insensitive).
const HEADER_VOCAB = [
  "name", "first", "last", "email", "phone", "date", "amount", "gift", "fund",
  "appeal", "id", "notes", "note", "status", "address", "city", "state", "zip",
  "postal", "spouse", "salutation", "frequency", "type", "receipt", "campaign",
  "solicit", "constituent", "donor", "member", "account", "employer", "total",
];
const VOCAB_RE = new RegExp(`\\b(${HEADER_VOCAB.join("|")})\\b`, "i");

const cellNonEmpty = (c) => String(c ?? "").trim() !== "";
const looksNumericCell = (c) => {
  const s = String(c ?? "").trim();
  return s !== "" && !isNaN(parseFloat(s.replace(/[$,%\s]/g, ""))) && /\d/.test(s);
};

// scoreHeaderRow(cells, modalCount) → { score, vocabHits, reasons } — the
// evidence for ONE candidate row. Position contributes NOTHING here.
export function scoreHeaderRow(cells, modalCount) {
  const filled = cells.filter(cellNonEmpty);
  if (!filled.length) return { score: -1, vocabHits: 0, reasons: ["blank row"] };
  const reasons = [];
  let score = 0;
  const vocabHits = filled.filter(c => VOCAB_RE.test(String(c))).length;
  score += vocabHits * 3;
  if (vocabHits) reasons.push(`${vocabHits} cells match header vocabulary`);
  const nonNumeric = filled.filter(c => !looksNumericCell(c)).length;
  if (nonNumeric / filled.length >= 0.8) { score += 4; reasons.push("mostly non-numeric"); }
  const short = filled.filter(c => String(c).trim().length <= 30).length;
  if (short === filled.length) { score += 2; reasons.push("all cells short"); }
  if (filled.length === modalCount) { score += 4; reasons.push(`fills the file's modal column count (${modalCount})`); }
  else if (Math.abs(filled.length - modalCount) <= 2) { score += 1; }
  return { score, vocabHits, reasons };
}

// detectHeaderRow(records) → { index, score, evidence } over the first 20
// records. A row must have ≥3 vocabulary matches to be a header CANDIDATE at
// all; highest score wins; among equal scores the earliest wins (equal-content
// repeats collapse into chrome anyway — position alone never beats evidence).
export function detectHeaderRow(records) {
  const scan = records.slice(0, 20);
  // modal non-empty cell count over a wider sample (the body defines the shape)
  const counts = {};
  for (const r of records.slice(0, 200)) {
    const n = r.cells.filter(cellNonEmpty).length;
    if (n > 0) counts[n] = (counts[n] || 0) + 1;
  }
  const modalCount = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0);
  let best = null;
  for (let i = 0; i < scan.length; i++) {
    const s = scoreHeaderRow(scan[i].cells, modalCount);
    if (s.vocabHits < 3) continue; // not a candidate
    if (!best || s.score > best.score) best = { index: i, score: s.score, evidence: s.reasons };
  }
  if (!best) return { index: 0, score: 0, evidence: ["no row scored as a header — fell back to the first row"], fallback: true };
  return best;
}

// papa-like header naming: trim; blank → _1, _2 (position-stable); duplicate →
// name_1, name_2. The mapper's evidence lines ("_5 → email: …") key off these.
export function dedupeHeaderCells(cells) {
  const seen = new Map();
  let blankN = 0;
  return cells.map(c => {
    let name = String(c ?? "").trim();
    if (!name) name = `_${++blankN}`;
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      return `${name}_${n}`;
    }
    seen.set(name, 0);
    return name;
  });
}

const PAGE_RE = /^page\s+\d+(\s+of\s+\d+)?$/i;
const TOTAL_LABEL_RE = /^(grand\s+)?total[s]?$/i;
const SUBTOTAL_RE = /^sub\s*-?\s*total[s]?$/i;
const END_RE = /^end\s+of\s+report\b/i;
const CURRENCY_RE = /^\(?-?\$\s?[\d,]+(\.\d{1,2})?\)?$/;

// classifyBodyRow(cells, headerCells) → chrome kind or null (a data row).
export function classifyBodyRow(cells, headerCells) {
  const filled = cells.map(c => String(c ?? "").trim()).filter(Boolean);
  if (!filled.length) return { kind: "blank" };
  // an exact repeat of the header (page-break re-print)
  const hc = headerCells.map(c => String(c ?? "").trim());
  const cc = cells.map(c => String(c ?? "").trim());
  if (hc.length && cc.length && hc.filter(Boolean).join(" ") === cc.filter(Boolean).join(" ")) {
    return { kind: "repeated_header" };
  }
  if (filled.length <= 2 && filled.some(c => PAGE_RE.test(c))) return { kind: "page_marker" };
  if (filled.some(c => END_RE.test(c)) && filled.length <= 2) return { kind: "end_marker" };
  const label = filled.find(c => TOTAL_LABEL_RE.test(c));
  const subLabel = filled.find(c => SUBTOTAL_RE.test(c));
  if (label || subLabel) {
    const amountCell = filled.find(c => CURRENCY_RE.test(c));
    const { value } = amountCell ? normalizeMoney(amountCell) : { value: null };
    return { kind: label ? "total_row" : "subtotal_row", amount: value };
  }
  // a line whose ONLY non-empty content is one currency value (an unlabeled
  // report total) is chrome, not a donor
  if (filled.length === 1 && CURRENCY_RE.test(filled[0])) {
    const { value } = normalizeMoney(filled[0]);
    return { kind: "currency_only", amount: value };
  }
  return null;
}

// analyzeSheetRows(records) — records = [{cells, line}] from parseCsvRecords
// (or an XLSX 2-D array mapped to that shape). Returns everything the mapper,
// the summary and the chrome banner need, computed ONCE:
//   headers        deduped field names from the DETECTED header row
//   headerCells    the raw header cells (blanks preserved — the column axis)
//   rows           body row objects keyed by headers (+ __parsed_extra overflow)
//   rowLines       physical line number per body row
//   records        rows.length — THE count every surface shows
//   chromeAbove    [{line, text}] lines above the header (shown, never counted)
//   chromeRows     [{line, kind, text}] excluded rows below it, by line number
//   totalRow       {line, amount} when the report carries its own TOTAL row
//   headerLine     physical line the header was found on + its evidence
export function analyzeSheetRows(records, opts = {}) {
  const det = detectHeaderRow(records);
  const headerRec = records[det.index];
  const headerCells = (headerRec?.cells || []).map(c => String(c ?? "").trim());
  const headers = dedupeHeaderCells(headerCells);
  const chromeAbove = records.slice(0, det.index)
    .map(r => ({ line: r.line, text: r.cells.map(c => String(c ?? "").trim()).filter(Boolean).join(" · ") }))
    .filter(c => true); // blank chrome lines are shown too ("(blank)")
  const rows = [], rowLines = [], chromeRows = [];
  let totalRow = null;
  for (const rec of records.slice(det.index + 1)) {
    const chrome = classifyBodyRow(rec.cells, headerCells);
    if (chrome) {
      if (chrome.kind !== "blank" || rec.cells.some(cellNonEmpty)) {
        chromeRows.push({ line: rec.line, kind: chrome.kind,
          text: rec.cells.map(c => String(c ?? "").trim()).filter(Boolean).join(" · ").slice(0, 120),
          ...(chrome.amount != null ? { amount: chrome.amount } : {}) });
      }
      if ((chrome.kind === "total_row" || chrome.kind === "currency_only") && chrome.amount != null && !totalRow) {
        totalRow = { line: rec.line, amount: chrome.amount };
      }
      continue;
    }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(rec.cells[i] ?? "").trim(); });
    if (rec.cells.length > headers.length) obj.__parsed_extra = rec.cells.slice(headers.length).map(c => String(c ?? "").trim());
    rows.push(obj);
    rowLines.push(rec.line);
  }
  // physical-column equation (BUILD-78) from the DETECTED header, not line 1
  let maxOverflow = 0, overflowRows = 0;
  for (const r of rows) {
    const extra = r.__parsed_extra ? r.__parsed_extra.length : 0;
    if (extra > 0) { overflowRows++; if (extra > maxOverflow) maxOverflow = extra; }
  }
  return {
    headers, headerCells, rows, rowLines, records: rows.length,
    chromeAbove, chromeRows, totalRow,
    headerLine: { line: headerRec?.line ?? 1, index: det.index, evidence: det.evidence, fallback: !!det.fallback },
    physical: { headerCells, headerCount: headerCells.length, orphanColumns: maxOverflow, overflowRows, total: headerCells.length + maxOverflow },
  };
}

// ── BUILD-79 Part 5 — a column that fails its own type check cannot be
// mapped to that type. The evidence is computed from the VALUES (all of them,
// not a 10-row sample) and shown with every guess/refusal:
//   "_5 → email: 0 of 2,438 values contain @; 2,391 look like phone numbers".
const PHONE_SHAPE_RE = /^[+()\d][\d\s().+-]{6,}$/;
export function columnTypeEvidence(field, values = []) {
  const vals = values.map(v => String(v ?? "").trim()).filter(Boolean);
  const n = vals.length;
  const fmtN = x => x.toLocaleString();
  if (!n) return { ok: true, summary: "no values to check" };
  if (field === "email") {
    const at = vals.filter(v => v.includes("@")).length;
    const phoneish = vals.filter(v => PHONE_SHAPE_RE.test(v)).length;
    const ok = at / n >= 0.1;
    return { ok, summary: `${fmtN(at)} of ${fmtN(n)} values contain @` + (phoneish > n / 2 ? `; ${fmtN(phoneish)} look like phone numbers` : "") };
  }
  if (field === "phone") {
    const ph = vals.filter(v => (v.match(/\d/g) || []).length >= 7).length;
    return { ok: ph / n >= 0.1, summary: `${fmtN(ph)} of ${fmtN(n)} values look like phone numbers` };
  }
  if (field === "lastGift") {
    const parsed = vals.filter(v => normalizeDate(v).value != null).length;
    return { ok: parsed / n >= 0.1, summary: `${fmtN(parsed)} of ${fmtN(n)} values parse as dates` };
  }
  if (field === "total" || field === "lastAmount") {
    const parsed = vals.filter(v => { const r = normalizeMoney(v); return r.value != null && /\d/.test(v); }).length;
    return { ok: parsed / n >= 0.1, summary: `${fmtN(parsed)} of ${fmtN(n)} values parse as amounts` };
  }
  if (field === "gifts") {
    const ints = vals.filter(v => /^\d{1,5}$/.test(v)).length;
    return { ok: ints / n >= 0.1, summary: `${fmtN(ints)} of ${fmtN(n)} values are whole numbers` };
  }
  return { ok: true, summary: "" };
}

// validateMappingChoice(headers, rows, header, field) — the type check above,
// plus the relationship rules a shape can see: a Spouse-ish column can never
// take a name role while the file carries a real name column for that role.
const SPOUSE_HDR_RE = /\bspouse|partner\b/i;
export function validateMappingChoice(headers = [], rows = [], header, field) {
  if (!field) return { ok: true, summary: "" };
  const hs = headers.map(h => String(h));
  if ((field === "_lastName" || field === "_firstName" || field === "name") && SPOUSE_HDR_RE.test(String(header))) {
    const want = field === "_lastName" ? /^(last\s*name|lastname|surname|family name)$/i
               : field === "_firstName" ? /^(first\s*name|firstname|given name)$/i
               : /^(name|full ?name|donor ?name)$/i;
    const real = hs.find(h => want.test(h.trim()));
    if (real) return { ok: false, summary: `“${header}” is a spouse column and this file already has “${real}” — a first name plus a spouse's first name is not a person` };
  }
  const ev = columnTypeEvidence(field, rows.map(r => r[header]));
  if (!ev.ok) return { ok: false, summary: ev.summary + " — refused" };
  return { ok: true, summary: ev.summary };
}

// BUILD-79 Part 3.1 — the INDEPENDENT amount scan. The dollar line's left side
// must come from the raw file, never from the mapping: when no amount column is
// mapped, both sides of the old dollar equation were zero, so a file whose own
// TOTAL row read $2,035,978.52 reported "Balanced · $0". This scans every
// column for currency-shaped values and sums the best candidate, mapping or no
// mapping. Excluded: id/zip/phone/year/count-shaped headers.
const AMOUNT_EXCLUDE_HDR = /\b(zip|postal|phone|fax|id|#|number|no\.|year|count|qty|quantity|age|score)\b/i;
export function scanAmountShapedColumns(headers = [], rows = []) {
  const candidates = [];
  for (const h of headers.map(x => String(x))) {
    if (AMOUNT_EXCLUDE_HDR.test(h) || YEAR_HDR_PAT.test(h)) continue;
    // BUILD-80 Part 1 — the scan speaks the same closed grammar as the import:
    // "1.250,00" and "2\u00A0000,00" are currency (convention-inferred), and a
    // trap like "$1,5000" is NOT — the scan's sum is the number the summary
    // shows as "in your file", so it must be the convention-correct one.
    const conv = inferAmountConvention(rows.map(r => r[h]));
    const cellOpts = conv.columnConvention === "eu" ? { convention: "eu" } : {};
    let nonEmpty = 0, currency = 0, dollarSigns = 0, sum = 0;
    for (const r of rows) {
      const raw = String(r[h] ?? "").trim();
      if (!raw) continue;
      nonEmpty++;
      if (/\d/.test(raw)) {
        const { value, blank } = normalizeMoney(raw, cellOpts);
        if (!blank && value != null && Math.abs(value) < 1e9) {
          currency++; sum += value;
          if (raw.includes("$")) dollarSigns++;
        }
      }
    }
    if (nonEmpty >= 5 && currency / nonEmpty >= 0.5 && currency >= 5) {
      candidates.push({ header: h, nonEmpty, currencyCells: currency, dollarSigns, sum: Math.round(sum * 100) / 100 });
    }
  }
  // most currency-shaped cells wins; $-signs break ties (a bare-integer column
  // like gift counts can pass the shape test, a $-carrying one is the money)
  candidates.sort((a, b) => (b.currencyCells - a.currencyCells) || (b.dollarSigns - a.dollarSigns));
  return candidates[0] || null;
}

// analyzeCsvText(text, opts) — the one-call CSV entry: records → analysis.
export function analyzeCsvText(text, opts = {}) {
  return analyzeSheetRows(parseCsvRecords(text), opts);
}

// ── BUILD-58 Part 2 — the ONE gift-ledger row builder (used by Import-both) ─
// Extracted from Donors.jsx's buildBothPayload so it is pure and testable.
// Carries externalId (the F-4 cross-run idempotency key — previously DROPPED
// on this surface) and returns a row REPORT so skipped rows always have a
// stated reason: negative amounts are refunds (not imported — Steward has no
// negative-gift model), unparsable amounts are named, zero-amount rows
// counted. tx = { donorEmail, donorName, amount, date, type, campaign,
// notes, externalId, phone } (header names or "").
export function buildGiftItemsFromLedger(rows = [], tx = {}, idCol = "") {
  const report = { giftRows: rows.length, builtGifts: 0, negativeRows: 0, unparsableAmountRows: 0, unparsableDateRows: 0, zeroAmountRows: 0, noAmountColumn: !tx.amount };
  // BUILD-80 Part 2 — the gift sheet's date column has a convention too.
  const ledgerDateConv = tx.date ? inferDateConvention(rows.map(r => r[tx.date])) : null;
  const ledgerDayFirst = !!(ledgerDateConv && ledgerDateConv.convention === "dmy");
  const items = rows.map(row => {
    const rawEmail = tx.donorEmail ? String(row[tx.donorEmail] || "").trim() : "";
    const name = tx.donorName ? String(row[tx.donorName] || "").trim() : "";
    const donorId = idCol ? String(row[idCol] || "").trim() : "";
    let gift = null;
    if (tx.amount) {
      const rawAmount = row[tx.amount];
      const { value: amtVal, warn } = normalizeMoney(rawAmount);
      if (amtVal == null) {
        if (String(rawAmount ?? "").trim() !== "") { report.unparsableAmountRows++; }
      } else if (amtVal < 0) {
        report.negativeRows++;
      } else {
        const amt = Math.round(amtVal);
        if (amt > 0) {
          const { value: parsedDate } = normalizeDate(tx.date ? row[tx.date] : "", { dayFirst: ledgerDayFirst });
          // BUILD-79 Part 4 — no date defaults to today, on ANY path. A gift
          // whose date does not parse rides with date:null; the server's
          // ledger errors it as unparseable_or_missing_date with its row,
          // which is an accounted refusal instead of a silent un-drift.
          if (!parsedDate) report.unparsableDateRows = (report.unparsableDateRows || 0) + 1;
          gift = {
            amount: amt,
            date: parsedDate,
            type: tx.type ? (String(row[tx.type] || "").toLowerCase() || "cash") : "cash",
            campaign: tx.campaign ? String(row[tx.campaign] || "") : "",
            notes: tx.notes ? String(row[tx.notes] || "") : "",
            externalId: tx.externalId ? (String(row[tx.externalId] || "").trim() || undefined) : undefined,
          };
          report.builtGifts++;
        } else {
          report.zeroAmountRows++;
        }
      }
      void warn;
    }
    const { value: email } = normalizeEmail(rawEmail);
    return { email: email || "", name, donorId, gift };
  });
  return { items, report };
}

// Column-role probes on header text (deliberately loose — a human can override).
const isDateHdr   = h => /\b(date|when)\b|gift ?date|donation ?date/i.test(String(h)) && !YEAR_HDR_PAT.test(String(h).replace(/date/ig, ""));
const isAmountHdr = h => {
  const s = String(h).trim();
  if (YEAR_HDR_PAT.test(s)) return false;
  return /^(amount|gift ?amount|donation ?amount|gift|giving|donation|sum|contribution|paid)\b/i.test(s);
};
const isTotalHdr  = h => /^total$/i.test(String(h).trim()) || /(total|lifetime|cumulative)\s*(giv|donat|amount|contrib|raised)/i.test(String(h));
const isNameHdr   = h => /^(name|full ?name|donor ?name|donor|contact|constituent)$/i.test(String(h).trim());
// "Donor Email" is the most common real-world gift-export header there is —
// the old ^email$ anchor missed it and Import-both silently fell back to
// LINK BY NAME, splitting donor histories (BUILD-57 §2b finding 2). Accepts
// an optional donor/contact/primary/billing qualifier; still anchored so
// "Emailed Receipt" can never false-positive.
const isEmailHdr  = h => /^(donor|contact|primary|billing)?\s*e-?mail(\s*address)?$/i.test(String(h).trim());

// detectImportShape(headers, rows) → { shape, yearCols, signals… }
// `rows` is the parsed row objects (keyed by header). Only a sample is scanned.
export function detectImportShape(headers = [], rows = []) {
  const hs = headers.map(h => String(h));
  const sample = rows.slice(0, 50);

  // Year columns that actually carry numeric data in the sample.
  const yearCols = hs
    .filter(h => YEAR_HDR_PAT.test(h) && !/^date$/i.test(h.trim()))
    .filter(col => sample.some(r => numlike(r[col])));

  const hasDateCol  = hs.some(isDateHdr);
  const amountCols  = hs.filter(isAmountHdr).filter(col => sample.some(r => numlike(r[col])));
  const hasAmountCol = amountCols.length > 0;
  const hasTotalCol = hs.some(isTotalHdr);

  // Does the same donor identifier repeat across rows? A ledger of individual
  // gifts repeats the donor; an aggregate/wide file has one row per donor.
  const nameCol  = hs.find(isNameHdr);
  const emailCol = hs.find(isEmailHdr);
  let donorRepeats = false, distinctDonors = 0, keyedRows = 0;
  if (nameCol || emailCol) {
    const seen = new Set();
    for (const r of sample) {
      const key = (emailCol && String(r[emailCol] || "").toLowerCase().trim())
                || (nameCol && String(r[nameCol] || "").toLowerCase().trim()) || "";
      if (!key) continue;
      keyedRows++;
      if (seen.has(key)) donorRepeats = true;
      seen.add(key);
    }
    distinctDonors = seen.size;
  }

  // BUILD-79 Part 2.1 — the RECOGNIZED columns are the evidence a shape
  // decision stands on. When fewer than three columns are recognised at all,
  // shape is UNKNOWN and the mapper asks — it does not pick. "One row per
  // donor" was once chosen for a report export because a wrong header made
  // zero columns recognisable, and 1,111 donors landed with $0 of giving.
  const recognized = [];
  for (const h of hs) {
    if (isDateHdr(h)) recognized.push({ header: h, as: "gift date" });
    else if (isAmountHdr(h)) recognized.push({ header: h, as: "amount" });
    else if (isTotalHdr(h)) recognized.push({ header: h, as: "lifetime total" });
    else if (isNameHdr(h)) recognized.push({ header: h, as: "donor name" });
    else if (isEmailHdr(h)) recognized.push({ header: h, as: "email" });
    else if (yearCols.includes(h)) recognized.push({ header: h, as: "year column" });
    else if (/^(first|last)\s*name$/i.test(h.trim())) recognized.push({ header: h, as: h.trim().toLowerCase() });
    else if (/^phone(\s*(number|#))?$/i.test(h.trim())) recognized.push({ header: h, as: "phone" });
  }

  let shape, reason;
  if (yearCols.length >= 2 && !hasDateCol) { shape = "wide"; reason = `${yearCols.length} year columns, no gift-date column`; }
  else if (hasAmountCol && hasDateCol && !hasTotalCol) { shape = "transaction"; reason = "amount + gift-date columns, no lifetime-total column"; }
  else if (hasAmountCol && hasDateCol && donorRepeats) { shape = "transaction"; reason = "amount + gift-date columns and the same donor repeats across rows"; }
  else if (yearCols.length >= 2) { shape = "wide"; reason = `${yearCols.length} year columns`; }
  else if (recognized.length < 3) { shape = "unknown"; reason = `only ${recognized.length} column${recognized.length === 1 ? "" : "s"} recognised — not enough evidence to pick a shape`; }
  else { shape = "aggregate"; reason = "donor-identity and total-style columns, no per-gift date column"; }

  return { shape, reason, recognized, yearCols, hasDateCol, hasAmountCol, hasTotalCol, donorRepeats, distinctDonors, keyedRows, nameCol: nameCol || "", emailCol: emailCol || "" };
}

// BUILD-79 Part 2.2 — the signal totals mode must not ignore: when more than a
// third of the keyed rows in an aggregate ("one row per donor") import collapse
// onto a key already seen IN THE SAME FILE, the file is one row per GIFT and
// the shape is wrong. Returns the evidence; the mapper refuses to proceed.
export function assessAggregateCollapse(rows = [], emailCol = "", nameCol = "") {
  let keyedRows = 0, collapsed = 0;
  const seen = new Set();
  for (const r of rows) {
    const key = (emailCol && String(r[emailCol] || "").toLowerCase().trim())
             || (nameCol && String(r[nameCol] || "").toLowerCase().trim()) || "";
    if (!key) continue;
    keyedRows++;
    if (seen.has(key)) collapsed++;
    else seen.add(key);
  }
  const ratio = keyedRows ? collapsed / keyedRows : 0;
  return { keyedRows, distinct: seen.size, collapsed, ratio, refuse: keyedRows >= 30 && ratio > 1 / 3 };
}

// A short, honest one-line description for the detection banner.
export function shapeLabel(shape) {
  if (shape === "transaction") return "individual gifts — we'll build donors + their giving history";
  if (shape === "wide")        return "year-column giving — we'll build donors + a gift per year";
  if (shape === "unknown")     return "we can't tell how this file is shaped — choose below before importing";
  return "one row per donor — we'll import donors and their totals";
}

// ── "Import both" — a multi-sheet workbook that carries a Donors sheet AND a
// Gift History sheet (the most common real-world CRM export) ────────────────
// The idea: instead of forcing the user to pick one sheet, detect the two roles
// (donor-shaped vs gift-ledger-shaped), link the gift rows to the donor rows by
// a shared key, and import in one pass so a first-timer drops one workbook and
// gets a full CRM. All pure/JSX-free so tests/import-both.test.js can drive it.

// A donor-id column probe (loose — a human can override the match column). Kept
// deliberately conservative: matches "Donor ID", "Constituent ID", "Account #",
// bare "ID"/"PID"/"CID" — but NOT "email"/"paid"/"valid" etc.
const isDonorIdHdr = h => {
  const s = String(h || "").trim();
  if (/^(donor|constituent|account|contact|record|supporter|member|customer)\s*(id|no\.?|number|#)$/i.test(s)) return true;
  return /^(id|pid|cid|acct|account)$/i.test(s);
};
export function findDonorIdHdr(headers = []) {
  return headers.map(h => String(h)).find(isDonorIdHdr) || "";
}

// detectWorkbookRoles(sheets) — given the parsed sheets of one workbook
// ([{name, headers, rows, rowCount}]), run detectImportShape on each and pick
// the donor-shaped sheet (aggregate|wide = one row per donor) and the gift-
// ledger sheet (transaction = one row per gift). `isBoth` is true only when a
// DISTINCT donor sheet AND gift sheet are both present — the trigger for the
// "Import both" CTA.
export function detectWorkbookRoles(sheets = []) {
  const roled = sheets.map(s => ({
    name: s.name,
    headers: s.headers || [],
    rows: s.rows || [],
    rowCount: s.rowCount != null ? s.rowCount : (s.rows ? s.rows.length : 0),
    det: detectImportShape(s.headers || [], s.rows || []),
  }));
  const donorSheet = roled.find(s => s.det.shape === "aggregate" || s.det.shape === "wide") || null;
  const giftSheet  = roled.find(s => s !== donorSheet && s.det.shape === "transaction") || null;
  return { roled, donorSheet, giftSheet, isBoth: !!(donorSheet && giftSheet) };
}

// pickMatchKey(donorSheet, giftSheet) — decide which shared column links a gift
// row to its donor, in priority order: email → donor name → donor-id column.
// Returns the chosen key, the resolved columns on each sheet, and every
// available key (so the UI can offer an override dropdown).
export function pickMatchKey(donorSheet, giftSheet) {
  const dEmail = donorSheet?.det?.emailCol || "";
  const dName  = donorSheet?.det?.nameCol  || "";
  const dId    = findDonorIdHdr(donorSheet?.headers || []);
  const gEmail = giftSheet?.det?.emailCol || "";
  const gName  = giftSheet?.det?.nameCol  || "";
  const gId    = findDonorIdHdr(giftSheet?.headers || []);
  const available = [];
  if (dEmail && gEmail) available.push("email");
  if (dName  && gName)  available.push("name");
  if (dId    && gId)    available.push("donorId");
  const key = available[0] || "name"; // name is the universal fallback
  return { key, available, donorEmailCol: dEmail, donorNameCol: dName, donorIdCol: dId, giftEmailCol: gEmail, giftNameCol: gName, giftIdCol: gId };
}

// linkGiftsToDonors(donors, giftItems, matchKey) — the one-pass link.
//  donors:    normalized donor rows from the donor sheet. Each may carry an
//             optional `_donorId` (used only when matchKey==='donorId'); it is
//             stripped from the output. `_stageExplicit` is preserved (the
//             server honors it).
//  giftItems: [{ email, name, donorId, gift:{amount,date,type,campaign,notes} }]
//             — one per gift-ledger row.
//  matchKey:  'email' | 'name' | 'donorId'.
// Returns { donors, gifts:[{...gift, donorIndex}], matchedGifts, unmatchedGifts,
//   newDonors, skippedGifts } — exactly the { donors, gifts } shape
// /donors/import-combined consumes. A gift whose donor isn't in the donor sheet
// is NEVER silently dropped: a minimal donor is created from the gift row
// (deduped by the gift's own email-else-name) so its history survives; only a
// gift row with no gift OR no donor identity at all is counted as skipped.
export function linkGiftsToDonors(donors = [], giftItems = [], matchKey = "email") {
  const norm = v => String(v == null ? "" : v).toLowerCase().trim();
  const donorKey = d => matchKey === "email" ? norm(d.email)
                      : matchKey === "donorId" ? norm(d._donorId)
                      : norm(d.name);
  const giftKey = g => matchKey === "email" ? norm(g.email)
                     : matchKey === "donorId" ? norm(g.donorId)
                     : norm(g.name);

  const outDonors = donors.map(d => { const { _donorId, ...rest } = d; return rest; });
  const idxByKey = new Map();
  donors.forEach((d, i) => { const k = donorKey(d); if (k && !idxByKey.has(k)) idxByKey.set(k, i); });

  const gifts = [];
  const minimalByKey = new Map(); // unmatched donor natural-key → outDonors index
  let matchedGifts = 0, unmatchedGifts = 0, newDonors = 0, skippedGifts = 0;

  for (const item of giftItems) {
    if (!item || !item.gift) { skippedGifts++; continue; }
    const gk = giftKey(item);
    let di = gk ? idxByKey.get(gk) : undefined;
    if (di !== undefined) {
      matchedGifts++;
    } else {
      // Unmatched — create (or reuse) a minimal donor from the gift row.
      const minKey = norm(item.email) || norm(item.name);
      if (!minKey) { skippedGifts++; continue; } // no donor identity → can't attach
      if (minimalByKey.has(minKey)) {
        di = minimalByKey.get(minKey);
      } else {
        di = outDonors.length;
        const md = { name: (item.name || item.email || "Unknown donor"), email: item.email || "", stage: "prospect" };
        if (item.phone) md.phone = item.phone;
        outDonors.push(md);
        minimalByKey.set(minKey, di);
        newDonors++;
      }
      unmatchedGifts++;
    }
    gifts.push({ ...item.gift, donorIndex: di });
  }
  return { donors: outDonors, gifts, matchedGifts, unmatchedGifts, newDonors, skippedGifts };
}

// ── Owner / assigned-officer column → org-user mapping (Team import routing) ──
// A real CRM export usually names the gift officer working each donor in an
// "Assigned Officer" / "Owner" / "Solicitor" / "Portfolio" column. On a Team
// import we detect that column and map its values to org users — by EMAIL first,
// then by NAME (fuzzy-tolerant) — so each donor lands in the right officer's
// portfolio. Pure/JSX-free so tests/import-assign.test.js drives it directly.
// (Core imports ignore this — the server only applies assignment for Team.)

// Header probe for an owner/officer column (loose — a human can override in the
// UI). Deliberately anchored so it doesn't grab "email"/"phone"/"employer".
const OWNER_HDR_PAT = /^(assigned\s*(officer|to|staff|rep)?|owner|solicitor|portfolio|gift\s*officer|relationship\s*(manager|officer)|account\s*(manager|owner)|managed\s*by|steward(ed)?\s*by|mgo|officer|fundraiser|assigned\s*fundraiser)$/i;

export function detectOwnerColumn(headers = []) {
  return headers.map(h => String(h)).find(h => OWNER_HDR_PAT.test(String(h).trim())) || "";
}

// Normalize a person name for fuzzy matching: lowercase, collapse spaces, and
// flip "Last, First" → "First Last" so an export's sort order can't miss.
function normPersonName(v) {
  let s = String(v == null ? "" : v).toLowerCase().trim().replace(/\s+/g, " ");
  const ci = s.indexOf(",");
  if (ci > 0) s = (s.slice(ci + 1).trim() + " " + s.slice(0, ci).trim()).trim();
  return s.replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

// Small bounded Levenshtein (early-outs past `max`) — for tolerating a typo or a
// middle initial in an officer name. Never used to force an ambiguous match.
function boundedLev(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// tokenSubset — every token of the shorter name appears in the longer (handles
// "Sarah Lee" vs "Sarah A. Lee", or a bare first name matching one unique user).
function tokenSubset(a, b) {
  const ta = a.split(" ").filter(Boolean), tb = b.split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every(t => long.includes(t));
}

// matchOwnerValue(value, users, idx) → { userId, userName, matchType }.
// matchType ∈ 'email' | 'name' | 'none'. Email is exact (case-insensitive);
// name is exact-normalized, else a UNIQUE fuzzy hit (token-subset or Lev≤2).
// Ambiguity (a value that fits >1 user) resolves to 'none' — never mis-assign.
function matchOwnerValue(value, users, idx) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return { userId: null, userName: null, matchType: "none" };
  const lower = raw.toLowerCase();
  // 1 — email (only meaningful when the value looks like an address)
  if (lower.includes("@") && idx.byEmail.has(lower)) {
    const u = idx.byEmail.get(lower);
    return { userId: u.id, userName: u.name, matchType: "email" };
  }
  const nn = normPersonName(raw);
  if (!nn) return { userId: null, userName: null, matchType: "none" };
  // 2 — exact normalized name (unique)
  const exact = idx.byName.get(nn);
  if (exact && exact.length === 1) return { userId: exact[0].id, userName: exact[0].name, matchType: "name" };
  if (exact && exact.length > 1) return { userId: null, userName: null, matchType: "none" }; // ambiguous
  // 3 — unique fuzzy: token-subset OR Lev≤2 against a single user
  const fuzzy = users.filter(u => {
    const un = normPersonName(u.name);
    return un && (tokenSubset(nn, un) || boundedLev(nn, un, 2) <= 2);
  });
  if (fuzzy.length === 1) return { userId: fuzzy[0].id, userName: fuzzy[0].name, matchType: "name" };
  return { userId: null, userName: null, matchType: "none" };
}

// matchOwnersToUsers(values, users) — map the distinct owner-cell values to org
// users. `values` is the full per-row list (may repeat / be blank). Returns one
// entry per DISTINCT non-blank value: { value, count, userId, userName, matchType }.
export function matchOwnersToUsers(values = [], users = []) {
  const counts = new Map();
  for (const v of values) {
    const key = String(v == null ? "" : v).trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const idx = { byEmail: new Map(), byName: new Map() };
  for (const u of users) {
    if (u.email) idx.byEmail.set(String(u.email).toLowerCase().trim(), u);
    const nn = normPersonName(u.name);
    if (nn) { if (!idx.byName.has(nn)) idx.byName.set(nn, []); idx.byName.get(nn).push(u); }
  }
  const out = [];
  for (const [value, count] of counts) {
    const m = matchOwnerValue(value, users, idx);
    out.push({ value, count, userId: m.userId, userName: m.userName, matchType: m.matchType });
  }
  return out;
}

// groupOwnerMatches(matches) — collapse the per-DISTINCT-value rows from
// matchOwnersToUsers() onto the PEOPLE they resolve to, so the mapping UI shows
// "Jonathan — 2,190 donors, from 4 spellings" once instead of four separate
// rows. `matches` = matchOwnersToUsers() output. Returns { groups, unmatched }:
//   groups  = [{ userId, userName, matchType, totalCount, spellingCount,
//               values:[{value,count,matchType}] }]  — one per resolved user
//             (email preferred as the headline matchType); always overridable.
//   unmatched = [{ value, count }]  (matchType 'none' — keep Invite / Leave).
// Pure/JSX-free so tests/import-assign.test.js drives it directly.
export function groupOwnerMatches(matches = []) {
  const byUser = new Map();
  const unmatched = [];
  for (const m of matches) {
    if (!m.userId) { unmatched.push({ value: m.value, count: m.count || 0 }); continue; }
    if (!byUser.has(m.userId)) byUser.set(m.userId, { userId: m.userId, userName: m.userName, matchType: m.matchType, totalCount: 0, values: [] });
    const g = byUser.get(m.userId);
    g.totalCount += m.count || 0;
    g.values.push({ value: m.value, count: m.count || 0, matchType: m.matchType });
    if (m.matchType === "email") g.matchType = "email"; // email is the strongest headline signal
  }
  const groups = [...byUser.values()]
    .map(g => ({ ...g, spellingCount: g.values.length, values: g.values.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.totalCount - a.totalCount);
  return { groups, unmatched: unmatched.sort((a, b) => b.count - a.count) };
}

// applyOwnerAssignment(donors, resolved) — stamp assignedTo/assignedToName onto
// each donor from its raw `owner` cell, then strip `owner`. `resolved` maps the
// lowercased+trimmed owner value → { userId, userName } (only the values the
// admin confirmed to a real teammate). Donors whose owner is blank/unresolved
// come back UNASSIGNED — never silently mis-routed.
export function applyOwnerAssignment(donors = [], resolved = {}) {
  return donors.map(d => {
    const { owner, ...rest } = d;
    const key = String(owner == null ? "" : owner).toLowerCase().trim();
    const hit = key ? resolved[key] : null;
    if (hit && hit.userId) { rest.assignedTo = hit.userId; rest.assignedToName = hit.userName || null; }
    return rest;
  });
}

// groupTransactions(items) — the core "group a raw gift ledger by donor" step.
// items: [{ key, donor, gift }]  (key = dedup key, gift may be null).
// The FIRST occurrence of a key defines the canonical donor; later rows only
// fill in blank scalar fields (never overwrite a non-blank value). Every
// non-null gift becomes a gift row carrying its donor's index in `donors` —
// exactly the { donors, gifts:[{donorIndex}] } shape /donors/import-combined
// consumes, so the server dedupes, attaches, recalcs, and re-infers stage.
export function autoDetectTxMapping(headers, rows) {
  // BUILD-77 Part 3d — auto-map by header name for EVERY field the schema
  // has. A real export's Phone/Address/City/State/ZIP columns used to be
  // silently discarded ("an org that imports and then cannot mail anyone has
  // lost the thing they came for"); anything that still has no home is named
  // on the mapping screen and requires an acknowledgement before the write.
  const map = { donorName:"",firstName:"",lastName:"",orgName:"",donorEmail:"",amount:"",date:"",type:"",campaign:"",notes:"",phone:"",address:"",city:"",state:"",zip:"",owner:"",externalId:"" };
  const sample = rows.slice(0,10);
  for (const h of headers) {
    const hl = h.toLowerCase().trim();
    if (!map.donorName  && /^(name|full.?name|donor.?name|donor|contact|constituent)$/.test(hl)) map.donorName  = h;
    if (!map.firstName  && /^first.?name$/.test(hl))                                    map.firstName = h;
    if (!map.lastName   && /^last.?name$/.test(hl))                                     map.lastName  = h;
    if (!map.orgName    && /^(org(anization)?.?name|company)$/.test(hl))                map.orgName   = h;
    if (!map.donorEmail && /^(email|email.?address|e-?mail)$/.test(hl))                          map.donorEmail = h;
    // BUILD-45 §1.2 F-4 — a source-system gift/transaction id is the ONLY safe
    // gift dedup key; (donor, amount, date) never is. Anchored so a bare "ID"
    // (usually the donor id) or "Donor ID" is never grabbed.
    if (!map.externalId && /^(gift.?id|transaction.?id|txn.?id|payment.?id|external.?id|reference(.?(no|number|id))?)$/.test(hl)) map.externalId = h;
    if (!map.amount     && /^(amount|gift.?amount|donation.?amount|gift|giving|sum)$/.test(hl)) {
      if (sample.some(r => !isNaN(parseFloat(String(r[h]||"").replace(/^[A-Za-z]{3}\s+/,"").replace(/[$,]/g,""))))) map.amount = h;
    }
    if (!map.date     && /^(date|gift.?date|donation.?date|when)$/.test(hl))           map.date     = h;
    if (!map.type     && /^(type|gift.?type|payment.?(type|method)|method|payment)$/.test(hl)) map.type     = h;
    if (!map.campaign && /^(campaign|appeal|designation)$/.test(hl))                   map.campaign = h;
    if (!map.notes    && /^(notes?|memo|comments?)$/.test(hl))                         map.notes    = h;
    if (!map.phone    && /^(phone|phone.?number|telephone|mobile|cell)$/.test(hl))     map.phone    = h;
    if (!map.address  && /^(address|street(.?address)?|address.?1|mailing.?address)$/.test(hl)) map.address = h;
    if (!map.city     && /^city$/.test(hl))                                            map.city     = h;
    if (!map.state    && /^(state|province)$/.test(hl))                                map.state    = h;
    if (!map.zip      && /^(zip(.?code)?|postal(.?code)?)$/.test(hl))                  map.zip      = h;
    if (!map.owner)   map.owner = detectOwnerColumn([h]) ? h : map.owner;
  }
  // "Fund" maps to campaign ONLY if no campaign column exists (both present →
  // Fund has no home of its own and lands on the acknowledge list).
  if (!map.campaign) { const f = headers.find(h => /^fund$/i.test(String(h).trim())); if (f) map.campaign = f; }
  return map;
}

// ── BUILD-77 Part 1 — free-text safety markers ─────────────────────────────
// In a real export the state lives in the NOTES column, not a field:
// "DECEASED - notify family only", "Removed from mailing - do not contact",
// "d. Nov 2023", "DNS". Matching is CONSERVATIVE — a false positive costs
// the org one ask, a false negative costs them a relationship — and every
// match is surfaced on the import summary ("we flagged these") so a human
// confirms rather than discovers later. Deliberate non-match, pinned by the
// suite: "Do not include in vendor mailing" (a note about a VENDOR list,
// not the donor) must flag nothing.
export function detectNoteMarkers(text) {
  const t = String(text || "").trim();
  const out = { deceased: false, deceasedDate: null, doNotSolicit: false, doNotContact: false,
                doNotMail: false, doNotEmail: false, pledgePayment: false, sustainerNote: false, matched: [] };
  if (!t) return out;
  const hit = (flag, re, label) => { const m = t.match(re); if (m) { out[flag] = true; out.matched.push(label || m[0]); return m; } return null; };

  // deceased — the worst possible false positive is calling the dead
  hit("deceased", /\bdeceased\b/i);
  hit("deceased", /passed away/i);
  hit("deceased", /^d\.\s+/i, "d. <date>");            // "d. Nov 2023" — anchored so "Ph.D." can't match
  if (hit("deceased", /estate of decedent|\bbequest\b/i)) out.doNotSolicit = true; // an estate is never solicited
  let dm = t.match(/deceased\s+(\d{1,2}\/\d{4})/i) || t.match(/^d\.\s+([A-Za-z]{3,9}\.?\s+\d{4})/i);
  if (dm) out.deceasedDate = dm[1];

  // solicitation / contact / channel blocks
  hit("doNotSolicit", /do not solicit/i);
  hit("doNotSolicit", /no solicitation/i);
  hit("doNotSolicit", /\bDNS\b/);
  hit("doNotSolicit", /do not (mail or |mail\/)?call/i);  // a fundraiser's call IS an ask ("do not mail or call" blocks both)
  hit("doNotContact", /do not contact/i);
  hit("doNotContact", /no further contact/i);
  hit("doNotMail", /do not mail\b/i);
  hit("doNotMail", /removed from (the )?mailing/i);
  hit("doNotMail", /stop (all )?mail\b/i);
  hit("doNotEmail", /do not e-?mail/i);
  hit("doNotEmail", /unsubscribed?\b/i);

  // contractual cadence + sustainer history (both are ROUTING facts, not blocks)
  hit("pledgePayment", /pledge (payment|installment)/i);
  hit("sustainerNote", /monthly recurring/i);
  hit("sustainerNote", /\bsustainer\b/i);
  hit("sustainerNote", /monthly (eft|ach|giver|donor|gift)/i);
  hit("sustainerNote", /recurring\b.*(cc|card) on file|\brecurring\b\s*[-–—]/i, "recurring - CC on file");
  return out;
}

// ── BUILD-77 Parts 2+3 — THE ACCOUNTED TRANSACTION BUILDER ─────────────────
// One row per gift, donor repeated: every PHYSICAL row leaves with exactly
// one disposition — gift · donor_only · skipped(reason) · errored(reason) —
// and the file-level equation is computed from PARSE ENTRY, never from what
// survived. This replaces the silent inline logic in Donors.jsx that let 74
// rows and $154,806 of a real file vanish behind a "Balanced" summary:
// unparsable amounts vanished, refunds vanished, zero rows vanished, and an
// unparseable date became a gift dated TODAY (the Larry Ackerly finding —
// see normalizeDate above for why the browser and the test runner even
// disagreed about which dates failed).
//
// Policy, written down (BUILD-77 Part 2c): a FUTURE-dated gift is an ERROR
// (`future_date`, with its line) — a gift is a thing that happened. The one
// legitimate future-money shape is a pledge, which is not a gift row.
// Refunds import as NEGATIVE gifts: they reduce the dollar total, not the
// row count. $0 rows (in-kind / soft credit) are SKIPPED with their reason —
// visible and downloadable, never silently gone.
// BUILD-78 additions, both threaded through opts so the accounted builder
// stays the ONE row pipeline:
//   opts.flagColumns  — { deceased?, deceasedDate?, doNotSolicit?, doNotContact?,
//                         doNotMail?, doNotEmail? } → the Papa field carrying
//                         that exclusion-shaped column (Part 2: routed to the
//                         core flag family, never a custom field). A non-blank
//                         value neither set recognizes REFUSES the row — a
//                         "maybe" in a Deceased? column is a question for a
//                         human, never a no.
//   opts.cfColumns    — [{ field, entity: 'donor'|'gift', key, def, delimiter }]
//                         custom-field columns; values coerce through
//   opts.coerceCustomValue — customFieldShape's coerceCustomValue, injected by
//                         the caller (importShape cannot import it back —
//                         customFieldShape already imports this module). A
//                         value that fails coercion REFUSES the row with its
//                         line number (4.2): never coerced, never blanked,
//                         never quietly stored as text.
export function buildTransactionRows(parsed, txMap, opts = {}) {
  const today = opts.today || new Date().toISOString().split("T")[0];
  const currentYear = Number(String(today).slice(0, 4));
  const rows = parsed && parsed.rows ? parsed.rows : [];
  const items = [];
  const dispositions = [];   // { line, disposition, reason?, dollars, name, raw }
  const flaggedRows = [];    // { line, name, matched, flags }
  let fileDollars = 0;
  const flagCols = opts.flagColumns || {};
  const cfCols = opts.cfColumns || [];
  const coerceCf = opts.coerceCustomValue || null;
  const parseBool = opts.parseBoolValue || null;

  const headerText = c => String(txMap[c] || "");
  const keyFirstLine = new Map();   // donor key → first physical line (for "Unnamed donor (line N)")
  // BUILD-80 Part 1.2 — the amount column's convention, inferred ONCE from all
  // its values before any cell parses; per-cell tallies feed the summary lines.
  const amountConv = txMap.amount ? inferAmountConvention(rows.map(r => r[txMap.amount])) : null;
  const moneyOpts = amountConv && amountConv.columnConvention === "eu" ? { convention: "eu" } : {};
  const conventionCounts = { commaDecimal: 0, spaceThousands: 0 };
  // BUILD-80 Part 2.2 — the date column's convention, decided ONCE from
  // impossible-month evidence across the whole column. A mixed column parses
  // as US (each impossible cell refuses, which is the honest outcome) and the
  // mapper is expected to have asked; the caller can override via
  // opts.dateConvention ("dmy"|"mdy") after asking a human.
  const dateConv = txMap.date ? inferDateConvention(rows.map(r => r[txMap.date])) : null;
  const dateConvApplied = opts.dateConvention || (dateConv ? dateConv.convention : "default-mdy");
  const dayFirst = dateConvApplied === "dmy";
  // BUILD-80 Part 2.4 — a refused row is not a neutral event: any donor with
  // a refused row gets no high-confidence drift call until it is resolved.
  const refusedByKey = new Map();
  const bumpRefused = k => { if (k) refusedByKey.set(k, (refusedByKey.get(k) || 0) + 1); };
  rows.forEach((row, i) => {
    // BUILD-79 Part 1/5 — real physical lines when the caller has them (chrome
    // removal makes "index + 2" wrong on report exports).
    const line = (opts.rowLines && opts.rowLines[i]) || (opts.firstLine || 2) + i;
    const rawName = txMap.donorName ? String(row[txMap.donorName] || "").trim() : "";
    const first = txMap.firstName ? String(row[txMap.firstName] || "").trim() : "";
    const last = txMap.lastName ? String(row[txMap.lastName] || "").trim() : "";
    const orgName = txMap.orgName ? String(row[txMap.orgName] || "").trim() : "";
    const rawEmail = txMap.donorEmail ? String(row[txMap.donorEmail] || "").trim() : "";
    const rawAmount = txMap.amount ? row[txMap.amount] : "";
    const rawDate = txMap.date ? row[txMap.date] : "";
    const record = (disposition, reason, dollars, name) => {
      dispositions.push({ line, disposition, reason: reason || null, dollars: dollars || 0, name: name || rawName || rawEmail || "(no name)", raw: row });
    };

    // A stray header row echoed into the body (real exports do this at page
    // breaks): its cells literally equal the column names.
    if (rawName && rawName === headerText("donorName") && String(rawAmount || "").trim() === headerText("amount")) {
      record("errored", "stray_header_row", 0);
      return;
    }

    const name = normalizeName(rawName || [first, last].filter(Boolean).join(" ") || orgName) || "";
    const { value: emailVal } = normalizeEmail(rawEmail);
    const email = emailVal || "";
    if (!name && !email) {
      // BUILD-80 Part 1 — the row is refused, but its DOLLARS are still in the
      // file: parse the amount cell so the equation's left and right sides
      // agree with the independent scan instead of losing this row's money.
      const m0 = txMap.amount ? normalizeMoney(row[txMap.amount], moneyOpts) : { blank: true };
      const dol = (!m0.blank && m0.value != null) ? m0.value : 0;
      record("errored", "no_donor_identity", dol);
      fileDollars += dol;
      return;
    }

    // BUILD-79 Part 5 — a display name NEVER falls back to email (or the
    // phone number living in an email-mapped column). Blank stays blank here;
    // grouping may fill it from a later row of the same donor, and whatever
    // is still blank after grouping becomes "Unnamed donor (line N)" +
    // a needs-name tag, excluded from actionable surfaces until named.
    const donor = { name, email, stage: "prospect" };
    const dkey = (email && email.includes("@")) ? email.toLowerCase() : (name || `__line_${line}`).toLowerCase();
    if (!keyFirstLine.has(dkey)) keyFirstLine.set(dkey, line);
    if (txMap.phone && row[txMap.phone]) donor.phone = String(row[txMap.phone]).trim() || null;
    if (txMap.city && row[txMap.city]) donor.city = String(row[txMap.city]).trim() || null;
    if (txMap.state && row[txMap.state]) donor.state = String(row[txMap.state]).trim() || null;
    if (txMap.address && row[txMap.address]) donor.address = String(row[txMap.address]).trim() || null;
    if (txMap.zip && row[txMap.zip]) donor.zip = String(row[txMap.zip]).trim() || null;
    if (txMap.owner && row[txMap.owner]) donor.owner = String(row[txMap.owner]).trim() || undefined;

    const noteText = txMap.notes ? String(row[txMap.notes] || "") : "";
    const markers = detectNoteMarkers(noteText);
    if (markers.deceased) { donor.deceased = true; if (markers.deceasedDate) donor.deceasedDate = markers.deceasedDate; }
    if (markers.doNotSolicit) donor.doNotSolicit = true;
    if (markers.doNotContact) donor.doNotContact = true;
    if (markers.doNotMail) donor.doNotMail = true;
    if (markers.doNotEmail) donor.doNotEmail = true;
    if (markers.matched.length) flaggedRows.push({ line, name: donor.name, matched: markers.matched, note: noteText,
      flags: { deceased: !!markers.deceased, doNotSolicit: !!markers.doNotSolicit, doNotContact: !!markers.doNotContact, doNotMail: !!markers.doNotMail, doNotEmail: !!markers.doNotEmail } });

    // ── BUILD-78 Part 2 — exclusion-shaped COLUMNS route to the flag family ──
    let flagRefusal = null;
    const colMatched = [];
    for (const [flag, fieldName] of Object.entries(flagCols)) {
      if (!fieldName) continue;
      const rawV = String(row[fieldName] ?? "").trim();
      if (!rawV) continue;
      if (flag === "deceasedDate") {
        const dd = normalizeDate(rawV, { currentYear, dayFirst });
        if (dd.value) { donor.deceased = true; donor.deceasedDate = donor.deceasedDate || dd.value; colMatched.push(`${fieldName}: ${rawV}`); }
        else { flagRefusal = `unreadable_${flag}`; break; }
        continue;
      }
      const b = parseBool ? parseBool(rawV) : null;
      if (b === true) {
        if (flag === "deceased") donor.deceased = true;
        else donor[flag] = true;
        colMatched.push(`${fieldName}: ${rawV}`);
      } else if (b === null) { flagRefusal = `unrecognized_${flag}_value`; break; }
    }
    if (flagRefusal) {
      // The whole ROW is refused (its dollars still land in the equation);
      // no donor and no values are built from a row a human must look at.
      const m0 = txMap.amount ? normalizeMoney(row[txMap.amount], moneyOpts) : { blank: true };
      const dol = (!m0.blank && m0.value != null) ? m0.value : 0;
      record("errored", flagRefusal, dol, donor.name);
      fileDollars += dol;
      bumpRefused(dkey);
      return;
    }
    if (colMatched.length) flaggedRows.push({ line, name: donor.name, matched: colMatched, note: noteText,
      flags: { deceased: !!donor.deceased, doNotSolicit: !!donor.doNotSolicit, doNotContact: !!donor.doNotContact, doNotMail: !!donor.doNotMail, doNotEmail: !!donor.doNotEmail } });

    // ── BUILD-78 Part 4.2 — custom-field values; a failed coercion refuses the row ──
    if (cfCols.length && coerceCf) {
      const donorCf = {}, giftCf = {};
      let cfRefusal = null;
      for (const c of cfCols) {
        const rawV = row[c.field];
        if (String(rawV ?? "").trim() === "") continue;
        const r = coerceCf(c.def, rawV, { delimiter: c.delimiter, currentYear });
        if (!r.ok) { cfRefusal = `${c.key}_invalid`; break; }
        if (r.blank) continue;
        // RAW travels to the server; the ONE seam re-coerces and stores. The
        // client-side coercion here exists only to refuse the row pre-write.
        if (c.entity === "gift") giftCf[c.key] = String(rawV).trim();
        else donorCf[c.key] = String(rawV).trim();
      }
      if (cfRefusal) {
        const m0 = txMap.amount ? normalizeMoney(row[txMap.amount]) : { blank: true };
        const dol = (!m0.blank && m0.value != null) ? m0.value : 0;
        record("errored", cfRefusal, dol, donor.name);
        fileDollars += dol;
        bumpRefused(dkey);
        return;
      }
      if (Object.keys(donorCf).length) donor.customFields = donorCf;
      if (Object.keys(giftCf).length) donor._giftCustomFields = giftCf; // picked up by mkGift below
    }

    const rowGiftCf = donor._giftCustomFields || undefined;
    delete donor._giftCustomFields;
    const key = dkey;
    const mkGift = (amount) => ({
      amount,
      date: null, // filled below
      type: txMap.type ? (String(row[txMap.type] || "").toLowerCase().trim() || "cash") : "cash",
      campaign: txMap.campaign ? String(row[txMap.campaign] || "") : "",
      notes: noteText,
      externalId: txMap.externalId ? (String(row[txMap.externalId] || "").trim() || undefined) : undefined,
      customFields: rowGiftCf,   // BUILD-78: raw, re-validated by the server seam
    });

    if (!txMap.amount) { items.push({ key, donor, gift: null }); record("donor_only", null, 0, donor.name); return; }
    const money = normalizeMoney(rawAmount, moneyOpts);
    if (money.convention === "comma-decimal") conventionCounts.commaDecimal++;
    else if (money.convention === "space-thousands") conventionCounts.spaceThousands++;
    if (money.blank) { items.push({ key, donor, gift: null }); record("skipped", "no_amount", 0, donor.name); return; }
    if (money.value == null) { items.push({ key, donor, gift: null }); record("errored", "unparseable_amount", 0, donor.name); bumpRefused(key); return; }
    if (money.value === 0) { items.push({ key, donor, gift: null }); record("skipped", "zero_amount", 0, donor.name); return; }

    const { value: dateVal } = normalizeDate(rawDate, { currentYear, dayFirst });
    if (!dateVal) { items.push({ key, donor, gift: null }); record("errored", "unparseable_date", money.value, donor.name); fileDollars += money.value; bumpRefused(key); return; }
    if (dateVal > today) { items.push({ key, donor, gift: null }); record("errored", "future_date", money.value, donor.name); fileDollars += money.value; bumpRefused(key); return; }

    const gift = mkGift(money.value);   // cents preserved — the money seam owns rounding, and it doesn't
    gift.date = dateVal;
    items.push({ key, donor, gift });
    fileDollars += money.value;
    record("gift", null, money.value, donor.name);
  });

  const { donors, gifts, idxByKey } = groupTransactions(items);
  for (const [k, count] of refusedByKey) {
    const di = idxByKey.get(k);
    if (di === undefined) continue;
    const d = donors[di];
    d.tags = [...new Set([...(Array.isArray(d.tags) ? d.tags : []), `has-refused-rows:${count}`])];
  }
  // BUILD-79 Part 5 — name the nameless honestly, and flag them for review.
  for (const d of donors) {
    if (!d.name || !String(d.name).trim()) {
      const k = (d.email && d.email.includes("@")) ? d.email.toLowerCase() : null;
      const ln = (k && keyFirstLine.get(k)) || "?";
      d.name = `Unnamed donor (line ${ln})`;
      d.tags = [...new Set([...(Array.isArray(d.tags) ? d.tags : []), "needs-name"])];
    }
  }
  detectImportedSustainers(donors, gifts);
  // BUILD-80 Part 1.4 — the largest-gifts panel: the five biggest imported
  // gifts with donor, date and line. A $200,000 row next to $2,500 rows is a
  // question a human answers in one second; no suite caught the hundredfold
  // parse, this panel would have.
  const largestGifts = dispositions
    .filter(d => d.disposition === "gift" && d.dollars > 0)
    .sort((a, b) => b.dollars - a.dollars)
    .slice(0, 5)
    .map(d => ({ line: d.line, name: d.name, dollars: d.dollars,
                 date: (txMap.date && d.raw && d.raw[txMap.date]) ? String(d.raw[txMap.date]) : "" }));
  return {
    donors, gifts, dispositions, flaggedRows, largestGifts,
    amountConventions: { ...conventionCounts, column: amountConv ? amountConv.columnConvention : "us" },
    dateConvention: dateConv ? { ...dateConv, applied: dateConvApplied } : null,
    file: {
      rows: rows.length,                       // physical non-blank rows, counted ONCE at parse entry
      dollars: Math.round(fileDollars * 100) / 100,
      imported: dispositions.filter(d => d.disposition === "gift").length,
      donorOnly: dispositions.filter(d => d.disposition === "donor_only").length,
      skipped: dispositions.filter(d => d.disposition === "skipped").length,
      errored: dispositions.filter(d => d.disposition === "errored").length,
    },
  };
}

// ── BUILD-77 Part 5 — imported sustainers (the third state) ────────────────
// A sustainer who arrives by import has no Stripe subscription and never
// can (card credentials do not move between processors), so "recurring ==
// has a subscription object" made every one of them invisible. Detect the
// HISTORY: interval evidence (gifts clustered near 30 days at a stable
// amount) outranks the note; a note alone counts unless the intervals
// contradict it. Marks the donor `importedSustainer` with the historical
// amount + last gift so the reconnect flow can prefill both.
export function detectImportedSustainers(donors = [], gifts = []) {
  const byDonor = new Map();
  for (const g of gifts) {
    if (!byDonor.has(g.donorIndex)) byDonor.set(g.donorIndex, []);
    byDonor.get(g.donorIndex).push(g);
  }
  donors.forEach((d, i) => {
    // Pledge installments are CONTRACTUAL cadence — twelve monthly payments
    // of a capital pledge look exactly like a sustainer to interval math and
    // are nothing of the kind (a "reconnect your monthly gift" email to a
    // completed pledge would be wrong twice). The pledge marker outranks
    // sustainer inference.
    const raw = (byDonor.get(i) || []).filter(g => g.amount > 0);
    const gs = raw.filter(g => !detectNoteMarkers(g.notes).pledgePayment).sort((a, b) => a.date < b.date ? -1 : 1);
    const noteHits = gs.filter(g => detectNoteMarkers(g.notes).sustainerNote).length;
    let intervalMonthly = false, intervalContradicts = false;
    if (gs.length >= 4) {
      const iv = [];
      for (let k = 1; k < gs.length; k++) {
        const a = new Date(gs[k - 1].date + "T12:00:00Z"), b = new Date(gs[k].date + "T12:00:00Z");
        iv.push(Math.round((b - a) / 86400000));
      }
      const sorted = [...iv].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const amts = gs.map(g => g.amount).sort((a, b) => a - b);
      const amtMedian = amts[Math.floor(amts.length / 2)];
      const amtStable = gs.every(g => amtMedian > 0 && Math.abs(g.amount - amtMedian) / amtMedian <= 0.15);
      intervalMonthly = median >= 20 && median <= 40 && amtStable;
      intervalContradicts = median > 60;
    }
    if (intervalMonthly || (noteHits >= 2 && !intervalContradicts)) {
      const amts = gs.map(g => g.amount).sort((a, b) => a - b);
      d.importedSustainer = true;
      d.importedSustainerAmount = amts.length ? amts[Math.floor(amts.length / 2)] : null;
      d.importedSustainerLastGift = gs.length ? gs[gs.length - 1].date : null;
    }
  });
  return donors;
}

export function groupTransactions(items = []) {
  const donors = [];
  const gifts = [];
  const idxByKey = new Map();
  for (const { key, donor, gift } of items) {
    let di = idxByKey.get(key);
    if (di === undefined) {
      di = donors.length;
      idxByKey.set(key, di);
      donors.push({ ...donor });
    } else {
      const canon = donors[di];
      if ((!canon.name || !String(canon.name).trim()) && donor.name) canon.name = donor.name;
      for (const k of ["email", "phone", "city", "state", "address", "zip", "notes", "owner"]) {
        if ((canon[k] == null || canon[k] === "") && donor[k]) canon[k] = donor[k];
      }
      // BUILD-77 Part 1 — safety flags OR across a donor's rows: one row
      // saying deceased makes the DONOR deceased, whichever row said it.
      for (const k of ["deceased", "doNotContact", "doNotSolicit", "doNotMail", "doNotEmail"]) {
        if (donor[k]) canon[k] = true;
      }
      if (donor.deceasedDate && !canon.deceasedDate) canon.deceasedDate = donor.deceasedDate;
      // BUILD-78 — donor custom values: first non-blank per key wins across
      // the donor's rows (a donor-level column is constant per donor; when a
      // messy file disagrees with itself, the earliest row is kept).
      if (donor.customFields) canon.customFields = { ...donor.customFields, ...(canon.customFields || {}) };
    }
    if (gift) gifts.push({ ...gift, donorIndex: di });
  }
  return { donors, gifts, idxByKey };
}
