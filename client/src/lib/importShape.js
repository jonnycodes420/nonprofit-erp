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
export function normalizeDate(val) {
  if (val === null || val === undefined || val === "") return { value: null, warn: null };
  if (val instanceof Date) {
    return isNaN(val) ? { value: null, warn: "invalid date" } : { value: val.toISOString().split("T")[0], warn: null };
  }
  const s = String(val).trim();
  if (!s) return { value: null, warn: null };
  // Excel serial (5-digit number > 25569 = 1970-01-01)
  if (/^\d{5}$/.test(s)) {
    const n = parseInt(s);
    if (n > 25569 && n < 60000) {
      const d = new Date((n - 25569) * 86400000);
      if (!isNaN(d)) return { value: d.toISOString().split("T")[0], warn: null };
    }
  }
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T12:00:00Z");
    if (!isNaN(d)) return { value: s, warn: null };
  }
  // MM/DD/YYYY or M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const iso = `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
    const d = new Date(iso + "T12:00:00Z");
    if (!isNaN(d)) return { value: iso, warn: null };
  }
  // YYYY/MM/DD
  const ymd = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const d = new Date(iso + "T12:00:00Z");
    if (!isNaN(d)) return { value: iso, warn: null };
  }
  // "Jan 2023" / "January 2023"
  const monYear = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monYear) {
    const d = new Date(`${monYear[1]} 1, ${monYear[2]}`);
    if (!isNaN(d)) return { value: d.toISOString().split("T")[0], warn: null };
  }
  // Native parse as last resort (guard against bare 4-digit years)
  if (!/^\d{4}$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d) && d.getFullYear() > 1900 && d.getFullYear() < 2100)
      return { value: d.toISOString().split("T")[0], warn: null };
  }
  return { value: null, warn: `couldn't parse date '${s}'` };
}

export function normalizeMoney(val) {
  if (val === null || val === undefined || val === "") return { value: null, warn: null };
  if (typeof val === "number" && !isNaN(val)) return { value: val, warn: null };
  const s = String(val).trim();
  if (!s) return { value: null, warn: null };
  // Accounting-style negatives: "(1,000)" = -1000 (refund/adjustment rows —
  // recognized so the row REPORT can say "refund", never silently vanish).
  const paren = s.match(/^\((.+)\)$/);
  const core = paren ? paren[1] : s;
  const n = parseFloat(core.replace(/[$,\s]/g, ""));
  if (isNaN(n)) return { value: null, warn: `couldn't parse amount '${s}'` };
  return { value: paren ? -n : n, warn: null };
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
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) start = 3;
  const body = start ? buf.subarray(start) : buf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
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
  const report = { giftRows: rows.length, builtGifts: 0, negativeRows: 0, unparsableAmountRows: 0, zeroAmountRows: 0, noAmountColumn: !tx.amount };
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
          const { value: parsedDate } = normalizeDate(tx.date ? row[tx.date] : "");
          gift = {
            amount: amt,
            date: parsedDate || new Date().toISOString().split("T")[0],
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
      for (const k of ["email", "phone", "city", "state", "notes", "owner"]) {
        if ((canon[k] == null || canon[k] === "") && donor[k]) canon[k] = donor[k];
      }
    }
    if (gift) gifts.push({ ...gift, donorIndex: di });
  }
  return { donors, gifts };
}
