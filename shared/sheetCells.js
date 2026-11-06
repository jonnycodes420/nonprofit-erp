// shared/sheetCells.js · IMPORT-9. THE READER'S CELL READERS, moved here
// unchanged from shared/sheetRead.js (which had passed its 1,500-line
// ratchet): an amount cell, whether a cell looks like money, and an Excel
// serial day. Pure.
import { normalizeMoney } from "./importShape.js";

const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

export function moneyOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = s(v);
  if (!t) return null;
  // "1.5k", "2K"
  const k = t.match(/^\$?\s*(\d+(?:\.\d+)?)\s*[kK]$/);
  if (k) return Number(k[1]) * 1000;
  t = t.replace(/\s*(usd|dollars)$/i, "").replace(/^(in[- ]?kind|ik)[:\s]+/i, "");
  const m = normalizeMoney(t);
  return m.value == null ? null : m.value;
}
export function looksMoney(v) {
  if (typeof v === "number") return true;
  const t = s(v).replace(/^(in[- ]?kind|ik)[:\s]+/i, "").replace(/^usd\s+/i, "");
  if (!t) return false;
  if (/^[+-]?\s*\$?\s*\(?[+-]?\$?\s*\d[\d,]*(\.\d{1,2})?\)?\s*(usd)?$/i.test(t)) return true;
  if (/^\$?\d+(\.\d+)?[kK]$/.test(t)) return true;
  return false;
}
export function hasCurrencyMark(v) { return /[$€£]|usd/i.test(s(v)); }

// Excel serial day → ISO. 1900 system, with Excel's phantom Feb 29 1900.
export function serialToIso(n) {
  if (!(n > 20000 && n < 80000)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
