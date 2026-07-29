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
