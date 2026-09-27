// FIX-2 B — a report reads like a report, not a spreadsheet dump.
//
// One place that turns a report cell into what a person reads: dates through
// shared/displayDate.js ("Nov 15, 2024", never "2024-11-15"), money through
// fmtFull (whole dollars unless the value has cents, then cents), counts with
// separators. Exports never come through here: the CSV and PDF keep ISO dates
// and full values, because a machine reads those.
//
// The totals row is the sum of the rows IN INTEGER CENTS, so it foots to the
// rows above it by construction — $0.10 + $0.20 is 30 cents, not 0.30000000000000004.
//
// Pure: no JSX, no clock, no network.
import { displayDate, displayMonth } from "../../../shared/displayDate.js";
import { fmtFull } from "./money.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const centsOf = v => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// `type` is the column's kind: money, date, month, number/count, pct, bool, text.
export function cellText(v, type) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money") {
    const n = Number(v);
    return Number.isFinite(n) ? fmtFull(centsOf(n) / 100) : String(v);
  }
  if (type === "date") return displayDate(v) || String(v);
  if (type === "month") return displayMonth(v) || String(v);
  if (type === "number" || type === "count") {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(v);
  }
  if (type === "pct") return `${v}%`;
  if (type === "bool") return v ? "Yes" : "No";
  // A text cell that is a date (a handler report's CSV shaping) reads as one.
  const s = String(v);
  if (ISO_DAY.test(s)) return displayDate(s) || s;
  return s;
}

// The foot of a column: the sum of the rows in integer cents.
export const footCents = (rows, get) => rows.reduce((s, r) => s + centsOf(get(r)), 0);
// A count column's foot: a plain integer sum.
export const footCount = (rows, get) => rows.reduce((s, r) => s + (Number.isFinite(Number(get(r))) ? Math.round(Number(get(r))) : 0), 0);

// Sort value for a raw cell: numbers as numbers, money as cents, ISO as text
// (ISO sorts correctly as text), blanks last.
export function sortValue(v, type) {
  if (v === null || v === undefined || v === "") return null;
  if (type === "money") return centsOf(v);
  if (type === "number" || type === "count" || type === "pct") { const n = Number(v); return Number.isFinite(n) ? n : String(v); }
  return typeof v === "number" ? v : String(v);
}

// The next sort after a header click: descending, then ascending, then none.
export const nextSort = (cur, key) =>
  cur?.key === key ? (cur.dir === "desc" ? { key, dir: "asc" } : null) : { key, dir: "desc" };

export function sortRows(rows, sort, valueOf) {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, sort.key), vb = valueOf(b, sort.key);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

// A handler report's CSV shaping puts its own TOTAL row (and blank spacer
// rows) among the rows. On screen the foot is computed from the rows, so
// those are set aside: returns { rows, serverTotal }.
export function splitHandlerRows(rows, firstKey) {
  const out = [];
  let serverTotal = null;
  for (const r of rows) {
    const first = r[firstKey];
    const blank = Object.values(r).every(v => v === "" || v === null || v === undefined);
    if (blank) continue;
    if (first === "TOTAL") { serverTotal = r; continue; }
    out.push(r);
  }
  return { rows: out, serverTotal };
}
