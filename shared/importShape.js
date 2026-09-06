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
  // BUILD-82 — "$-500.37": the sign can ride INSIDE the currency symbol.
  if (s.startsWith("-")) { s = s.slice(1).trim(); if (negMarks++) return refuse(); sign = -1; }
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

// BUILD-80 Part 6.1 — an email is an IDENTITY only when it is a real
// address. "none", "n/a", "unknown", "NO EMAIL", "(none)", "@@", a missing
// TLD, "jane at example dot com" — none of these identify anyone, and two
// people who both wrote "none" are two people. Zero-width characters are
// stripped first (one planted address hides a U+200B).
export function emailIdentity(val) {
  const s = String(val ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toLowerCase();
  if (!s) return null;
  if (/^\(?(none|n\/a|na|unknown|no e?-?mail|null|missing|tbd|-)\)?\.?$/i.test(s)) return null;
  // exactly one @, a dot AFTER it, at least one char each side
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return null;
  const domain = s.slice(at + 1);
  if (!/^[^@\s]+\.[a-z]{2,}$/i.test(domain)) return null;
  if (/\s/.test(s)) return null;
  return s;
}

// BUILD-80 Part 6.1 — the MATCHING name: case-folded, punctuation and
// honorifics stripped, "Last, First" already flipped by normalizeName,
// middle initials dropped FOR MATCHING ONLY (display keeps them), and the
// household forms ("Mr. and Mrs. X Y", "The Y Family") reduced to a
// household CANDIDATE against X Y — never an automatic merge.
const HONORIFICS_RE = /^(mr|mrs|ms|miss|dr|rev|revd|fr|sr|prof|hon)\.?\s+/i;
export function matchNameKey(raw) {
  let s = normalizeName(raw) || "";
  if (!s) return { key: "", household: false };
  let household = false;
  let m = s.match(/^the\s+(.+?)\s+family$/i);
  if (m) return { key: m[1].toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ""), household: true, lastOnly: true };
  m = s.match(/^mr\.?\s*(?:and|&)\s*mrs\.?\s+(.+)$/i) || s.match(/^mrs\.?\s*(?:and|&)\s*mr\.?\s+(.+)$/i);
  if (m) { s = m[1]; household = true; }
  while (HONORIFICS_RE.test(s)) s = s.replace(HONORIFICS_RE, "");
  const tokens = s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean)
    .filter((t, i, arr) => !(t.length === 1 && i > 0 && i < arr.length - 1)); // drop middle initials
  return { key: tokens.join(" "), household };
}

// Are two matching names the same person (or a household form of them)?
export function matchNamesCompatible(a, b) {
  if (!a.key || !b.key) return false;
  if (a.key === b.key) return true;
  // surname comparison handles multi-token surnames ("Ó Briain", "van der
  // Berg"): a last-only household form matches when the person's key ENDS
  // WITH it.
  const endsWithKey = (k, suffix) => k.key === suffix || k.key.endsWith(" " + suffix);
  if (a.lastOnly) return endsWithKey(b, a.key);
  if (b.lastOnly) return endsWithKey(a, b.key);
  const lastOf = k => k.key.split(" ").slice(-1)[0];
  if ((a.household || b.household) && lastOf(a) === lastOf(b)) return true;
  return false;
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

// BUILD-80 Part 3 — SOURCE-BORNE double encoding, reversed conservatively.
// Line 1903 of the v2 fixture holds the UTF-8 encoding of "æ\u009D\u008E":
// the SOURCE system read 李's three UTF-8 bytes (E6 9D 8E) as CP1252, kept
// the wreckage, and re-encoded it — so the file decodes strictly clean and
// the man's surname is æ. The repair maps each character back to the byte it
// came from (Latin-1 codepoints to themselves, the CP1252 specials to their
// slots) and, ONLY when a run starting at a UTF-8 lead byte re-assembles into
// a VALID multibyte UTF-8 sequence, decodes that run. A genuine "æ" is never
// followed by continuation-mapped characters, so it is never a candidate;
// on v2 exactly 16 sequences repair (Ó, ü, Ễ, ø, í, 李, Ç) with zero false
// positives. Every repair is counted and reported, never silent.
const _CP1252_INV = { 0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,
  0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,
  0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,
  0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F };
const _invByte = ch => {
  const o = ch.codePointAt(0);
  if (o < 0x100) return o;
  return _CP1252_INV[o] ?? null;
};
export function repairDoubleEncodedText(text) {
  const strict = new TextDecoder("utf-8", { fatal: true });
  const repairs = new Map();
  let out = "", i = 0, repaired = 0;
  while (i < text.length) {
    const b = _invByte(text[i]);
    if (b !== null && b >= 0xC2 && b <= 0xF4) {
      const len = b < 0xE0 ? 2 : b < 0xF0 ? 3 : 4;
      const seq = [b];
      let okRun = i + len <= text.length;
      for (let j = 1; okRun && j < len; j++) {
        const c = _invByte(text[i + j]);
        if (c === null || c < 0x80 || c > 0xBF) okRun = false;
        else seq.push(c);
      }
      if (okRun) {
        try {
          const rep = strict.decode(new Uint8Array(seq));
          const key = `${text.slice(i, i + len)} → ${rep}`;
          repairs.set(key, (repairs.get(key) || 0) + 1);
          out += rep; i += len; repaired++;
          continue;
        } catch { /* not valid UTF-8 — leave the characters alone */ }
      }
    }
    out += text[i]; i++;
  }
  return { text: out, repaired, repairs: [...repairs.entries()].map(([k, count]) => ({ sequence: k, count })) };
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
    const rep = repairDoubleEncodedText(strict.decode(body));
    return { text: rep.text, cp1252Lines: [], mojibakeRepaired: rep.repaired, mojibakeRepairs: rep.repairs };
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
    const rep = repairDoubleEncodedText(out.join("\n"));
    return { text: rep.text, cp1252Lines, mojibakeRepaired: rep.repaired, mojibakeRepairs: rep.repairs };
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
    // BUILD-82: a workbook's TOTAL cell is numeric and stringifies bare
    // ("32523933.89") — accept it alongside the $-prefixed report form.
    const amountCell = filled.find(c => CURRENCY_RE.test(c))
      || filled.find(c => c !== label && c !== subLabel && /^-?[\d,]+\.\d{1,2}$/.test(c));
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
  hit("deceased", /\bdied\b/i);                     // "Died 2023. Family still gives."
  hit("deceased", /^d\.\s+/i, "d. <date>");            // "d. Nov 2023" — anchored so "Ph.D." can't match
  if (hit("deceased", /estate of decedent|\bbequest\b/i)) out.doNotSolicit = true; // an estate is never solicited
  let dm = t.match(/deceased\s+(\d{1,2}\/\d{4})/i) || t.match(/^d\.\s+([A-Za-z]{3,9}\.?\s+\d{4})/i);
  if (dm) out.deceasedDate = dm[1];

  // solicitation / contact / channel blocks
  hit("doNotSolicit", /do not solicit/i);
  hit("doNotSolicit", /no solicitation/i);
  hit("doNotSolicit", /\bDNS\b/);
  hit("doNotSolicit", /do not (mail or |mail\/)?call/i);  // a fundraiser's call IS an ask ("do not mail or call" blocks both)
  // BUILD-80 Part 4 — phrasings the v2 file planted that the conservative set
  // missed, each an unambiguous no-ask in a donor note:
  hit("doNotSolicit", /no more asks/i);                                  // "no more asks - complained about mail volume"
  hit("doNotSolicit", /unsubscribed from (everything|all)\b/i);          // everything includes the ask
  if (hit("doNotSolicit", /removed from (the )?mailing list/i)) out.doNotMail = true; // leaving the LIST is leaving the asks; vendor-mailing note still a non-match
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

// ── BUILD-80 Part 7 — organisations, DAFs, anonymous, estates ──────────────
// A grant cycle is not a giving cadence: an organisation must never see a
// person surface (drift, re-engage, needs-attention-as-a-person). Detection:
// an org-shaped name (Church, Foundation, Charitable, Fund, Inc, Bank,
// Trust, Corp, Estate of, Ministries, Fellowship, …) or a name with no
// first/last split that isn't a person's. "Estate of X" is an organisation
// that arrives deceased and never solicited. The anonymous family
// (Anonymous, ANONYMOUS DONOR, Anon., Cash donor) collapses to ONE holding
// record per import — different people, no cadence, no lists.
const ORG_NAME_RE = /\b(church|foundation|charitable|fund|inc\.?|bank|trust|corp(oration)?\.?|estate of|ministries|fellowship|llc|company|co\.|university|college|school|rotary|club|association|society|committee|giving)\b/i;
const ANON_RE = /^(anonymous( donor)?|anon\.?|cash donor)$/i;
export function detectDonorKind(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  if (ANON_RE.test(n)) return "anonymous";
  if (/^estate of\s+/i.test(n)) return "organisation";
  if (ORG_NAME_RE.test(n)) return "organisation";
  return null;
}

// ── BUILD-80 Part 6 — WHO IS WHO: the identity resolver ────────────────────
// Grouping order: (1) external donor ID, when a column is recognised as one
// — stored as TEXT, leading zeros kept; a spreadsheet-damaged ID (1.23E+05)
// is lossy and never groups; an ID shared by two DIFFERENT names never
// groups and flags both sides. (2) email, only when it is a REAL address
// (emailIdentity) — and only joining names that are compatible: one email in
// front of two distinct people is a household candidate, not a merge.
// (3) the matching name (matchNameKey). Household forms ("Mr. and Mrs. X Y",
// "The Y Family") never auto-merge with the person by name alone — they
// join only via a shared ID or a shared real email, and otherwise surface
// as household candidates. Every union is LOGGED with its reason so the
// merge review list can show — and undo — what the importer decided.
export function resolveIdentities(rows = [], txMap = {}, opts = {}) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const donorIdCol = opts.donorIdColumn !== undefined ? opts.donorIdColumn
    : findDonorIdHdr(headers.filter(h => h !== txMap.externalId));
  const damagedId = v => /e\+/i.test(v) || /^\d+\.\d+$/.test(v);
  const displayNameOf = row => {
    const rawName = txMap.donorName ? String(row[txMap.donorName] || "").trim() : "";
    const first = txMap.firstName ? String(row[txMap.firstName] || "").trim() : "";
    const last = txMap.lastName ? String(row[txMap.lastName] || "").trim() : "";
    const orgName = txMap.orgName ? String(row[txMap.orgName] || "").trim() : "";
    return { display: rawName || [first, last].filter(Boolean).join(" ") || orgName,
             fromNameCol: rawName, fromParts: [first, last].filter(Boolean).join(" ") };
  };

  // pass 1 — which IDs are damaged or shared by different people
  const idNames = new Map();
  for (const row of rows) {
    const id = donorIdCol ? String(row[donorIdCol] ?? "").trim() : "";
    if (!id || damagedId(id)) continue;
    const mk = matchNameKey(displayNameOf(row).display);
    if (!mk.key) continue;
    if (!idNames.has(id)) idNames.set(id, []);
    const list = idNames.get(id);
    if (!list.some(x => matchNamesCompatible(x, mk))) list.push(mk);
  }
  const conflictedIds = new Set([...idNames.entries()].filter(([, l]) => l.length > 1).map(([id]) => id));

  // pass 2 — union-find over per-row identities
  const parent = [];
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const groupMeta = [];   // gid → { label } (first identity seen, for the log)
  const log = [];
  const union = (a, b, reason) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return ra;
    parent[rb] = ra;
    log.push({ reason, surviving: groupMeta[ra].label, folded: groupMeta[rb].label });
    return ra;
  };
  const newGid = label => { const g = parent.length; parent.push(g); groupMeta.push({ label }); return g; };

  const byId = new Map(), byName = new Map(), byEmail = new Map();
  const rowInfo = [];
  for (const row of rows) {
    const dn = displayNameOf(row);
    const mk = matchNameKey(dn.display);
    const idRaw = donorIdCol ? String(row[donorIdCol] ?? "").trim() : "";
    const damaged = !!(idRaw && damagedId(idRaw));
    const vid = idRaw && !damaged && !conflictedIds.has(idRaw) ? idRaw : null;
    const vem = emailIdentity(txMap.donorEmail ? row[txMap.donorEmail] : "");
    const nameConflict = !!(dn.fromNameCol && dn.fromParts &&
      matchNameKey(dn.fromNameCol).key && matchNameKey(dn.fromParts).key &&
      !matchNamesCompatible(matchNameKey(dn.fromNameCol), matchNameKey(dn.fromParts)));

    let gid = null;
    const label = dn.display || vem || (idRaw ? `ID ${idRaw}` : "(no identity)");
    if (vid && byId.has(vid)) gid = find(byId.get(vid));
    // email joins only compatible names (household forms count as compatible)
    let emailEntry = null;
    if (vem) {
      const list = byEmail.get(vem) || [];
      emailEntry = list.find(e => !mk.key || !e.mk.key || matchNamesCompatible(e.mk, mk)) || null;
      if (emailEntry) {
        const eg = find(emailEntry.gid);
        gid = gid === null ? eg : union(gid, eg, `email ${vem}`);
      }
    }
    // exact matching-name joins — but a household form never joins a person
    // by name alone, and a name never joins across two different known IDs
    if (mk.key && byName.has(mk.key)) {
      const cand = find(byName.get(mk.key));
      const candIds = groupMeta[cand].idSet || null;
      const crossesIds = vid && candIds && candIds.size && !candIds.has(vid);
      // Same name, two DIFFERENT real emails = two people until a human says
      // otherwise (the same rule IDs get) — never a name-only merge across
      // distinct addresses.
      const candEmails = groupMeta[cand].emailSet || null;
      const crossesEmails = vem && candEmails && candEmails.size && !candEmails.has(vem);
      const bothHouseholdSafe = !(mk.household && !(groupMeta[cand].sawHousehold));
      if (!crossesIds && !crossesEmails && (bothHouseholdSafe || gid !== null)) {
        gid = gid === null ? cand : union(gid, cand, `name "${mk.key}"`);
      }
    }
    let via = "first row";
    if (gid !== null) via = vid && byId.has(vid) && find(byId.get(vid)) === find(gid) ? `ID ${vid}` : (emailEntry ? `email ${vem}` : "name");
    if (gid === null) gid = newGid(label);
    const rg = find(gid);
    const giftId = txMap.externalId ? String(row[txMap.externalId] ?? "").trim() : "";
    (groupMeta[rg].members = groupMeta[rg].members || []).push({ label, via, giftId });
    // register + group attributes
    if (vid) {
      byId.set(vid, rg);
      (groupMeta[rg].idSet = groupMeta[rg].idSet || new Set()).add(vid);
    }
    // FIRST claimant keeps the name (deterministic): when two distinct-email
    // people share a name, an email-less row of that name attaches to the
    // earliest, and a re-run groups identically.
    if (mk.key && !mk.household && !byName.has(mk.key)) byName.set(mk.key, rg);
    if (mk.key && mk.household) {
      groupMeta[rg].sawHousehold = true;
      if (!byName.has(mk.key)) byName.set(mk.key, rg);
    }
    if (vem) {
      const list = byEmail.get(vem) || [];
      if (emailEntry) emailEntry.gid = rg;
      else list.push({ gid: rg, mk });
      byEmail.set(vem, list);
      (groupMeta[rg].emailSet = groupMeta[rg].emailSet || new Set()).add(vem);
    }
    rowInfo.push({ gid: rg, idRaw, damaged, conflicted: !!(idRaw && conflictedIds.has(idRaw)), vem, mk, nameConflict });
  }

  // household candidates: one real email, several groups behind it
  const householdCandidates = [];
  for (const [em, list] of byEmail) {
    const gids = [...new Set(list.map(e => find(e.gid)))];
    if (gids.length > 1) householdCandidates.push({ email: em, names: gids.map(g => groupMeta[g].label) });
  }

  // The MERGE REVIEW LIST (Part 6.2): one entry per group assembled from
  // more than one distinct identity label — the surviving record, every
  // variant that folded into it with its reason and its gift ids (so an
  // undo can split the gifts back out).
  const mergeReview = [];
  const seenRoots = new Set();
  for (let g = 0; g < parent.length; g++) {
    const root = find(g);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    const members = [];
    for (let h = 0; h < parent.length; h++) if (find(h) === root && groupMeta[h].members) members.push(...groupMeta[h].members);
    const byLabel = new Map();
    for (const m of members) {
      if (!byLabel.has(m.label)) byLabel.set(m.label, { label: m.label, via: m.via, rows: 0, giftIds: [] });
      const e = byLabel.get(m.label);
      e.rows++;
      if (m.giftId) e.giftIds.push(m.giftId);
    }
    if (byLabel.size > 1) {
      const variants = [...byLabel.values()];
      mergeReview.push({ surviving: variants[0].label, folded: variants.slice(1) });
    }
  }
  return {
    donorIdCol,
    keys: rowInfo.map(r => `grp_${find(r.gid)}`),
    rowInfo,
    conflictedIds: [...conflictedIds],
    log,
    mergeReview,
    householdCandidates,
  };
}

// ── BUILD-80 Part 5 — GIFT TYPE IS A CLOSED VOCABULARY WITH MEANING ────────
// blank/cash/check/cc/ach/online/venmo/stock/recurring/grant → a gift.
// Bequest → a gift, and the donor is never solicited again. Matching Gift →
// a gift on the CORPORATION plus a relationship link to the person in Notes;
// no gift on the person. Pledge → a commitment, never in totals. Pledge
// Payment → a gift, linked to its pledge. Soft Credit → a link, no money on
// the credited person (created if new). In-Kind → recorded with FMV, never
// cash, never a $0 gift. Refund/Reversal → negative gift; a POSITIVE
// Reversal is an error asking for a human. Anything else → shown on the
// mapper as an unrecognised type with count and examples.
const GIFT_TYPE_CASH = new Set(["", "cash", "check", "credit card", "cc", "ach", "online", "venmo", "stock", "recurring", "grant", "eft", "wire", "paypal", "card"]);
export function classifyGiftType(raw) {
  const t = String(raw ?? "").trim().toLowerCase();
  if (GIFT_TYPE_CASH.has(t)) return { kind: "gift" };
  if (t === "bequest") return { kind: "gift", neverSolicit: true };
  if (t === "matching gift" || t === "matching" || t === "corporate match") return { kind: "gift", matching: true };
  if (t === "pledge") return { kind: "pledge" };
  if (t === "pledge payment" || t === "pledge installment") return { kind: "pledge_payment" };
  if (t === "soft credit" || t === "soft-credit" || t === "softcredit") return { kind: "soft_credit" };
  if (t === "in-kind" || t === "in kind" || t === "inkind" || t === "gik") return { kind: "in_kind" };
  if (t === "refund") return { kind: "refund" };
  if (t === "reversal") return { kind: "reversal" };
  return { kind: "unrecognized" };
}

// Notes-borne attribution: the person a corporate match or DAF grant belongs
// to. "Match for Jane Smith" · "MG: Smith, Jane" · "recommended by X" ·
// "Recommended by X, ack to donor" — the name ends at a sentence break.
export function parseAttributionNote(note) {
  const t = String(note || "");
  let m = t.match(/\bmatch(?:ing gift)? for ([^,;.\n(]+)/i) || t.match(/\bMG:\s*([^;.\n(]+)/i)
    || t.match(/\bmatching gift\s*[-\u2013\u2014]\s*([^(\n;]+?)\s*(?:\(|$)/im);
  if (m) return { kind: "match", person: normalizeName(m[1].trim()) };
  m = t.match(/\brecommended by ([^,;.\n(]+)/i) || t.match(/\badvised by ([^,;.\n(]+)/i)
    || t.match(/\bper advisor:\s*([^\n(]+?)\s*donor advised fund/i);
  if (m) return { kind: "daf", person: normalizeName(m[1].trim()) };
  return null;
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
  // BUILD-80 Part 6 — WHO IS WHO, decided once for the whole file: external
  // donor ID → real email → matching name, unions logged for review.
  const identity = resolveIdentities(rows, txMap, opts);
  const dateConv = txMap.date ? inferDateConvention(rows.map(r => r[txMap.date])) : null;
  const dateConvApplied = opts.dateConvention || (dateConv ? dateConv.convention : "default-mdy");
  const dayFirst = dateConvApplied === "dmy";
  // BUILD-80 Part 2.4 — a refused row is not a neutral event: any donor with
  // a refused row gets no high-confidence drift call until it is resolved.
  const refusedByKey = new Map();
  const bumpRefused = k => { if (k) refusedByKey.set(k, (refusedByKey.get(k) || 0) + 1); };
  const freqCol = rows.length ? Object.keys(rows[0]).find(h => /^frequency$/i.test(String(h).trim())) : null;
  // BUILD-80 Part 5 — the rows that are NOT gifts, collected for their own
  // surfaces: pledges (commitments), in-kind (FMV records), soft credits and
  // matching/DAF attributions (relationship links), plus the review-queue
  // twins and the unrecognized types the mapper must show.
  const semantics = { pledges: [], inKind: [], links: [], reviewTwins: [], unrecognizedTypes: new Map() };
  const semanticTally = { softCredits: { rows: 0, dollars: 0 }, pledges: { rows: 0, dollars: 0 },
    inKind: { rows: 0, dollars: 0 }, matching: { rows: 0, dollars: 0 }, pledgeScheduled: { rows: 0, dollars: 0 },
    anonymous: { rows: 0, dollars: 0 } };
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
    // BUILD-80 Part 7 — organisations and the anonymous holding record.
    const kind = detectDonorKind(name);
    if (kind) donor.kind = kind;
    if (kind === "anonymous") { donor.name = "Anonymous"; donor.email = ""; }
    if (/^estate of\s+/i.test(name)) {
      donor.deceased = true;               // the estate itself is never a living record
      donor.doNotSolicit = true;           // and is never solicited
      const estOf = name.replace(/^estate of\s+/i, "").trim();
      if (estOf) donor._estateOf = estOf;
    }
    // BUILD-80 Part 6 — the identity resolver's verdict for this row (ID →
    // real email → matching name; damaged and shared IDs never group).
    const idv = identity.rowInfo[i];
    const dkey = kind === "anonymous" ? "__anonymous__"
      : idv ? identity.keys[i] : ((email && email.includes("@")) ? email.toLowerCase() : (name || `__line_${line}`).toLowerCase());
    if (kind === "anonymous") { semanticTally.anonymous.rows++; }
    if (idv) {
      if (idv.idRaw) {
        donor.externalDonorId = idv.idRaw;   // TEXT, leading zeros kept, stored as given
        if (idv.damaged) donor.tags = [...new Set([...(donor.tags || []), "id-damaged"])];
        if (idv.conflicted) donor.tags = [...new Set([...(donor.tags || []), `shares-id:${idv.idRaw}`])];
      }
      if (idv.nameConflict) donor.tags = [...new Set([...(donor.tags || []), "name-conflict"])];
      // an invalid email never becomes the donor's stored address either
      if (donor.email && !idv.vem) donor.email = "";
    }
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

    // ── BUILD-80 Part 4 — exclusion-shaped columns, VALUE-routed ───────────
    // opts.exclusionColumns: fields whose VALUES carry the exclusion family
    // (a Solicit Code / Status column). Each cell parses through the injected
    // opts.parseExclusionValue; flags land on the donor (a flag on any row
    // sets the donor — grouping ORs them), "Newsletter only" sets
    // do-not-solicit and leaves mail ON, Inactive/Lost/Moved are shown as the
    // donor's status and never acted on, and an unrecognized value refuses
    // the row — a stray in an exclusion column is a question for a human.
    const exclCols = opts.exclusionColumns || [];
    const parseExcl = opts.parseExclusionValue || null;
    let exclRefusal = null;
    const exclMatched = [];
    let rowSaysActive = false;
    if (exclCols.length && parseExcl) {
      for (const f of exclCols) {
        const rawV = String(row[f] ?? "").trim();
        if (!rawV) continue;
        const p = parseExcl(rawV);
        if (p.unrecognized && p.unrecognized.length) { exclRefusal = "unrecognized_exclusion_value"; break; }
        const flagKeys = Object.keys(p.flags).filter(k => p.flags[k]);
        for (const k of flagKeys) donor[k] = true;
        if (flagKeys.length) exclMatched.push(`${f}: ${rawV}`);
        if (p.status) donor.status = p.status;
        if (p.neutral) rowSaysActive = true;
      }
    }
    if (exclRefusal) {
      const m0 = txMap.amount ? normalizeMoney(row[txMap.amount], moneyOpts) : { blank: true };
      const dol = (!m0.blank && m0.value != null) ? m0.value : 0;
      record("errored", exclRefusal, dol, donor.name);
      fileDollars += dol;
      bumpRefused(dkey);
      return;
    }
    if (exclMatched.length) flaggedRows.push({ line, name: donor.name, matched: exclMatched, note: noteText,
      flags: { deceased: !!donor.deceased, doNotSolicit: !!donor.doNotSolicit, doNotContact: !!donor.doNotContact, doNotMail: !!donor.doNotMail, doNotEmail: !!donor.doNotEmail } });
    // Part 4.3 — most restrictive wins ACROSS homes, and the conflict is
    // SHOWN: a row whose column says Active while its note says deceased.
    if (rowSaysActive && markers.deceased) donor._activeColumnConflict = true;
    if (rowSaysActive) donor._sawActiveColumn = true;

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

    // ── BUILD-80 Part 8 — the Frequency column is a CLAIM about cadence,
    // weighed against the gift pattern (the pattern wins), never a custom
    // select. Monthly-ish spellings: Monthly, monthly, M, Every month, 12.
    if (freqCol) {
      const fv = String(row[freqCol] ?? "").trim().toLowerCase();
      if (fv && /^(monthly|m|every month|12|mo)$/.test(fv)) donor._freqMonthlyClaim = true;
    }
    // ── BUILD-80 Part 5 — the row's MEANING comes before its money ────────
    const typeRaw = txMap.type ? String(row[txMap.type] || "").trim() : "";
    const typed = classifyGiftType(typeRaw);
    if (typed.kind === "unrecognized") {
      const e = semantics.unrecognizedTypes.get(typeRaw) || { count: 0, examples: [] };
      e.count++; if (e.examples.length < 3) e.examples.push({ line, name: donor.name });
      semantics.unrecognizedTypes.set(typeRaw, e);
    }
    if (typed.neverSolicit) donor.doNotSolicit = true;   // a bequest's donor is never solicited
    const attribution = parseAttributionNote(noteText);
    // The legacy-migration twins: imported, FLAGGED for a human, never
    // decided by the machine.
    if (/migrated from legacy id/i.test(noteText) && /may duplicate/i.test(noteText)) {
      semantics.reviewTwins.push({ line, name: donor.name, note: noteText.slice(0, 160) });
    }

    if (!txMap.amount) { items.push({ key, donor, gift: null }); record("donor_only", null, 0, donor.name); return; }
    const money = normalizeMoney(rawAmount, moneyOpts);
    if (money.convention === "comma-decimal") conventionCounts.commaDecimal++;
    else if (money.convention === "space-thousands") conventionCounts.spaceThousands++;
    if (money.value == null && !money.blank) {
      items.push({ key, donor, gift: null }); record("errored", "unparseable_amount", 0, donor.name); bumpRefused(key); return;
    }
    const dollars = money.blank ? 0 : money.value;
    const externalIdVal = txMap.externalId ? String(row[txMap.externalId] || "").trim() : "";
    const dateParse = normalizeDate(rawDate, { currentYear, dayFirst });
    const dateVal = dateParse.value;

    if (typed.kind === "soft_credit") {
      // Not money. A link from the credited person to the base gift (same
      // Gift ID or a -SC suffix); the person is created if new.
      items.push({ key, donor, gift: null });
      semanticTally.softCredits.rows++; semanticTally.softCredits.dollars += dollars;
      const baseGiftId = externalIdVal.replace(/-SC$/i, "");
      semantics.links.push({ type: "soft_credit", personKey: key, personName: donor.name, personEmail: donor.email || "",
        baseGiftExternalId: baseGiftId || undefined, dollars, date: dateVal || null, line });
      record("skipped", "soft_credit", dollars, donor.name);
      fileDollars += dollars;
      return;
    }
    if (typed.kind === "pledge") {
      // A commitment with an amount and a schedule — shown on the record,
      // never in totals.
      items.push({ key, donor, gift: null });
      semanticTally.pledges.rows++; semanticTally.pledges.dollars += dollars;
      semantics.pledges.push({ donorKey: key, donorName: donor.name, donorEmail: donor.email || "",
        amount: dollars, date: dateVal || null, notes: noteText.slice(0, 500), externalId: externalIdVal || undefined, line });
      record("skipped", "pledge_commitment", dollars, donor.name);
      fileDollars += dollars;
      return;
    }
    if (typed.kind === "in_kind") {
      // FMV where present, description from Notes — never cash, never $0.
      items.push({ key, donor, gift: null });
      semanticTally.inKind.rows++; semanticTally.inKind.dollars += dollars;
      semantics.inKind.push({ donorKey: key, donorName: donor.name, donorEmail: donor.email || "",
        fmv: dollars || null, date: dateVal || null, description: noteText.slice(0, 300), line });
      record("skipped", "in_kind", dollars, donor.name);
      fileDollars += dollars;
      return;
    }
    if (money.blank) { items.push({ key, donor, gift: null }); record("skipped", "no_amount", 0, donor.name); return; }
    if (money.value === 0) { items.push({ key, donor, gift: null }); record("skipped", "zero_amount", 0, donor.name); return; }
    if (typed.kind === "reversal" && money.value > 0) {
      // The type says money left; the sign says it arrived. A human decides.
      items.push({ key, donor, gift: null });
      record("errored", "positive_reversal", money.value, donor.name);
      fileDollars += money.value; bumpRefused(key);
      return;
    }

    if (!dateVal) { items.push({ key, donor, gift: null }); record("errored", "unparseable_date", money.value, donor.name); fileDollars += money.value; bumpRefused(key); return; }
    if (dateVal > today) {
      if (typed.kind === "pledge_payment") {
        // A future-dated pledge payment is the pledge's SCHEDULE, not a
        // failed row: routed to the pledge surface, never an error.
        items.push({ key, donor, gift: null });
        semanticTally.pledgeScheduled.rows++; semanticTally.pledgeScheduled.dollars += money.value;
        record("skipped", "pledge_scheduled", money.value, donor.name);
        fileDollars += money.value;
        return;
      }
      items.push({ key, donor, gift: null }); record("errored", "future_date", money.value, donor.name); fileDollars += money.value; bumpRefused(key); return;
    }

    const gift = mkGift(money.value);   // cents preserved — the money seam owns rounding, and it doesn't
    gift.date = dateVal;
    if (typed.kind === "pledge_payment") {
      const pm = noteText.match(/\bon pledge (G-[\w-]+)/i);
      if (pm) gift.pledgeExternalRef = pm[1];
      gift._pledgePayment = true;
    }
    if (typed.kind === "gift" && typed.matching) {
      donor.kind = donor.kind || "organisation";   // the donor of record on a corporate match IS the corporation
      semanticTally.matching.rows++; semanticTally.matching.dollars += money.value;
      if (attribution && attribution.person) {
        semantics.links.push({ type: "matching_gift", personName: attribution.person,
          corpKey: key, corpName: donor.name, giftExternalId: externalIdVal || undefined,
          dollars: money.value, date: dateVal, line });
      }
    } else if (attribution && attribution.kind === "daf" && attribution.person) {
      // BUILD-80 Part 7 — a DAF grant's recommending donor: the money stays
      // on the institution, the person gets the relationship.
      semantics.links.push({ type: "daf_recommendation", personName: attribution.person,
        corpKey: key, corpName: donor.name, giftExternalId: externalIdVal || undefined,
        dollars: money.value, date: dateVal, line });
    }
    items.push({ key, donor, gift });
    fileDollars += money.value;
    if (donor.kind === "anonymous") semanticTally.anonymous.dollars += money.value;
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
  // (BUILD-80 Part 6 changed the group keys, so the first line is looked up
  // through idxByKey — the donor's own key — not by email.)
  const keyByIndex = new Map([...idxByKey.entries()].map(([k, di]) => [di, k]));
  donors.forEach((d, di) => {
    if (!d.name || !String(d.name).trim()) {
      const k = keyByIndex.get(di);
      const ln = (k && keyFirstLine.get(k)) || "?";
      d.name = `Unnamed donor (line ${ln})`;
      d.tags = [...new Set([...(Array.isArray(d.tags) ? d.tags : []), "needs-name"])];
    }
  });
  const exclusionConflictsPre = [];
  detectImportedSustainers(donors, gifts);
  for (const d of donors) if (d.kind) { delete d.importedSustainer; delete d.importedSustainerAmount; delete d.importedSustainerLastGift; }
  // BUILD-80 Part 7 — an estate must not un-decease (or leave un-deceased)
  // its person: if a person named X exists in this file and is NOT marked
  // deceased, that is a contradiction for a human — never an auto-mark.
  for (const d of donors) {
    if (!d._estateOf) continue;
    const estMk = matchNameKey(d._estateOf);
    const person = donors.find(p => p !== d && !p.kind && matchNamesCompatible(matchNameKey(p.name), estMk));
    if (person && !person.deceased) {
      exclusionConflictsPre.push({ name: person.name, message: `"${d.name}" is in this file, but ${person.name} is not marked deceased. Flagging for review — we never auto-mark a death.` });
    }
    delete d._estateOf;
  }
  // BUILD-80 Part 5 — pledge status from its own payments: linked by the
  // "on pledge G-xxxx" note first, by donor otherwise. Fully-paid (and
  // over-paid) pledges arrive FULFILLED so no reminder ever chases a pledge
  // the donor already finished; a pledge with payments still owed stays open
  // (the two active pledgers keep their contractual-cadence drift exclusion).
  {
    const paidByRef = new Map(), paidByDonor = new Map();
    const schedByRef = new Map(), schedByDonor = new Map(), schedDateByRef = new Map(), schedDateByDonor = new Map();
    for (const d of dispositions) {
      if (d.reason !== "pledge_scheduled") continue;
      const note = String(d.raw?.[txMap.notes] ?? "");
      const pm = note.match(/\bon pledge (G-[\w-]+)/i);
      const nm = String(d.name || "").toLowerCase();
      if (pm) {
        schedByRef.set(pm[1], (schedByRef.get(pm[1]) || 0) + (d.dollars || 0));
      } else if (nm) {
        schedByDonor.set(nm, (schedByDonor.get(nm) || 0) + (d.dollars || 0));
      }
      const dRaw = txMap.date ? String(d.raw?.[txMap.date] ?? "") : "";
      const dv = normalizeDate(dRaw, { currentYear, dayFirst }).value;
      if (dv) {
        const key2 = pm ? pm[1] : nm;
        const box = pm ? schedDateByRef : schedDateByDonor;
        if (!box.get(key2) || dv > box.get(key2)) box.set(key2, dv);
      }
    }
    for (const g of gifts) {
      if (!g._pledgePayment) continue;
      if (g.pledgeExternalRef) paidByRef.set(g.pledgeExternalRef, (paidByRef.get(g.pledgeExternalRef) || 0) + g.amount);
      else {
        const dk = donors[g.donorIndex] ? (donors[g.donorIndex].email || donors[g.donorIndex].name || "").toLowerCase() : "";
        if (dk) paidByDonor.set(dk, (paidByDonor.get(dk) || 0) + g.amount);
      }
    }
    for (const p of semantics.pledges) {
      const byRef = p.externalId ? (paidByRef.get(p.externalId) || 0) : 0;
      const byDonor = paidByDonor.get(p.donorKey) || 0;
      const paid = byRef || byDonor;
      const nmKey = String(p.donorName || "").toLowerCase();
      const scheduled = (p.externalId ? schedByRef.get(p.externalId) : 0) || schedByDonor.get(nmKey) || 0;
      const lastSched = (p.externalId ? schedDateByRef.get(p.externalId) : null) || schedDateByDonor.get(nmKey) || null;
      p.status = paid >= p.amount && p.amount > 0 ? "fulfilled" : "open";
      p.paidObserved = Math.round(paid * 100) / 100;
      p.scheduledObserved = Math.round(scheduled * 100) / 100;
      // An open pledge whose remaining installments are SCHEDULED in the
      // future is on schedule — due when the last installment is, so no
      // reminder chases a donor who is paying as agreed.
      if (p.status === "open" && lastSched && (!p.date || lastSched > p.date)) p.dueDate = lastSched;
    }
  }
  // BUILD-80 Part 4.3 — the conflicts, shown: "Status says Active, Notes say
  // deceased. We set deceased." Most restrictive already won (flags OR); this
  // is the sentence a human reads before trusting the record.
  const frequencyConflicts = donors.filter(d => d.staleFrequency)
    .map(d => ({ name: d.name, message: "file says monthly, gifts say yearly" }));
  for (const d of donors) delete d.staleFrequency;
  const exclusionConflicts = [...exclusionConflictsPre];
  for (const d of donors) {
    if (d.deceased && d._activeColumnConflict) {
      exclusionConflicts.push({ name: d.name, message: "Status says Active, Notes say deceased. We set deceased." });
    } else if (d.deceased && d._sawActiveColumn) {
      exclusionConflicts.push({ name: d.name, message: "One column says Active while another marks deceased. We set deceased." });
    }
    delete d._activeColumnConflict;
    delete d._sawActiveColumn;
  }
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
    donors, gifts, dispositions, flaggedRows, largestGifts, exclusionConflicts, frequencyConflicts,
    semantics: {
      pledges: semantics.pledges,
      inKind: semantics.inKind,
      links: semantics.links,
      reviewTwins: semantics.reviewTwins,
      unrecognizedTypes: [...semantics.unrecognizedTypes.entries()].map(([type, e]) => ({ type, count: e.count, examples: e.examples })),
      tally: Object.fromEntries(Object.entries(semanticTally).map(([k, v]) => [k, { rows: v.rows, dollars: Math.round(v.dollars * 100) / 100 }])),
    },
    amountConventions: { ...conventionCounts, column: amountConv ? amountConv.columnConvention : "us" },
    dateConvention: dateConv ? { ...dateConv, applied: dateConvApplied } : null,
    identity: {
      donorIdColumn: identity.donorIdCol || "",
      mergeReview: identity.mergeReview,
      householdCandidates: identity.householdCandidates,
      conflictedIds: identity.conflictedIds,
    },
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
    // BUILD-80 Part 8 — a real sustainer often gives one-off gifts BESIDE
    // the monthly one; requiring every amount stable missed ten of them.
    // The MODAL amount's own gifts decide: 12+ occurrences of one amount at
    // a monthly cadence is a sustainer whether or not Frequency says so.
    let modalMonthly = false, modalAmount = null, modalLast = null;
    if (gs.length >= 12) {
      const byAmt = new Map();
      for (const g of gs) byAmt.set(g.amount, (byAmt.get(g.amount) || 0) + 1);
      const [amt, count] = [...byAmt.entries()].sort((x, y) => y[1] - x[1])[0];
      if (count >= 12) {
        const mg = gs.filter(g => g.amount === amt);
        const miv = [];
        for (let k = 1; k < mg.length; k++) {
          const a2 = new Date(mg[k - 1].date + "T12:00:00Z"), b2 = new Date(mg[k].date + "T12:00:00Z");
          miv.push(Math.round((b2 - a2) / 86400000));
        }
        const ms = [...miv].sort((x, y) => x - y);
        const mMed = ms[Math.floor(ms.length / 2)];
        if (mMed >= 20 && mMed <= 40) { modalMonthly = true; modalAmount = amt; modalLast = mg[mg.length - 1].date; }
      }
    }
    // The Frequency column's monthly claim counts like a note — unless the
    // pattern contradicts it, in which case the PATTERN wins and the stale
    // flag is shown ("file says monthly, gifts say yearly").
    const freqClaim = !!d._freqMonthlyClaim;
    delete d._freqMonthlyClaim;
    if (freqClaim && intervalContradicts && !modalMonthly && !intervalMonthly) {
      d.tags = [...new Set([...(Array.isArray(d.tags) ? d.tags : []), "stale-frequency"])];
      d.staleFrequency = true;
    }
    if (intervalMonthly || modalMonthly || ((noteHits >= 2 || (freqClaim && !d.staleFrequency)) && !intervalContradicts)) {
      const amts = gs.map(g => g.amount).sort((a, b) => a - b);
      d.importedSustainer = true;
      d.importedSustainerAmount = modalAmount != null ? modalAmount : (amts.length ? amts[Math.floor(amts.length / 2)] : null);
      d.importedSustainerLastGift = modalLast || (gs.length ? gs[gs.length - 1].date : null);
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
      // BUILD-80 Part 6 — a person-form name outranks a household form for
      // display ("Janice Tran" over "The Tran Family"); ALL-CAPS/lower rows
      // never displace a mixed-case one (normalizeName already re-cased).
      else if (canon.name && donor.name) {
        const ck = matchNameKey(canon.name), dk2 = matchNameKey(donor.name);
        if (ck.household && !dk2.household && matchNamesCompatible(ck, dk2)) canon.name = donor.name;
      }
      if (donor.externalDonorId && !canon.externalDonorId) canon.externalDonorId = donor.externalDonorId;
      if (Array.isArray(donor.tags) && donor.tags.length)
        canon.tags = [...new Set([...(canon.tags || []), ...donor.tags])];
      for (const k of ["email", "phone", "city", "state", "address", "zip", "notes", "owner"]) {
        if ((canon[k] == null || canon[k] === "") && donor[k]) canon[k] = donor[k];
      }
      // BUILD-77 Part 1 — safety flags OR across a donor's rows: one row
      // saying deceased makes the DONOR deceased, whichever row said it.
      if (donor.kind && !canon.kind) canon.kind = donor.kind;
      if (donor._estateOf && !canon._estateOf) canon._estateOf = donor._estateOf;
      for (const k of ["deceased", "doNotContact", "doNotSolicit", "doNotMail", "doNotEmail", "_activeColumnConflict", "_sawActiveColumn", "_freqMonthlyClaim"]) {
        if (donor[k]) canon[k] = true;
      }
      if (donor.status && !canon.status) canon.status = donor.status;
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

// ═══════════════════════════════════════════════════════════════════════════
// BUILD-82 — THE WORKBOOK LAYER
// A workbook is one import: sheets get roles with evidence, typed cells go
// through the same money/date seams a CSV string does, Donor ID is a standard
// field and the first identity key, and the join refuses orphans instead of
// inventing donors. All pure/JSX-free; tests/import-workbook-v3.test.js is
// the golden suite over tests/fixtures/build82/steward-messy-25k-v3.xlsx.
// ═══════════════════════════════════════════════════════════════════════════

// ── Part 2.2 — Donor ID comparison key. Trim, strip a trailing ".0" (a
// float-through-spreadsheet artifact), strip leading zeros for COMPARISON
// only (the record keeps the original string), compare as case-folded text.
// 4212 matches "004212", "4212.0" and " 4212 ".
export function donorIdKey(v) {
  if (v === null || v === undefined) return "";
  let s = String(v).trim();
  if (!s) return "";
  s = s.replace(/\.0+$/, "");          // 4212.0 / 4212.000 → 4212
  s = s.replace(/^0+(?=[0-9])/, "");   // 004212 → 4212 (never eats a lone 0)
  return s.toLowerCase();
}

// ── Part 3.3 — an identifier cell read as its integer text, never a float.
// A numeric 8763 that Excel held as 8763.0 must come out "8763"; scientific
// notation (1.2E+7) is damage, not an id. `siblingsZeroPadded` (the column
// carries text ids like "004212") means numeric cells LOST leading zeros —
// noted on the record, since the padding cannot be reconstructed.
export function normalizeIdCell(cell, opts = {}) {
  if (cell === null || cell === undefined || cell === "") return { value: null };
  if (typeof cell === "object" && cell.t === "n") {
    const v = cell.v;
    if (v === null || v === undefined || isNaN(v)) return { value: null };
    if (!isFinite(v) || Math.abs(v) >= 1e15) return { value: String(v), warn: "id too large for a spreadsheet number — likely damaged" };
    if (Math.round(v) !== v) return { value: String(v), warn: `id ${v} is not a whole number` };
    const out = { value: String(Math.round(v)) };
    if (opts.siblingsZeroPadded) out.warn = "numeric id — any leading zeros were lost by the spreadsheet";
    return out;
  }
  const s = String(typeof cell === "object" ? cell.v ?? "" : cell).trim();
  if (!s) return { value: null };
  if (/e\+/i.test(s)) return { value: s, warn: `id '${s}' is scientific notation — damaged by the spreadsheet` };
  return { value: s };
}

// ── Part 3.1 — MONEY THROUGH THE TYPED SEAM. A cell is {t,v,z,f} from the
// xlsx reader (t: n/s/b/e/d, z: number format, f: formula text) or a bare
// string from a CSV. Every typed shape lands on the table in the spec:
//   number (any currency/plain format)      → the number, rounded to cents
//   number with float noise (1000.0000001)  → rounded to cents (flagged)
//   number with a PERCENT format            → ×100, flagged "stored as 25%, read as $25"
//   parens-negative FORMAT                  → the number; format is display only
//   text                                    → normalizeMoney (BUILD-80), unchanged
//   formula with a cached value             → the cached value
//   formula cached 0 / none                 → REFUSED with the formula text
//   boolean, error (#N/A, #REF!)            → REFUSED with reason
export function normalizeMoneyCell(cell, opts = {}) {
  if (cell === null || cell === undefined || cell === "") return { value: null, warn: null, blank: true };
  if (typeof cell !== "object" || cell instanceof Date) return normalizeMoney(cell, opts);
  const { t, v, z, f } = cell;
  if (t === "e") return { value: null, refuse: "excel_error", warn: `cell is a spreadsheet error (${cell.w || v})` };
  if (t === "b") return { value: null, refuse: "boolean", warn: `cell is TRUE/FALSE, not an amount` };
  if (t === "n" || typeof v === "number") {
    if (f !== undefined && (v === 0 || v === null || v === undefined)) {
      return { value: null, refuse: "formula_no_value", formula: f,
               warn: `formula =${f} has no computed value — refusing to import $0` };
    }
    if (v === null || v === undefined || isNaN(v)) return { value: null, warn: null, blank: true };
    let n = v, flag = null;
    if (z && /%/.test(String(z))) {
      n = v * 100;
      flag = { kind: "percent_format", text: `stored as ${(v * 100) % 1 === 0 ? v * 100 : (v * 100).toFixed(2)}%, read as $${n % 1 === 0 ? n : n.toFixed(2)}` };
    }
    const cents = Math.round(n * 100);
    const out = { value: cents / 100, warn: null };
    if (Math.abs(n * 100 - cents) > 1e-7) out.floatNoise = true;   // 1000.0000001 → $1,000.00
    if (flag) out.flag = flag;
    if (f !== undefined) out.fromFormula = true;
    return out;
  }
  if (t === "d" || v instanceof Date) return { value: null, refuse: "date_in_amount", warn: "cell is a date, not an amount" };
  return normalizeMoney(v, opts);   // t === "s" — text through the BUILD-80 grammar, unchanged
}

// ── Part 3.2 — DATES THROUGH THE TYPED SEAM.
//   date cell            → the civil date, time dropped, NO timezone conversion
//   General number in a date column → Excel serial if 1990..(currentYear); else refused
//   serial 0, 60, pre-1900 → refused by name (Excel's blank / the leap-year ghost)
//   text                 → normalizeDate with the SHEET's inferred convention
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);   // serial 1 = 1900-01-01 (Excel's fictional calendar)
export function excelSerialToCivil(serial) {
  if (typeof serial !== "number" || isNaN(serial)) return null;
  const days = Math.floor(serial);                 // time of day dropped
  const ms = EXCEL_EPOCH_UTC + days * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function cellFormatIsDate(z) {
  if (!z || typeof z !== "string") return false;
  if (/^general$/i.test(z)) return false;
  // strip color/locale sections and quoted literals — "[RED]" carries a 'd'
  const bare = z.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
  if (/[#0?]/.test(bare)) return false;    // numeric placeholders → a number format
  return /[dmy]/i.test(bare);
}
export function normalizeDateCell(cell, opts = {}) {
  const currentYear = opts.currentYear || new Date().getFullYear();
  if (cell === null || cell === undefined || cell === "") return { value: null, warn: null };
  if (cell instanceof Date) return normalizeDate(cell, opts);
  if (typeof cell !== "object") return normalizeDate(cell, opts);
  const { t, v, z } = cell;
  if (t === "e") return { value: null, warn: `cell is a spreadsheet error (${cell.w || v})` };
  if (t === "b") return { value: null, warn: "cell is TRUE/FALSE, not a date" };
  if (t === "d" || v instanceof Date) return normalizeDate(v, opts);
  if (t === "n" || typeof v === "number") {
    const serial = v;
    if (serial === 0) return { value: null, warn: "serial 0 — a spreadsheet's blank date, refused by name" };
    if (serial === 60) return { value: null, warn: "serial 60 — Excel's fictional 1900-02-29, refused by name" };
    if (cellFormatIsDate(z)) {
      if (serial < 2) return { value: null, warn: `serial ${serial} — an Excel epoch artifact, not a gift date` };
      const civil = excelSerialToCivil(serial);
      const y = +civil.slice(0, 4);
      if (y < 1900) return { value: null, warn: `date ${civil} is before 1900 — refused` };
      return { value: civil, warn: null };
    }
    // General-format number in a date column: an Excel serial only if it lands
    // in a plausible gift window (1990..today); otherwise it is just a number.
    const civil = excelSerialToCivil(serial);
    const y = civil ? +civil.slice(0, 4) : 0;
    if (y >= 1990 && y <= currentYear) return { value: civil, warn: null, viaSerial: true };
    return { value: null, warn: `number ${serial} in a date column is not a plausible Excel serial (lands ${civil || "nowhere"})` };
  }
  return normalizeDate(v, opts);
}

// Convention inference over a TYPED date column: only the text cells vote
// (date cells and serials carry no day/month ambiguity).
export function inferDateConventionCells(cells = []) {
  const texts = [];
  for (const c of cells) {
    if (c === null || c === undefined) continue;
    if (typeof c === "object" && c.t !== "s") continue;
    texts.push(typeof c === "object" ? c.v : c);
  }
  return inferDateConvention(texts);
}

// ── Part 1.3 — rows that are not data, for WORKBOOK sheets. Adds to
// classifyBodyRow the shapes a spreadsheet grows that a report export doesn't:
// year-subtotal rows ("2023 Total" + a SUBTOTAL/SUM formula in the amount
// column), a GRAND TOTAL row, single-cell note rows ("Exported by Cheryl —
// please do not edit"), and the stray cell that inflates the used range ("x").
const YEAR_TOTAL_RE = /^((19|20)\d{2}|q[1-4]|fy\s*\d{2,4})\s+(sub)?total$/i;
const GRAND_TOTAL_RE = /^grand\s+total$/i;
const NOTE_ROW_RE = /exported|do not edit|confidential|generated|page \d+ of|report [A-Z0-9-]|as of \d/i;
export function classifyWorkbookBodyRow(cells, typedCells, headerCells) {
  const base = classifyBodyRow(cells, headerCells);
  if (base) return base;
  const filled = cells.map(c => String(c ?? "").trim()).filter(Boolean);
  const first = filled[0] || "";
  if (YEAR_TOTAL_RE.test(first) || filled.some(c => GRAND_TOTAL_RE.test(c))) {
    const amountCell = filled.find(c => /^\$?-?[\d,]+(\.\d+)?$/.test(c) && c !== first);
    const { value } = amountCell ? normalizeMoney(amountCell) : { value: null };
    return { kind: filled.some(c => GRAND_TOTAL_RE.test(c)) ? "total_row" : "subtotal_row", amount: value };
  }
  // a SUBTOTAL()/SUM() formula anywhere on the row = an aggregate row, not a gift
  if (typedCells && typedCells.some(tc => tc && typeof tc === "object" && tc.f && /^\s*(SUBTOTAL|SUM)\s*\(/i.test(tc.f))) {
    const amt = typedCells.find(tc => tc && tc.f && /^\s*(SUBTOTAL|SUM)\s*\(/i.test(tc.f));
    return { kind: "subtotal_row", amount: typeof amt.v === "number" ? amt.v : null };
  }
  if (filled.length === 1) {
    if (NOTE_ROW_RE.test(first)) return { kind: "note_row" };
    if (first.length <= 2 && !/^\d+$/.test(first)) return { kind: "stray_cell" };  // "x", "." — the used-range inflator
  }
  return null;
}

// analyzeWorkbookSheet(records, opts) — analyzeSheetRows with the workbook
// row rules above. records may carry a parallel `typed` array per record
// (null-sparse: only non-string/format-bearing cells). Returns the same shape
// as analyzeSheetRows plus `typedRows` aligned with `rows`.
export function analyzeWorkbookSheet(records, opts = {}) {
  const det = detectHeaderRow(records);
  const headerRec = records[det.index];
  const headerCells = (headerRec?.cells || []).map(c => String(c ?? "").trim());
  const headers = dedupeHeaderCells(headerCells);
  const chromeAbove = records.slice(0, det.index)
    .map(r => ({ line: r.line, text: r.cells.map(c => String(c ?? "").trim()).filter(Boolean).join(" · ") }));
  const rows = [], typedRows = [], rowLines = [], chromeRows = [];
  let totalRow = null;
  for (const rec of records.slice(det.index + 1)) {
    const chrome = classifyWorkbookBodyRow(rec.cells, rec.typed, headerCells);
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
    if (rec.typed) {
      let t = null;
      rec.typed.forEach((tc, i) => { if (tc && headers[i]) { (t = t || {})[headers[i]] = tc; } });
      typedRows.push(t);
    } else typedRows.push(null);
  }
  let maxOverflow = 0, overflowRows = 0;
  for (const r of rows) {
    const extra = r.__parsed_extra ? r.__parsed_extra.length : 0;
    if (extra > 0) { overflowRows++; if (extra > maxOverflow) maxOverflow = extra; }
  }
  return {
    headers, headerCells, rows, typedRows, rowLines, records: rows.length,
    chromeAbove, chromeRows, totalRow,
    headerLine: { line: headerRec?.line ?? 1, index: det.index, evidence: det.evidence, fallback: !!det.fallback },
    physical: { headerCells, headerCount: headerCells.length, orphanColumns: maxOverflow, overflowRows, total: headerCells.length + maxOverflow },
  };
}

// ── Part 1.1 — EVERY SHEET GETS A ROLE, WITH EVIDENCE ──────────────────────
// classifyWorkbookSheets(sheets) — sheets = [{name, headers, rows, typedRows?,
// rowCount, formulaCellRatio?}] (analyzeWorkbookSheet output + name). Returns
// [{name, role, evidence, ...perRole}] in the input order. Roles are a closed
// set; chrome and decoy are never imported without an explicit override.
const DECOY_NAME_RE = /\b(old|do not use|don'?t use|backup|archive|copy|superseded)\b|\bv1\b/i;
const PLEDGE_HDR_RE = /pledge\s*(id|#)|total\s*pledged|installments?|balance|paid\s*to\s*date/i;
const RECURRING_HDR_RE = /frequency|last\s*charge|card\s*on\s*file|next\s*charge/i;
const LIFETIME_HDR_RE = /lifetime|total\s*giv|cumulative/i;
const CONTACT_HDR_RE = /e-?mail|phone|mobile|address|city|state|zip/i;
const NAMEID_HDR_RE = /^(last|first|name|full\s*name)$|\b(last|first)\s*name\b|constituent|donor\s*id|account\s*(no|#|id)/i;
const AMOUNT_HDR_RE = /amount|^amt$|gift\s*\$|\$$/i;
const DATE_HDR_RE = /date/i;

export function classifyWorkbookSheets(sheets = []) {
  const fmtN = x => (x == null ? "?" : Number(x).toLocaleString());
  // first pass — role by structure
  const roled = sheets.map(s => {
    const headers = (s.headers || []).map(h => String(h));
    const rc = s.rowCount != null ? s.rowCount : (s.rows || []).length;
    const has = re => headers.some(h => re.test(h));
    const matching = re => headers.filter(h => re.test(h));
    if (rc === 0) return { ...s, role: "empty", evidence: "no cells — nothing to import" };
    const pledgeHits = matching(PLEDGE_HDR_RE);
    if (pledgeHits.length >= 2) return { ...s, role: "pledges", evidence: `pledge-shaped headers: ${pledgeHits.slice(0, 3).join(", ")} — commitments, not cash` };
    const recurringHits = matching(RECURRING_HDR_RE);
    if (recurringHits.length >= 2) return { ...s, role: "recurring", evidence: `sustainer-shaped headers: ${recurringHits.slice(0, 3).join(", ")}` };
    const amount = has(AMOUNT_HDR_RE), date = has(DATE_HDR_RE), nameid = has(NAMEID_HDR_RE), contact = has(CONTACT_HDR_RE), lifetime = has(LIFETIME_HDR_RE);
    // chrome: too small to be data, or no amount and no name/id, or mostly formulas
    const fr = s.formulaCellRatio || 0;
    if (rc < 15 && !(amount && date) && !(nameid && contact)) {
      return { ...s, role: "chrome", evidence: `${fmtN(rc)} row${rc === 1 ? "" : "s"}, no donor or gift shape — a cover page, summary or legend` };
    }
    if (fr > 0.5) return { ...s, role: "chrome", evidence: `${Math.round(fr * 100)}% of its cells are formulas — a computed summary, not records` };
    if (!amount && !nameid) return { ...s, role: "chrome", evidence: "no amount column and no name column — nothing importable" };
    if (nameid && contact && (!amount || lifetime) && !(amount && date && !lifetime)) {
      return { ...s, role: "donors", evidence: `name/ID plus contact columns${lifetime ? " and a lifetime-total column" : ""}, no per-gift amount — one row per person` };
    }
    if (amount && date) {
      return { ...s, role: "gifts", evidence: `an amount column and a date column — one row per gift` };
    }
    return { ...s, role: "unknown", evidence: "shape unclear — pick its role" };
  });
  // second pass — decoys: name says so, or its gift rows duplicate another
  // gift sheet at a high rate (probed on a sample, by donor-id + amount).
  const giftSheets = roled.filter(s => s.role === "gifts");
  for (const s of roled) {
    if (s.role !== "gifts") continue;
    const nameHit = DECOY_NAME_RE.test(String(s.name || ""));
    let dupRate = 0;
    if (giftSheets.length > 1) {
      const others = giftSheets.filter(o => o !== s && !DECOY_NAME_RE.test(String(o.name || "")));
      if (others.length && nameHit) {
        // probe: sample this sheet's rows against the union of others' id+amount keys
        const keyOfRow = (sheet, row) => {
          const idHdr = sheet.headers.find(h => /constituent|donor|^id$/i.test(String(h))) || sheet.headers[0];
          const amtHdr = sheet.headers.find(h => AMOUNT_HDR_RE.test(String(h)));
          if (!idHdr || !amtHdr) return null;
          const m = normalizeMoney(row[amtHdr]);
          if (m.value == null) return null;
          return donorIdKey(row[idHdr]) + "|" + Math.round(m.value * 100);
        };
        const target = new Set();
        for (const o of others) for (const r of (o.rows || [])) { const k = keyOfRow(o, r); if (k) target.add(k); }
        const sample = (s.rows || []).slice(0, 2000);
        let hit = 0, tried = 0;
        for (const r of sample) { const k = keyOfRow(s, r); if (!k) continue; tried++; if (target.has(k)) hit++; }
        dupRate = tried ? hit / tried : 0;
      }
    }
    if (nameHit || dupRate >= 0.5) {
      // the dollars an override would add — the warning the spec requires
      const amtHdr = s.headers.find(h => AMOUNT_HDR_RE.test(String(h)));
      let dollars = 0;
      if (amtHdr) for (const r of (s.rows || [])) { const m = normalizeMoney(r[amtHdr]); if (m.value != null && m.value > 0) dollars += m.value; }
      s.role = "decoy";
      s.decoyDollars = Math.round(dollars * 100) / 100;
      s.decoyDupRate = Math.round(dupRate * 100);
      s.evidence = nameHit
        ? `its name says so ("${s.name}")${dupRate ? ` and ${Math.round(dupRate * 100)}% of its sampled rows duplicate another sheet's gifts` : ""} — importing it would add $${s.decoyDollars.toLocaleString(undefined, { minimumFractionDigits: 2 })} that is already there or superseded`
        : `${Math.round(dupRate * 100)}% of its sampled rows duplicate another gift sheet by donor and amount`;
    }
  }
  return roled;
}

// ── Part 1.4 — THE LEGEND. Chrome sheets are read for sentences about
// hidden rows, colours and comments; what is found is QUOTED back on the
// mapper next to what the file's own structure shows. Never acted on
// automatically.
const LEGEND_RE = /hidden|yellow|colou?r|highlight|comment/i;
export function extractWorkbookLegend(sheets = []) {
  const lines = [];
  for (const s of sheets) {
    if (s.role !== "chrome") continue;
    const scan = txt => { const t = String(txt || "").trim(); if (t && LEGEND_RE.test(t) && t.length < 300) lines.push({ sheet: s.name, text: t }); };
    for (const c of (s.chromeAbove || [])) scan(c.text);
    for (const r of (s.rows || [])) for (const v of Object.values(r)) scan(v);
    // header cells of a chrome sheet are content too (Cover has no real header)
    for (const h of (s.headers || [])) scan(h);
  }
  return lines;
}

// ── Part 3.5 — WHAT THE SHEET KNOWS THAT THE CELLS DON'T. Hidden rows,
// hidden columns, fill colours and cell comments are detected (by the reader)
// and SURFACED as questions, never silently included or excluded. `meta` is
// {hiddenRows:[rowNo], hiddenCols:[{index, header}], fillRows:{rowNo:count},
// comments:[{row, col, header, text}]} from the workbook reader; rowToLine
// maps a physical sheet row to the analyzed body row (or null for chrome).
const EXCLUSION_COMMENT_RE = /deceas|passed away|\bd\.\s*\d{4}|do not (call|contact|mail|solicit|email)|dnc\b/i;
export function buildSheetSignals(sheetName, meta = {}, legend = [], opts = {}) {
  const signals = [];
  const legendFor = re => legend.filter(l => re.test(l.text)).map(l => `The ${l.sheet} sheet says: “${l.text}”`).join(" ");
  const hr = meta.hiddenRows || [];
  if (hr.length) {
    signals.push({ kind: "hidden_rows", sheet: sheetName, count: hr.length, rows: hr,
      legend: legendFor(/hidden/i) || null,
      question: `${hr.length} rows on ${sheetName} are hidden.` + (legendFor(/hidden/i) ? ` ${legendFor(/hidden/i)}` : "") + ` Treat them per the legend / import as normal / skip?`,
      options: ["legend", "import", "skip"] });
  }
  const fillRows = Object.keys(meta.fillRows || {});
  if (fillRows.length) {
    signals.push({ kind: "filled_rows", sheet: sheetName, count: fillRows.length, rows: fillRows.map(Number),
      color: meta.fillColor || "yellow",
      legend: legendFor(/yellow|colou?r|highlight/i) || null,
      question: `${fillRows.length} rows are highlighted ${meta.fillColorName || "yellow"}.` + (legendFor(/yellow|colou?r|highlight/i) ? ` ${legendFor(/yellow|colou?r|highlight/i)}` : " The file's legend doesn't say why."),
      options: ["legend", "import", "skip"] });
  }
  const comments = meta.comments || [];
  if (comments.length) {
    const excl = comments.filter(c => EXCLUSION_COMMENT_RE.test(String(c.text || "")));
    signals.push({ kind: "comments", sheet: sheetName, count: comments.length, exclusionCount: excl.length,
      comments: comments.slice(0, 60),
      question: `${comments.length} names carry a comment. ${excl.length} of them mention deceased or do-not-contact. Here they are.`,
      options: ["route", "ignore"] });
  }
  for (const hc of (meta.hiddenCols || [])) {
    const header = hc.header || (opts.headerCells ? opts.headerCells[hc.index] : null);
    signals.push({ kind: "hidden_column", sheet: sheetName, index: hc.index, header,
      question: `Column ${hc.ref || ""} is hidden. It's called ${header || "(no header)"}. It was not auto-mapped.`,
      options: ["map", "ignore"] });
  }
  return signals;
}

// ── Part 4.2 — THE STANDARD LIST IS COMPLETE. One entry per standard field,
// with the header vocabulary that auto-maps to it. Aliases match the WHOLE
// normalized header (never a substring — "Unnamed: 31" containing "name" is
// the pinned trap that threw away 23,867 donors), case- and punctuation-
// insensitive.
const normHdr = h => String(h || "").toLowerCase().replace(/[?_.:#/\\-]+/g, " ").replace(/\s+/g, " ").trim();
export const STANDARD_DONOR_FIELDS = [
  { key: "donorId",    label: "Donor ID",     aliases: ["donor id", "constituent id", "account id", "account no", "account number", "account", "record id", "supporter id", "member id", "contact id", "customer id", "pid", "cid", "donor no", "donor number", "constituent"] },
  { key: "_firstName", label: "First name",   aliases: ["first", "first name", "firstname", "given name"] },
  { key: "_lastName",  label: "Last name",    aliases: ["last", "last name", "lastname", "surname", "family name"] },
  { key: "name",       label: "Full name",    aliases: ["name", "full name", "donor name", "display name", "contact name"] },
  { key: "middleName", label: "Middle",       aliases: ["middle", "middle name", "middle initial", "mi"] },
  { key: "suffix",     label: "Suffix",       aliases: ["suffix", "name suffix"] },
  { key: "salutation", label: "Salutation",   aliases: ["salutation", "title", "prefix", "greeting", "dear"] },
  { key: "spouse",     label: "Spouse",       aliases: ["spouse", "spouse name", "partner", "partner name"] },
  { key: "householdId",label: "Household ID", aliases: ["household id", "household", "hh id", "family id"] },
  { key: "email",      label: "Email",        aliases: ["email", "email address", "e mail", "primary email"] },
  { key: "email2",     label: "Email 2",      aliases: ["email 2", "email2", "secondary email", "alt email", "other email"] },
  { key: "phone",      label: "Phone",        aliases: ["phone", "phone number", "telephone", "home phone", "primary phone"] },
  { key: "mobile",     label: "Mobile",       aliases: ["mobile", "cell", "cell phone", "mobile phone"] },
  { key: "address1",   label: "Address 1",    aliases: ["address", "address 1", "address1", "street", "street address", "addr 1", "address line 1"] },
  { key: "address2",   label: "Address 2",    aliases: ["address 2", "address2", "addr 2", "address line 2", "apt", "unit"] },
  { key: "city",       label: "City",         aliases: ["city", "town"] },
  { key: "state",      label: "State",        aliases: ["state", "province", "region", "st"] },
  { key: "zip",        label: "ZIP",          aliases: ["zip", "zip code", "postal", "postal code", "postcode"] },
  { key: "country",    label: "Country",      aliases: ["country"] },
  { key: "donorType",  label: "Donor type",   aliases: ["donor type", "constituent type", "record type", "entity type"] },
  { key: "board",      label: "Board",        aliases: ["board", "board member", "board?"] },
  // The flag family (BUILD-58/BUILD-80) — detectExclusionColumn routes these;
  // they are here so the DROPDOWN shows them as standard targets too.
  { key: "doNotMail",    label: "Do not mail",    aliases: ["do not mail", "dnm", "no mail"], flag: true },
  { key: "doNotSolicit", label: "Do not solicit", aliases: ["do not solicit", "dns", "no solicit", "no appeals"], flag: true },
  { key: "doNotEmail",   label: "Do not email",   aliases: ["do not email", "no email"], flag: true },
  { key: "deceased",     label: "Deceased",       aliases: ["deceased", "is deceased", "deceased?", "deceased date"], flag: true },
  { key: "status",     label: "Status",       aliases: ["status", "donor status"] },
  { key: "notes",      label: "Notes",        aliases: ["notes", "note", "comments", "memo", "remarks"] },
  { key: "owner",      label: "Owner",        aliases: ["owner", "assigned to", "assigned officer", "solicitor", "gift officer", "relationship manager", "account manager", "managed by", "assigned fundraiser"] },
  // aggregate history columns a donors sheet legitimately carries
  { key: "total",      label: "Lifetime giving", aliases: ["lifetime giving", "lifetime", "total giving", "total", "total donated", "cumulative giving"] },
  { key: "lastGift",   label: "Last gift date",  aliases: ["last gift", "last gift date", "last donation date", "most recent gift date"] },
  { key: "firstGift",  label: "First gift date", aliases: ["first gift", "first gift date"] },
  { key: "gifts",      label: "Gift count",      aliases: ["gift count", "gifts", "number of gifts", "# gifts", "# donations", "donations"] },
];
export const STANDARD_GIFT_FIELDS = [
  { key: "externalId", label: "Gift ID",      aliases: ["gift id", "gift no", "gift number", "transaction id", "ref", "reference", "ref no", "receipt id"] },
  { key: "donorId",    label: "Donor ID",     aliases: ["donor id", "constituent id", "account id", "account no", "id", "pid", "cid", "supporter id", "member id", "donor no", "constituent"] },
  { key: "date",       label: "Date",         aliases: ["date", "gift date", "donation date", "transaction date", "posted", "post date"] },
  { key: "amount",     label: "Amount",       aliases: ["amount", "gift amount", "donation amount", "amt", "total", "value"] },
  { key: "type",       label: "Gift type",    aliases: ["type", "gift type", "payment type", "transaction type"] },
  { key: "fund",       label: "Fund",         aliases: ["fund", "designation", "restriction", "purpose", "allocation"] },
  { key: "campaign",   label: "Appeal",       aliases: ["appeal", "campaign", "appeal code", "source", "source code", "solicitation"] },
  { key: "paymentMethod", label: "Payment method", aliases: ["payment method", "payment", "pay method", "tender", "method"] },
  { key: "receipt",    label: "Receipt",      aliases: ["receipt", "receipt no", "receipt #", "receipt number", "receipted"] },
  { key: "softCreditTo", label: "Soft credit to", aliases: ["soft credit", "soft credit id", "soft credit to", "credited to"] },
  { key: "pledgeId",   label: "Pledge ID",    aliases: ["pledge id", "pledge no", "pledge #"] },
  { key: "donorName",  label: "Donor name",   aliases: ["donor name", "donor", "name", "constituent name", "full name", "donor email"] },
  { key: "donorEmail", label: "Donor email",  aliases: ["email", "donor email", "email address"] },
  { key: "notes",      label: "Notes",        aliases: ["notes", "note", "comments", "memo"] },
];
export const STANDARD_RECURRING_FIELDS = [
  { key: "donorId",    label: "Donor ID",     aliases: ["donor id", "constituent id", "id", "account id"] },
  { key: "frequency",  label: "Frequency",    aliases: ["frequency", "freq", "cadence", "interval"] },
  { key: "amount",     label: "Amount",       aliases: ["amount", "gift amount", "amt"] },
  { key: "startDate",  label: "Start date",   aliases: ["start date", "started", "since", "first charge"] },
  { key: "lastCharge", label: "Last charge",  aliases: ["last charge", "last charged", "last payment", "last gift"] },
  { key: "status",     label: "Status",       aliases: ["status", "state"] },
  { key: "cardOnFile", label: "Card on file", aliases: ["card on file", "card", "payment method"] },
];

// guessStandardField(header, entity) — WHOLE-HEADER alias match (normalized),
// with the evidence sentence the BUILD-80 rule requires per guess. Entity
// vocabulary differs: a bare "ID" on a GIFTS sheet is the donor key (the
// legacy-export shape this build exists for); on a donors sheet it is the
// Donor ID too; "Ref" on gifts is the gift id; "Designation"→Fund,
// "Campaign"→Appeal.
export function guessStandardField(header, entity = "donor") {
  const h = normHdr(header);
  if (!h) return null;
  const list = entity === "gift" ? STANDARD_GIFT_FIELDS : entity === "recurring" ? STANDARD_RECURRING_FIELDS : STANDARD_DONOR_FIELDS;
  if (entity === "gift" && h === "id") return { key: "donorId", evidence: `“${header}” on a gift sheet is the donor key — the column that links each gift to its person` };
  if (entity === "donor" && h === "id") return { key: "donorId", evidence: `“${header}” — the donor's identifier from the source system` };
  for (const f of list) {
    if (f.aliases.includes(h)) return { key: f.key, evidence: `“${header}” matches the standard ${f.label} field` };
  }
  return null;
}

// buildStandardMapping(headers, rows, entity) — the auto-mapper, rebuilt on
// three rules the Part 0 catastrophe demands:
//  1. WHOLE-header vocabulary only (substring matching is how "Unnamed: 31"
//     became the name column and 23,867 of 25,300 donors were thrown away).
//  2. ONE header per field: a second header guessing an already-taken field
//     falls to its secondary slot (Email→Email 2, Phone→Mobile) or stays
//     unmapped — never a silent overwrite (Email 2 overwriting Email was the
//     other half of the catastrophe).
//  3. Every guess still passes validateMappingChoice over the full values.
const SECONDARY_SLOT = { email: "email2", phone: "mobile", address1: "address2" };
export function buildStandardMapping(headers = [], rows = [], entity = "donor") {
  const mapping = {};   // header → field key
  const evidence = {};  // header → sentence
  const taken = new Set();
  for (const header of headers) {
    const g = guessStandardField(header, entity);
    if (!g) continue;
    let key = g.key;
    if (taken.has(key)) {
      const alt = SECONDARY_SLOT[key];
      if (alt && !taken.has(alt)) { key = alt; }
      else { evidence[header] = `“${header}” also looks like ${g.key}, but that field is already mapped — left for you`; continue; }
    }
    const legacyKey = { address1: "address", middleName: "middle" }[key] || key;
    const v = validateMappingChoice(headers, rows, header, legacyKey === "donorId" ? "" : legacyKey);
    if (!v.ok) { evidence[header] = `“${header}” → ${key} refused: ${v.summary}`; continue; }
    mapping[header] = key;
    taken.add(key);
    evidence[header] = g.evidence + (v.summary ? ` — ${v.summary}` : "");
  }
  return { mapping, evidence };
}

// ── Part 2 — THE JOIN ──────────────────────────────────────────────────────
// linkWorkbookGifts(donors, giftItems, opts) — the workbook-wide link.
//  * The donors sheet is the source of record: EVERY donor row is a donor,
//    gifts or none (prospects get records).
//  * Donor ID first, then email, then name — per GIFT ROW, so a legacy sheet
//    with only an ID column still links, and a gift sheet with emails links
//    the rows an ID typo orphaned.
//  * An orphan (matches nothing, and the row carries no name/email of its
//    own) is REFUSED with its sheet, row and id — never a donor named after
//    an ID, never silently dropped.
export function linkWorkbookGifts(donors = [], giftItems = [], opts = {}) {
  const byId = new Map(), byEmail = new Map(), byName = new Map();
  donors.forEach((d, i) => {
    // a folded duplicate's id must land its gifts on the SURVIVING record —
    // index every id the row carries (externalDonorIds after a dedup pass).
    const ids = Array.isArray(d.externalDonorIds) && d.externalDonorIds.length
      ? d.externalDonorIds : [d.externalDonorId ?? d._donorId];
    for (const one of ids) {
      const idk = donorIdKey(one);
      if (idk && !byId.has(idk)) byId.set(idk, i);
    }
    const em = String(d.email || "").toLowerCase().trim();
    if (em && !byEmail.has(em)) byEmail.set(em, i);
    const nk = matchNameKey(d.name || "");
    if (nk.key && !byName.has(nk.key)) byName.set(nk.key, i);
  });
  const outDonors = donors.slice();
  const gifts = [];
  const refusedOrphans = [];
  const minimalByKey = new Map();
  let matchedById = 0, matchedByEmail = 0, matchedByName = 0, newDonors = 0, skippedNoGift = 0;
  for (const item of giftItems) {
    if (!item || !item.gift) { skippedNoGift++; continue; }
    let di;
    const idk = donorIdKey(item.donorId);
    if (idk !== "" && byId.has(idk)) { di = byId.get(idk); matchedById++; }
    if (di === undefined) {
      const em = String(item.email || "").toLowerCase().trim();
      if (em && byEmail.has(em)) { di = byEmail.get(em); matchedByEmail++; }
    }
    if (di === undefined) {
      const nk = matchNameKey(item.name || "");
      if (nk.key && byName.has(nk.key)) { di = byName.get(nk.key); matchedByName++; }
    }
    if (di === undefined) {
      const minKey = String(item.email || "").toLowerCase().trim() || matchNameKey(item.name || "").key;
      if (!minKey) {
        refusedOrphans.push({ sheet: item.sheet || "", line: item.line || null, id: item.donorId || "",
          dollars: item.gift.amount, reason: "no matching donor — the id matches nothing on any sheet and the row carries no name or email" });
        continue;
      }
      if (minimalByKey.has(minKey)) di = minimalByKey.get(minKey);
      else {
        di = outDonors.length;
        const md = { name: item.name || "", email: item.email || "", stage: "prospect" };
        if (!md.name) { md.name = `Unnamed donor (${item.sheet || "gifts"} line ${item.line || "?"})`; md.tags = ["needs-name"]; }
        outDonors.push(md);
        minimalByKey.set(minKey, di);
        newDonors++;
      }
    }
    gifts.push({ ...item.gift, donorIndex: di });
  }
  return { donors: outDonors, gifts, refusedOrphans,
           matchedById, matchedByEmail, matchedByName, newDonors, skippedNoGift,
           matchedGifts: matchedById + matchedByEmail + matchedByName };
}

// ── Part 2 / verification 3 — duplicate PEOPLE on the donors sheet fold
// through a review list. BUILD-80's identity order, applied to one-row-per-
// donor data: distinct IDs stay distinct people UNLESS a stronger key (same
// email with compatible names, same phone with compatible names) says they
// are one person twice. Never name-only across distinct IDs. Returns the
// surviving donor list, an index map (original → surviving), and the review
// list with every fold's reason — the UNDO surface.
export function resolveDonorSheetDuplicates(donors = []) {
  const parent = donors.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const folds = [];
  const union = (a, b, reason) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const keep = Math.min(ra, rb), fold = Math.max(ra, rb);
    parent[fold] = keep;
    folds.push({ surviving: keep, folded: fold, reason });
  };
  const phoneKey = v => { const d = String(v || "").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-10) : ""; };
  const byEmail = new Map(), byPhone = new Map();
  donors.forEach((d, i) => {
    const mk = matchNameKey(d.name || "");
    const em = emailIdentity(d.email);
    if (em) {
      const list = byEmail.get(em) || [];
      const hit = list.find(e => !mk.key || !e.mk.key || matchNamesCompatible(e.mk, mk));
      if (hit) union(hit.i, i, `same email ${em}`);
      else { list.push({ i, mk }); byEmail.set(em, list); }
    }
    for (const p of [phoneKey(d.phone), phoneKey(d.mobile)]) {
      if (!p) continue;
      const list = byPhone.get(p) || [];
      const hit = list.find(e => mk.key && e.mk.key && matchNamesCompatible(e.mk, mk));
      if (hit) union(hit.i, i, `same phone …${p.slice(-4)} and a compatible name`);
      else { list.push({ i, mk }); byPhone.set(p, list); }
    }
  });
  // assemble: surviving donor absorbs the folded rows' ids/emails; gifts
  // posted to EITHER external id land on the survivor.
  const rootSet = new Map();  // root → surviving output index
  const out = [], indexMap = new Array(donors.length), review = [];
  donors.forEach((d, i) => {
    const r = find(i);
    if (!rootSet.has(r)) { rootSet.set(r, out.length); out.push({ ...donors[r], externalDonorIds: [] }); }
    const oi = rootSet.get(r);
    indexMap[i] = oi;
    const surv = out[oi];
    const xid = d.externalDonorId ?? d._donorId;
    if (xid && !surv.externalDonorIds.includes(String(xid))) surv.externalDonorIds.push(String(xid));
    if (i !== r) {
      if (!surv.email && d.email) surv.email = d.email;
      if (!surv.phone && d.phone) surv.phone = d.phone;
    }
  });
  for (const f of folds) {
    review.push({ surviving: donors[f.surviving].name || donors[f.surviving].email || `row ${f.surviving}`,
                  folded: donors[f.folded].name || donors[f.folded].email || `row ${f.folded}`,
                  foldedId: String(donors[f.folded].externalDonorId ?? donors[f.folded]._donorId ?? ""),
                  reason: f.reason });
  }
  return { donors: out, indexMap, review, foldedRows: donors.length - out.length };
}

// ── THE GIFT-ROW BUILDER FOR A WORKBOOK SHEET — every cell through the
// typed seams, every row exactly one disposition, cents preserved. Returns
// { items, refusals, routed, flags, convention, report } where items feed
// linkWorkbookGifts and refusals/routed are itemised by sheet+line for the
// Part 6 skip-reason download.
export function buildWorkbookGiftRows(sheet, opts = {}) {
  const { headers = [], rows = [], typedRows = [], rowLines = [], name: sheetName = "" } = sheet;
  const { mapping } = buildStandardMapping(headers, rows, "gift");
  const col = key => Object.keys(mapping).find(h => mapping[h] === key) || "";
  const amountCol = col("amount"), dateCol = col("date"), idCol = col("donorId"),
        typeCol = col("type"), fundCol = col("fund"), campaignCol = col("campaign"),
        payCol = col("paymentMethod"), notesCol = col("notes"), extIdCol = col("externalId"),
        nameCol = col("donorName"), emailCol = col("donorEmail"),
        softCol = col("softCreditTo"), pledgeCol = col("pledgeId"), receiptCol = col("receipt");

  // per-SHEET date convention (Part 3.2): the text cells of THIS sheet vote.
  const dateCells = rows.map((r, i) => {
    const t = typedRows[i];
    return t && t[dateCol] !== undefined ? t[dateCol] : r[dateCol];
  });
  const convention = inferDateConventionCells(dateCells);
  const dayFirst = convention.convention === "dmy";

  // id-column padding probe: any text id with a leading zero means numeric
  // siblings LOST theirs (Part 3.3's note).
  const siblingsZeroPadded = idCol ? rows.some(r => /^0\d+$/.test(String(r[idCol] ?? "").trim())) : false;

  const items = [];
  const refusals = [];   // [{sheet, line, reason, detail, dollars}]
  const routed = { pledges: [], softCredits: [], inKind: [], refunds: [], reversals: [] };
  const flags = [];      // [{sheet, line, kind, text}] — imported but flagged (percent reads)
  const columnNotes = [];
  if (siblingsZeroPadded && idCol) columnNotes.push(`Numeric ids in “${idCol}” lost their leading zeros to the spreadsheet — matched by value, originals kept where the cell was text`);
  let builtGifts = 0, dollarsIn = 0, floatNoiseRows = 0;

  rows.forEach((row, i) => {
    const line = rowLines[i] || i + 2;
    const typed = typedRows[i] || {};
    const cellOf = h => (typed[h] !== undefined ? typed[h] : row[h]);
    const idv = idCol ? normalizeIdCell(cellOf(idCol), { siblingsZeroPadded }) : { value: null };
    const donorId = idv.value || "";
    const email = emailCol ? String(row[emailCol] || "").trim() : "";
    const dname = nameCol ? String(row[nameCol] || "").trim() : "";
    const base = { sheet: sheetName, line, donorId, email, name: dname };

    const m = normalizeMoneyCell(cellOf(amountCol), opts);
    if (m.refuse) {
      refusals.push({ ...base, reason: m.refuse, detail: m.warn, formula: m.formula || undefined });
      return;
    }
    if (m.blank) { refusals.push({ ...base, reason: "no_amount", detail: "amount cell is blank" }); return; }
    if (m.value == null) { refusals.push({ ...base, reason: "unreadable_amount", detail: m.warn || `couldn't read amount '${row[amountCol] ?? ""}'` }); return; }

    const typeRaw = typeCol ? String(row[typeCol] || "") : "";
    const cls = classifyGiftType(typeRaw);
    const dollars = m.value;

    if (m.value < 0 || cls.kind === "refund" || cls.kind === "reversal") {
      if (m.value >= 0 && cls.kind === "reversal") { routed.reversals.push({ ...base, dollars, detail: "reversal with a POSITIVE amount — a human must decide" }); return; }
      routed.refunds.push({ ...base, dollars, type: typeRaw });
      return;
    }
    if (cls.kind === "pledge") { routed.pledges.push({ ...base, dollars, detail: "pledge commitment — on the record, never in totals" }); return; }
    if (cls.kind === "soft_credit") { routed.softCredits.push({ ...base, dollars }); return; }
    if (cls.kind === "in_kind") { routed.inKind.push({ ...base, dollars, description: notesCol ? row[notesCol] : "" }); return; }
    if (m.value === 0) { refusals.push({ ...base, reason: "zero_amount", detail: "amount is $0" }); return; }

    const d = normalizeDateCell(cellOf(dateCol), { dayFirst, currentYear: opts.currentYear });
    if (!d.value) {
      refusals.push({ ...base, reason: "unreadable_date", detail: d.warn || `couldn't read date '${row[dateCol] ?? ""}'`, dollars });
      return;
    }
    if (m.flag) flags.push({ ...base, kind: m.flag.kind, text: m.flag.text, dollars });
    if (m.floatNoise) floatNoiseRows++;

    const gift = {
      amount: dollars,                      // decimal dollars — the server's toCents seam keeps the pennies
      date: d.value,
      type: typeRaw ? typeRaw.toLowerCase() : (payCol ? String(row[payCol] || "").toLowerCase() || "cash" : "cash"),
      campaign: campaignCol ? String(row[campaignCol] || "") : "",
      notes: [notesCol ? String(row[notesCol] || "") : "",
              fundCol && row[fundCol] ? `Fund: ${row[fundCol]}` : "",
              receiptCol && row[receiptCol] ? `Receipt ${row[receiptCol]}` : "",
              pledgeCol && row[pledgeCol] ? `on pledge ${row[pledgeCol]}` : "",
              softCol && row[softCol] ? `soft credit to ${row[softCol]}` : ""].filter(Boolean).join(" · "),
      externalId: extIdCol ? (String(row[extIdCol] || "").trim() || undefined) : undefined,
    };
    dollarsIn += dollars;
    builtGifts++;
    items.push({ ...base, gift });
  });

  return { items, refusals, routed, flags, convention, mapping, columnNotes,
           report: { sheet: sheetName, giftRows: rows.length, builtGifts,
                     dollarsIn: Math.round(dollarsIn * 100) / 100,
                     refused: refusals.length, floatNoiseRows,
                     routedCounts: Object.fromEntries(Object.entries(routed).map(([k, v]) => [k, v.length])) } };
}

// ── Part 5 — PLEDGES ARE COMMITMENTS, NEVER CASH ───────────────────────────
export function extractWorkbookPledges(sheet, opts = {}) {
  const { headers = [], rows = [], typedRows = [], rowLines = [] } = sheet;
  const find = re => headers.find(h => re.test(String(h))) || "";
  const idCol = find(/pledge\s*(id|#|no)/i);
  const donorCol = find(/constituent|donor|account/i);
  const dateCol = find(/pledge\s*date|^date$/i);
  const totalCol = find(/total\s*pledged|pledge\s*amount|^amount$/i);
  const paidCol = find(/paid\s*to\s*date|^paid$/i);
  const installCol = find(/installment/i);
  const statusCol = find(/status/i);
  const pledges = [], refusals = [];
  rows.forEach((row, i) => {
    const typed = typedRows[i] || {};
    const cellOf = h => (typed[h] !== undefined ? typed[h] : row[h]);
    const line = rowLines[i] || i + 2;
    const total = normalizeMoneyCell(cellOf(totalCol), opts);
    if (total.value == null || total.value <= 0) { refusals.push({ sheet: sheet.name, line, reason: "unreadable_amount", detail: total.warn || "no pledged amount" }); return; }
    const paid = normalizeMoneyCell(cellOf(paidCol), opts);
    const d = normalizeDateCell(cellOf(dateCol), opts);
    pledges.push({
      externalId: String(row[idCol] || "").trim() || undefined,
      donorExternalId: normalizeIdCell(cellOf(donorCol)).value || "",
      date: d.value || null,
      amount: total.value,
      paidToDate: paid.value || 0,
      installments: installCol ? parseInt(row[installCol]) || null : null,
      status: /fulfilled|complete|paid/i.test(String(row[statusCol] || "")) ? "fulfilled" : "open",
    });
  });
  const totalPledged = Math.round(pledges.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  return { pledges, refusals, totalPledged };
}

// ── Part 5 — RECURRING → THE BUILD-77 SUSTAINER STATES ─────────────────────
// Failed + a last charge 3–6 months back = the RECOVERY list (they didn't
// leave; their card did). Active + a stale last charge = a claim the gift
// PATTERN gets to overrule (the stale flag is shown either way).
export function extractWorkbookRecurring(sheet, opts = {}) {
  const { headers = [], rows = [], typedRows = [], rowLines = [] } = sheet;
  const anchor = opts.anchorDate ? new Date(opts.anchorDate + "T12:00:00Z") : new Date();
  const find = re => headers.find(h => re.test(String(h))) || "";
  const idCol = find(/constituent|donor|account|^id$/i);
  const freqCol = find(/frequency|freq/i);
  const amtCol = find(/amount/i);
  const lastCol = find(/last\s*charge|last\s*payment/i);
  const statusCol = find(/status/i);
  const cardCol = find(/card/i);
  const claims = [];
  rows.forEach((row, i) => {
    const typed = typedRows[i] || {};
    const cellOf = h => (typed[h] !== undefined ? typed[h] : row[h]);
    const id = normalizeIdCell(cellOf(idCol)).value;
    if (!id) return;
    const amt = normalizeMoneyCell(cellOf(amtCol), opts);
    const last = normalizeDateCell(cellOf(lastCol), opts);
    const status = String(row[statusCol] || "").trim().toLowerCase();
    const daysSince = last.value ? Math.round((anchor - new Date(last.value + "T12:00:00Z")) / 86400000) : null;
    const freqRaw = String(row[freqCol] || "").trim();
    const monthly = /^m(onthly)?$|every\s*month|^12\s*\/\s*yr/i.test(freqRaw);
    const c = { donorExternalId: id, line: rowLines[i] || i + 2,
      frequency: freqRaw, monthly, amount: amt.value, lastCharge: last.value || null,
      status, cardOnFile: cardCol ? String(row[cardCol] || "") : "", daysSince };
    if (/failed|declined|past.?due/.test(status) && daysSince != null && daysSince >= 60 && daysSince <= 200) {
      c.recovery = true;   // failed 3–6 months back: recoverable — the reconnect surface
    } else if (/active|current|ok/.test(status) && daysSince != null && daysSince >= 100) {
      c.staleClaim = true; // "Active" with no charge for 3.5+ months — the pattern wins
    }
    claims.push(c);
  });
  return { claims,
           recovery: claims.filter(c => c.recovery),
           stale: claims.filter(c => c.staleClaim) };
}

// ── Part 6 — the workbook reconciliation: per sheet and once for the whole
// workbook. "In your file" is the sum of gift rows across the gift sheets
// AFTER Part 1.3 (subtotal/note rows are never counted), and every row is
// imported, refused (by reason) or routed (by kind) — the two-axis invariant
// from BUILD-78 applied at workbook scale.
export function reconcileWorkbook(sheetReports = []) {
  const total = { rowsInFile: 0, imported: 0, refused: 0, routed: 0 };
  const perSheet = sheetReports.map(r => {
    const routedN = Object.values(r.routedCounts || {}).reduce((s, n) => s + n, 0);
    const acc = { sheet: r.sheet, rowsInFile: r.giftRows, imported: r.builtGifts, refused: r.refused, routed: routedN,
                  balanced: r.giftRows === r.builtGifts + r.refused + routedN };
    total.rowsInFile += acc.rowsInFile; total.imported += acc.imported; total.refused += acc.refused; total.routed += acc.routed;
    return acc;
  });
  return { perSheet, workbook: { ...total, balanced: total.rowsInFile === total.imported + total.refused + total.routed } };
}

// ── THE WORKBOOK READER — one pass over a SheetJS workbook, shared verbatim
// by the client (which lazy-imports xlsx) and the Node suites (which require
// it). Produces, per sheet: records ({cells, typed, line}) ready for
// analyzeWorkbookSheet, plus the Part 3.5 meta the cells can't carry (hidden
// rows/cols, fill colours, comments) and a formula ratio for role evidence.
// The file is read ONCE; `typed` is null-sparse (only non-text cells and
// %-formatted cells allocate), so 92,000 rows are never held as strings four
// times over.
export function extractWorkbookFromSheetJS(wb, XLSX) {
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) { out.push({ name, records: [], meta: {}, formulaCellRatio: 0 }); continue; }
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const records = [];
    let formulaCells = 0, totalCells = 0;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells = [];
      let typed = null;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v === undefined || cell.v === null) { cells.push(""); continue; }
        totalCells++;
        if (cell.f !== undefined) formulaCells++;
        const t = cell.t;
        if (t === "s") {
          cells.push(String(cell.v).trim());
          if (cell.f !== undefined) { (typed = typed || [])[c - range.s.c] = { t, v: cell.v, f: cell.f }; }
          continue;
        }
        const tc = { t, v: cell.v };
        if (cell.z && cell.z !== "General") tc.z = cell.z;
        if (cell.f !== undefined) tc.f = cell.f;
        if (t === "e") tc.w = cell.w;
        (typed = typed || [])[c - range.s.c] = tc;
        if (t === "n") cells.push(cellFormatIsDate(cell.z) ? (excelSerialToCivil(cell.v) || String(cell.v)) : String(cell.v));
        else if (t === "d" || cell.v instanceof Date) cells.push(isNaN(cell.v) ? "" : new Date(cell.v).toISOString().split("T")[0]);
        else if (t === "b") cells.push(cell.v ? "TRUE" : "FALSE");
        else if (t === "e") cells.push(String(cell.w || "#ERROR"));
        else cells.push(String(cell.v).trim());
      }
      const rec = { cells, line: r + 1 };
      if (typed) rec.typed = typed;
      records.push(rec);
    }
    // Part 3.5 meta — hidden rows/cols, fills, comments
    const meta = { hiddenRows: [], hiddenCols: [], fillRows: {}, comments: [] };
    (ws["!rows"] || []).forEach((rw, i) => { if (rw && rw.hidden) meta.hiddenRows.push(i + 1); });
    (ws["!cols"] || []).forEach((cl, i) => {
      if (cl && cl.hidden) meta.hiddenCols.push({ index: i, ref: XLSX.utils.encode_col(i), header: null });
    });
    const fillCount = {};   // rgb → Set of rows
    for (const addr in ws) {
      if (addr[0] === "!") continue;
      const cell = ws[addr];
      const m = addr.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const row = +m[2];
      if (cell.s && cell.s.patternType === "solid" && cell.s.fgColor && cell.s.fgColor.rgb) {
        const rgb = cell.s.fgColor.rgb;
        (fillCount[rgb] = fillCount[rgb] || new Set()).add(row);
      }
      if (cell.c && cell.c.length) {
        meta.comments.push({ row, col: m[1], text: cell.c.map(x => String(x.t || "")).join(" ").trim() });
      }
    }
    // dominant body fill (a header band styles a row or two; a highlight
    // convention styles many) — pick the colour covering the most rows,
    // ignoring colours confined to the top 3 lines.
    let best = null;
    for (const [rgb, rowsSet] of Object.entries(fillCount)) {
      const bodyRows = [...rowsSet].filter(r => r > 3);
      if (bodyRows.length >= 3 && (!best || bodyRows.length > best.rows.length)) best = { rgb, rows: bodyRows };
    }
    if (best) {
      for (const r of best.rows) meta.fillRows[r] = true;
      meta.fillColor = best.rgb;
      meta.fillColorName = /^FFFF/i.test(best.rgb) ? "yellow" : /^FF/i.test(best.rgb) ? "red-ish" : `#${best.rgb}`;
    }
    out.push({ name, records, meta, formulaCellRatio: totalCells ? formulaCells / totalCells : 0 });
  }
  return out;
}
