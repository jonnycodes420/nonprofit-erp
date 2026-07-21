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

const numlike = v => {
  if (v === null || v === undefined || v === "") return false;
  return !isNaN(parseFloat(String(v).replace(/[$,\s]/g, "")));
};

// Column-role probes on header text (deliberately loose — a human can override).
const isDateHdr   = h => /\b(date|when)\b|gift ?date|donation ?date/i.test(String(h)) && !YEAR_HDR_PAT.test(String(h).replace(/date/ig, ""));
const isAmountHdr = h => {
  const s = String(h).trim();
  if (YEAR_HDR_PAT.test(s)) return false;
  return /^(amount|gift ?amount|donation ?amount|gift|giving|donation|sum|contribution|paid)\b/i.test(s);
};
const isTotalHdr  = h => /^total$/i.test(String(h).trim()) || /(total|lifetime|cumulative)\s*(giv|donat|amount|contrib|raised)/i.test(String(h));
const isNameHdr   = h => /^(name|full ?name|donor ?name|donor|contact|constituent)$/i.test(String(h).trim());
const isEmailHdr  = h => /^(email|email ?address|e-?mail)$/i.test(String(h).trim());

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

  let shape;
  if (yearCols.length >= 2 && !hasDateCol) shape = "wide";
  else if (hasAmountCol && hasDateCol && !hasTotalCol) shape = "transaction";
  else if (hasAmountCol && hasDateCol && donorRepeats) shape = "transaction";
  else if (yearCols.length >= 2) shape = "wide";
  else shape = "aggregate";

  return { shape, yearCols, hasDateCol, hasAmountCol, hasTotalCol, donorRepeats, distinctDonors, keyedRows, nameCol: nameCol || "", emailCol: emailCol || "" };
}

// A short, honest one-line description for the detection banner.
export function shapeLabel(shape) {
  if (shape === "transaction") return "individual gifts — we'll build donors + their giving history";
  if (shape === "wide")        return "year-column giving — we'll build donors + a gift per year";
  return "one row per donor — we'll import donors and their totals";
}

// groupTransactions(items) — the core "group a raw gift ledger by donor" step.
// items: [{ key, donor, gift }]  (key = dedup key, gift may be null).
// The FIRST occurrence of a key defines the canonical donor; later rows only
// fill in blank scalar fields (never overwrite a non-blank value). Every
// non-null gift becomes a gift row carrying its donor's index in `donors` —
// exactly the { donors, gifts:[{donorIndex}] } shape /donors/import-combined
// consumes, so the server dedupes, attaches, recalcs, and re-infers stage.
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
      for (const k of ["email", "phone", "city", "state", "notes"]) {
        if ((canon[k] == null || canon[k] === "") && donor[k]) canon[k] = donor[k];
      }
    }
    if (gift) gifts.push({ ...gift, donorIndex: di });
  }
  return { donors, gifts };
}
