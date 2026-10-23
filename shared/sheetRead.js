// shared/sheetRead.js · IMPORT-3. A NONPROFIT'S FILE IS NEVER WRONG.
//
// One reader for any spreadsheet a small nonprofit keeps: an event night's
// gift sheet with no dates, a vendor export, a QuickBooks report with a title
// and subtotals, two tables side by side, one tab per year. It works out what
// the file is, says what it understood, and asks only what it cannot tell.
//
// Three steps, all pure (no I/O), so the browser and the server walk one plan:
//   1. findTables(grid)       the table wherever it sits: a title above it,
//                             blank rows, margin notes, totals and subtotals,
//                             several tables on a sheet, several sheets.
//   2. mapColumns(table)      each column by its name AND its contents. A
//                             header that says "Amount" over a column of
//                             names is not an amount.
//   3. buildPlan(...)         every row becomes a gift, a pledge, a person, or
//                             a line in "Help me with these" with its reason.
//
// Amounts come from the cells, always. A model may PROPOSE a mapping (the
// server asks one when the AI switch is on); proposeFromModel's answer is
// checked here against every row exactly like a rule's, so a wrong proposal is
// counted, never trusted. A column nobody can place is a question, never a
// silent drop. Nothing here writes; routes/sheetImport.js does, through
// recordGift.
import { normalizeMoney, normalizeDate, resolveDonorIdentity } from "./importShape.js";

// ── vocabularies (declared before every reader, the TDZ rule) ─────────────
const ROLE_LABELS = {
  name: "Full name", first: "First name", last: "Last name", lastFirst: "Name (Last, First)",
  org: "Organization", email: "Email", phone: "Phone", address: "Street address",
  address2: "Address line 2", city: "City", state: "State", zip: "ZIP", amount: "Amount",
  date: "Date given", method: "Payment method", frequency: "How often", paid: "Paid yet? (yes/no)",
  status: "Status", type: "Transaction type", pledgeTotal: "Pledge total (all years)",
  fund: "Fund", campaign: "Campaign or appeal", note: "Note", externalId: "Donor ID (old system)",
  giftId: "Gift or transaction ID", ignore: "Leave out",
};
export const SHEET_ROLES = Object.keys(ROLE_LABELS).map(k => ({ key: k, label: ROLE_LABELS[k] }));

// Headers, normalised to lower-case words. Exact header match only (the
// imports rule: a header is matched whole, never by substring).
const HEADER_ROLES = [
  ["first", ["first", "first name", "firstname", "fname", "given name", "contact first name", "primary contact first name", "donor first name", "contact: first name", "first_name"]],
  ["last", ["last", "last name", "lastname", "lname", "surname", "family name", "contact last name", "primary contact last name", "donor last name", "contact: last name", "last_name"]],
  ["name", ["name", "full name", "donor", "donor name", "contact", "contact name", "constituent", "constituent name", "customer", "customer name", "received from", "from", "giver", "account name", "household name", "supporter", "supporter name", "payer", "donor/organization", "name (full)"]],
  ["org", ["organization", "organisation", "company", "company name", "organization name", "business", "business name"]],
  ["email", ["email", "e-mail", "email address", "e-mail address", "from email address", "contact email", "primary email", "donor email", "email_address", "personal email"]],
  ["phone", ["phone", "phone number", "phone #", "mobile", "cell", "telephone", "home phone", "mobile phone", "primary phone"]],
  ["address", ["address", "street", "address 1", "address1", "address line 1", "mailing address", "street address", "mailing street", "address_1", "addr1", "home street"]],
  ["address2", ["address 2", "address2", "address line 2", "address_2", "apt", "suite"]],
  ["city", ["city", "town", "mailing city", "home city"]],
  ["state", ["state", "st", "province", "state/province", "mailing state/province", "mailing state", "home state", "region"]],
  ["zip", ["zip", "zip code", "zipcode", "postal code", "postcode", "zip/postal code", "mailing zip/postal code", "home zip", "zip_code"]],
  ["amount", ["amount", "gift amount", "donation", "donation amount", "gross", "amount (total)", "gift", "payment amount", "amt", "gift_amount", "total amount", "received amount", "contribution", "amount received", "pledge amount", "gift $", "$"]],
  ["date", ["date", "timestamp", "gift date", "donation date", "close date", "received date", "payment date", "datetime", "transaction date", "deposit date", "date received", "gift_date", "date given", "created at", "donated at"]],
  ["method", ["method", "payment method", "payment type", "pay method", "tender", "paid by", "payment", "pay type", "payment_method", "gift method", "how paid"]],
  ["frequency", ["frequency", "recurring", "recurrence", "interval", "schedule", "how often", "gift frequency"]],
  ["paid", ["completed", "paid", "paid?", "collected", "fulfilled", "received?", "complete", "paid yet"]],
  ["status", ["status", "stage", "payment status", "gift status", "transaction status"]],
  ["type", ["type", "transaction type", "txn type", "gift type"]],
  ["pledgeTotal", ["pledge total", "total pledged", "total pledge", "3 yr total", "3 year total", "three year total", "multi-year total", "commitment", "total commitment"]],
  ["fund", ["fund", "designation", "fund name", "gl code", "fund/designation", "restricted to", "gl_code"]],
  ["campaign", ["campaign", "appeal", "campaign title", "campaign name", "solicit code", "appeal name", "event", "solicit_code"]],
  ["note", ["note", "notes", "memo", "memo/description", "description", "comments", "comment", "message", "dedication", "gift note"]],
  ["externalId", ["donor id", "constituent id", "account number", "account id", "donor_id", "id number", "donor number", "contact id", "supporter id", "account #", "account no"]],
  ["giftId", ["transaction id", "gift id", "receipt", "receipt #", "num", "ref", "reference", "payment id", "id", "receipt number", "check #", "check number", "opportunity id", "gift_id"]],
];
const HEADER_INDEX = new Map();
for (const [role, list] of HEADER_ROLES) for (const h of list) if (!HEADER_INDEX.has(h)) HEADER_INDEX.set(h, role);
// Columns that are deliberately left out, with the reason said out loud.
const IGNORED_HEADERS = new Map([
  ["fee", "a processing fee, not the gift"], ["fees", "a processing fee, not the gift"],
  ["net", "the amount after fees; the gift is the gross"], ["net amount", "the amount after fees; the gift is the gross"],
  ["fee amount", "a processing fee, not the gift"], ["processing fee", "a processing fee, not the gift"],
  ["fee covered", "whether the donor covered the fee"], ["amount (fee)", "a processing fee, not the gift"],
  ["amount (net)", "the amount after fees; the gift is the gross"], ["amount (tip)", "a tip, not the gift"],
  ["time", "the time of day"], ["timezone", "the time zone"], ["time zone", "the time zone"],
  ["currency", "the currency (dollars)"], ["clr", "the bank's cleared mark"],
  ["opportunity name", "a label the old system made from the name and date"],
  ["to", "who received the payment (you)"], ["funding source", "the payer's bank or card"],
  ["destination", "where the money went"], ["beginning balance", "a running balance"],
  ["ending balance", "a running balance"], ["balance", "a running balance"], ["vendor", "a bill paid, not a gift"],
  ["split", "the account it posted to"], ["account", "the account it posted to"],
  ["statement period venmo fees", "a fee"], ["terminal location", "where it was taken"],
  ["year to date", "a running total"], ["to email address", "your own address"], ["amount (tax)", "sales tax, not the gift"],
  ["tax rate", "sales tax, not the gift"], ["tax exempt", "sales tax, not the gift"], ["disclaimer", "the statement's small print"],
  ["year to date venmo fees", "a fee"], ["receipt id", "the processor's receipt"], ["ytd", "a running total"], ["lifetime giving", "a running total from the old system"],
]);
const NUMERIC_TOTAL_RE = /\b(sub-?total|grand total|total|totals|sum)\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const YES = new Set(["yes", "y", "true", "x", "paid", "done", "complete", "completed", "received", "collected", "1", "✓", "✔"]);
const NO = new Set(["no", "n", "false", "unpaid", "not yet", "pending", "0", "open", "outstanding", "pledged", "promised"]);
// Status words, read as stage words (imports rule). Anything not listed is a
// question for a person, never a guess.
const STATUS_PAID = new Set(["completed", "complete", "succeeded", "success", "paid", "closed won", "posted", "received", "settled", "cleared", "approved", "captured", "deposited"]);
const STATUS_PLEDGE = new Set(["pledged", "promised", "open", "outstanding", "committed"]);
const STATUS_ASIDE = new Set(["refunded", "failed", "denied", "declined", "reversed", "canceled", "cancelled", "voided", "void", "pending", "chargeback", "disputed", "closed lost", "partially refunded", "unclaimed", "expired"]);
const TYPE_GIFT = /^(donation|donation payment|payment|deposit|sales receipt|gift|contribution|charge|website payment|express checkout payment|mobile payment|subscription payment|recurring payment|p2p|merchant transaction|credit card|one-time donation|recurring donation|check|cash)$/i;
const TYPE_ASIDE = /(withdrawal|transfer|refund|fee|journal|bill|expense|hold|reversal|invoice|payout|authorization|currency conversion)/i;
const ORG_WORDS = /\b(foundation|fund|inc|incorporated|llc|l\.l\.c|corp|corporation|company|co\.|church|ministries|ministry|trust|bank|association|club|society|school|university|college|council|group|partners|lp|llp|pc|pllc|daf|giving|philanthropies|charitable|rotary|lions|kiwanis|temple|synagogue|parish|diocese|chapel)\b/i;
const TITLE_RE = /^(mr|mrs|ms|miss|mx|dr|rev|fr|sr|jr|the honorable|hon|prof)\.?$/i;
// Payment methods, mapped to Steward's words; anything else is Other with the
// original text kept on the gift.
const METHOD_MAP = [
  [/^(online|web|website|internet|online giving|web form|givebutter|paypal|venmo|stripe|square|zelle|apple pay|google pay|cash app)$/i, "Card", "online"],
  [/^(credit|credit card|cc|card|debit|debit card|visa|mastercard|amex|american express|discover|creditcard|credit_card|card payment)$/i, "Card", null],
  [/^(check|cheque|chk|ck|personal check|business check|cashier'?s check)$/i, "Check", null],
  [/^(cash|currency)$/i, "Cash", null],
  [/^(stock|stock transfer|securities|shares|stock gift|equities)$/i, "Stock", null],
  [/^(investment dist|investment distribution|investment pledge|brokerage)$/i, "Stock", null],
  [/^(retirement dist|retirement distribution|ira|ira distribution|qcd|qualified charitable distribution|ira rollover|rmd)$/i, "Qualified charitable distribution", null],
  [/^(foundation|foundation grant|grant|private foundation)$/i, "Foundation", null],
  [/^(daf|donor advised fund|donor-advised fund)$/i, "DAF", null],
  [/^(ach|eft|bank transfer|wire|direct deposit|bank draft)$/i, "ACH", null],
];
const RECURRING_RE = /^(rec+ur+ing|monthly|recurring monthly|month|every month|sustainer|recurring gift|per month|\/mo|mo)$/i;
const ONCE_RE = /^(once|one[- ]?time|single|one off|one-off|onetime)$/i;
const MULTIYEAR_RE = /^x\s*(\d)\s*(years?|yrs?)$|^(\d)\s*(years?|yrs?)$|^(\d)[- ]year( pledge)?$/i;
const ANNUAL_RE = /^(annual|annually|yearly|every year)$/i;
const QUARTERLY_RE = /^(quarterly|every quarter)$/i;
const DATE_HDR_WORD = /\b(date|datetime|day|when|given on|received on)\b/i;
const MONTH_LABEL_RE = new RegExp(`^(${MONTHS.join("|")})[a-z]*\\.?(\\s+\\d{4})?$`, "i");

// ── small helpers ─────────────────────────────────────────────────────────
const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const hnorm = h => s(h).toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
const isBlank = v => s(v) === "";
const cents = v => Math.round(v * 100);
const fmt$ = c => "$" + (Math.round(c) / 100).toLocaleString("en-US", { minimumFractionDigits: (c % 100) ? 2 : 0, maximumFractionDigits: 2 });
const plural = (n, a, b) => `${n.toLocaleString("en-US")} ${n === 1 ? a : (b || a + "s")}`;

function moneyOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = s(v);
  if (!t) return null;
  // "1.5k", "2K"
  const k = t.match(/^\$?\s*(\d+(?:\.\d+)?)\s*[kK]$/);
  if (k) return Number(k[1]) * 1000;
  t = t.replace(/\s*(usd|dollars)$/i, "");
  const m = normalizeMoney(t);
  return m.value == null ? null : m.value;
}
function looksMoney(v) {
  if (typeof v === "number") return true;
  const t = s(v);
  if (!t) return false;
  if (/^[+-]?\s*\$?\s*\(?[+-]?\$?\s*\d[\d,]*(\.\d{1,2})?\)?\s*(usd)?$/i.test(t)) return true;
  if (/^\$?\d+(\.\d+)?[kK]$/.test(t)) return true;
  return false;
}
function hasCurrencyMark(v) { return /[$€£]|usd/i.test(s(v)); }

// Excel serial day → ISO. 1900 system, with Excel's phantom Feb 29 1900.
function serialToIso(n) {
  if (!(n > 20000 && n < 80000)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
// A date cell → ISO, or null. `ctx.year` fills a missing year ("Oct 22"),
// stepping back a year when that would put the gift in the future.
function dateOf(v, ctx = {}) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") return ctx.serials ? serialToIso(v) : null;
  const t = s(v);
  if (/^\d{5}(\.\d+)?$/.test(t)) return ctx.serials ? serialToIso(Number(t)) : null;
  const md = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/) || null;
  const dm = !md && t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?$/);
  const slash = !md && !dm && t.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md || dm || slash) {
    let mon, day;
    if (slash) { mon = +slash[1]; day = +slash[2]; if (ctx.dayFirst) [mon, day] = [day, mon]; }
    else {
      const word = (md ? md[1] : dm[2]).slice(0, 3).toLowerCase();
      mon = MONTHS.indexOf(word) + 1; day = +(md ? md[2] : dm[1]);
    }
    if (!(mon >= 1 && mon <= 12 && day >= 1 && day <= 31)) return null;
    const today = ctx.today || new Date().toISOString().slice(0, 10);
    let year = ctx.year || +today.slice(0, 4);
    const iso = y => `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!ctx.year && iso(year) > today) year -= 1;
    const check = normalizeDate(iso(year));
    return check.value || null;
  }
  const r = normalizeDate(t, { dayFirst: !!ctx.dayFirst });
  return r.value || null;
}
function looksDate(v, ctx) {
  if (v instanceof Date) return true;
  if (typeof v === "number") return !!(ctx && ctx.serials && serialToIso(v));
  const t = s(v);
  if (!t || /^\d{1,3}$/.test(t)) return false;
  if (/^\$/.test(t)) return false;
  return !!dateOf(t, { ...(ctx || {}), serials: !!(ctx && ctx.serials) });
}
function yesNo(v) {
  const t = s(v).toLowerCase();
  if (!t) return null;
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  return undefined;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const STATE_RE = /^(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|PR|GU|VI)$/i;

// ── 0. any file → grids ───────────────────────────────────────────────────
// One grid per sheet: rows of cells, a cell a string, number, or ISO date
// string (Excel date cells arrive as Dates and leave as "YYYY-MM-DD").
// Merged cells are filled with their value across the merge, so a merged
// title or a merged "Arnold" over two rows reads as the person would read it.
export function gridsFromWorkbook(wb, XLSX) {
  const out = [];
  for (const name of wb.SheetNames || []) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) { out.push({ name, grid: [] }); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true });
    const grid = rows.map(r => (r || []).map(c => (c instanceof Date ? (isNaN(c) ? null : c.toISOString().slice(0, 10)) : c)));
    // a sheet whose used range starts below row 1 or right of column A keeps
    // its real row numbers, so "row 26" is the row she sees in Excel
    const range0 = XLSX.utils.decode_range(ws["!ref"]);
    for (let k = 0; k < range0.s.r; k++) grid.unshift([]);
    if (range0.s.c) for (const r of grid) if (r.length) r.unshift(...new Array(range0.s.c).fill(null));
    // A cell whose number format is a date but that SheetJS left as a number
    // (cellDates off) is a serial; mark it by converting here.
    const range = range0;
    for (let R = range.s.r; R <= range.e.r; R++) for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n" && cell.z && /[dmy]/i.test(String(cell.z)) && !/^[#0.,%$ ]+$/.test(String(cell.z))) {
        const iso = serialToIso(cell.v);
        if (iso && grid[R]) grid[R][C] = iso;
      }
    }
    for (const m of ws["!merges"] || []) {
      const v = grid[m.s.r]?.[m.s.c];
      if (v == null) continue;
      for (let R = m.s.r; R <= m.e.r; R++) for (let C = m.s.c; C <= m.e.c; C++) {
        // a merged title across columns stays one cell (it is a title, not
        // several); a merged value down rows fills each row (it is each row's)
        if (R === m.s.r) continue;
        const row = grid[R] || (grid[R] = []);
        if (row[C] == null) row[C] = v;
      }
    }
    out.push({ name, grid });
  }
  return out;
}

// CSV / TSV / semicolon text → one grid. Quotes honoured; the delimiter is
// the one that splits the most lines into the same number of cells.
export function gridFromText(text) {
  const t = String(text || "").replace(/^﻿/, "");
  const sample = t.split(/\r?\n/).slice(0, 30);
  let best = ",", bestScore = -1;
  for (const d of [",", "\t", ";", "|"]) {
    const counts = sample.map(l => splitLine(l, d).length).filter(n => n > 1);
    if (!counts.length) continue;
    const mode = counts.sort((a, b) => counts.filter(x => x === b).length - counts.filter(x => x === a).length)[0];
    const score = counts.filter(x => x === mode).length * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === best) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => (c === "" ? null : c)));
}
function splitLine(line, d) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"' && cur === "") q = true;
    else if (ch === d) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── 1. find the tables ────────────────────────────────────────────────────
// A table is a header row and the rows under it. Around it: title lines
// above, section labels and totals inside, notes in the margin. Several
// tables side by side are split at a column that is empty from top to bottom
// of the block; several stacked are split where a new header row appears.
function headerScore(row) {
  const cells = row.map(s);
  const filled = cells.filter(Boolean);
  if (filled.length < 2) return 0;
  let known = 0, texty = 0;
  for (const c of filled) {
    const h = hnorm(c);
    if (HEADER_INDEX.has(h) || IGNORED_HEADERS.has(h) || /total|amount|date|name/i.test(h)) known++;
    if (!looksMoney(c) && !looksDate(c, {}) && !EMAIL_RE.test(c) && c.length <= 40) texty++;
  }
  if (texty < filled.length * 0.8) return 0;
  return known * 3 + filled.length;
}

export function findTables(sheetName, grid) {
  const G = (grid || []).map(r => (Array.isArray(r) ? r : []));
  const width = G.reduce((m, r) => Math.max(m, r.length), 0);
  const notes = [];
  // column blocks: split at columns empty for the whole sheet
  const colFilled = [];
  for (let c = 0; c < width; c++) colFilled[c] = G.reduce((n, r) => n + (isBlank(r[c]) ? 0 : 1), 0);
  const blocks = [];
  let start = null;
  for (let c = 0; c <= width; c++) {
    if (c < width && colFilled[c] > 0) { if (start == null) start = c; }
    else if (start != null) { blocks.push([start, c - 1]); start = null; }
  }
  const tables = [];
  for (const [c0, c1] of blocks) {
    const cellCount = colFilled.slice(c0, c1 + 1).reduce((a, b) => a + b, 0);
    // A lone cell or a single sparse column far from everything is a note.
    if (cellCount <= 2 || (c1 === c0 && cellCount < 4)) {
      G.forEach((r, i) => { for (let c = c0; c <= c1; c++) if (!isBlank(r[c])) notes.push({ sheet: sheetName, line: i + 1, col: c, text: s(r[c]) }); });
      continue;
    }
    const sub = G.map(r => r.slice(c0, c1 + 1));
    tables.push(...tablesInBlock(sheetName, sub, c0, notes));
  }
  return { tables, notes };
}

function tablesInBlock(sheetName, rows, c0, notes) {
  const out = [];
  let i = 0;
  const titles = [];
  while (i < rows.length) {
    // find the next header row
    let hi = -1, bestScore = 0;
    for (let j = i; j < Math.min(rows.length, i + 40); j++) {
      const sc = headerScore(rows[j]);
      if (!sc) {
        if (!rows[j].every(isBlank) && hi < 0) continue;
        continue;
      }
      // the row under a header holds data, not another header-like row of words only
      // the next rows hold data (a section label like "Checking" may sit between)
      const next = rows.slice(j + 1, j + 6).find(r => r.filter(c => !isBlank(c)).length >= 2);
      if (!next) continue;
      if (sc > bestScore) { bestScore = sc; hi = j; }
      break;
    }
    if (hi < 0) {
      for (let j = i; j < rows.length; j++) if (!rows[j].every(isBlank)) notes.push({ sheet: sheetName, line: j + 1, col: c0, text: rows[j].map(s).filter(Boolean).join(" ") });
      break;
    }
    for (let j = i; j < hi; j++) if (!rows[j].every(isBlank)) titles.push({ line: j + 1, text: rows[j].map(s).filter(Boolean).join(" ") });
    const header = rows[hi].map(s);
    const width = header.length;
    // trim trailing empty header columns that never carry data
    const body = [];
    let j = hi + 1;
    for (; j < rows.length; j++) {
      const r = rows[j];
      if (r.every(isBlank)) { body.push({ line: j + 1, blank: true, cells: [] }); continue; }
      const cells = r.slice(0, width).map(s);
      // a repeated header (a report that prints its header on every page)
      if (cells.join("|").toLowerCase() === header.join("|").toLowerCase()) { body.push({ line: j + 1, repeatHeader: true, cells }); continue; }
      // a NEW header after a gap of 2+ blank rows starts another stacked table
      const gap = body.length >= 2 && body.slice(-2).every(b => b.blank);
      if (gap && headerScore(r) >= 6 && cells.join("|") !== header.join("|")) break;
      body.push({ line: j + 1, cells, raw: r.slice(0, width) });
    }
    // columns with no header and no data are not columns
    const used = header.map((h, c) => !!h || body.some(b => b.cells && !isBlank(b.cells[c])));
    out.push({ sheet: sheetName, colOffset: c0, headerLine: hi + 1, header, used, body, titles: titles.splice(0) });
    i = j;
  }
  return out;
}

// ── 2. map the columns ────────────────────────────────────────────────────
// Each column gets a role by its header, checked against its contents; a
// header nobody recognises gets a role from its contents alone when the
// contents are unmistakable (emails, money with a $, dates). Otherwise the
// column is a question.
function dataRows(table) { return table.body.filter(b => b.cells && !b.blank && !b.repeatHeader); }

export function profileColumn(table, c, ctx = {}) {
  const vals = dataRows(table).map(b => (b.raw ? b.raw[c] : b.cells[c])).filter(v => !isBlank(v));
  const n = vals.length || 1;
  const frac = f => vals.filter(f).length / n;
  const serials = vals.length > 0 && vals.every(v => /^\d{5}(\.\d+)?$/.test(s(v))) && vals.every(v => serialToIso(Number(s(v))));
  const dayFirst = vals.some(v => { const m = s(v).match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/); return m && +m[1] > 12 && +m[2] <= 12; });
  const lc = vals.map(v => s(v).toLowerCase());
  return {
    count: vals.length,
    sample: [...new Set(vals.map(s))].slice(0, 6),
    money: frac(looksMoney), currency: frac(hasCurrencyMark),
    date: frac(v => looksDate(v, { serials, today: ctx.today })), serials, dayFirst,
    email: frac(v => EMAIL_RE.test(s(v))), phone: frac(v => PHONE_RE.test(s(v))),
    zip: frac(v => ZIP_RE.test(s(v))), state: frac(v => STATE_RE.test(s(v))),
    yesno: frac(v => yesNo(v) !== undefined),
    lastFirst: frac(v => /^[A-Za-z'’ .-]+,\s*[A-Za-z'’ .&-]+$/.test(s(v)) && !ORG_WORDS.test(s(v))),
    method: frac(v => METHOD_MAP.some(([re]) => re.test(s(v))) || /^(unknown|other|pledge)$/i.test(s(v))),
    frequency: frac(v => RECURRING_RE.test(s(v)) || ONCE_RE.test(s(v)) || MULTIYEAR_RE.test(s(v)) || ANNUAL_RE.test(s(v)) || QUARTERLY_RE.test(s(v))),
    status: frac(v => STATUS_PAID.has(s(v).toLowerCase()) || STATUS_PLEDGE.has(s(v).toLowerCase()) || STATUS_ASIDE.has(s(v).toLowerCase())),
    wordy: frac(v => /^[A-Za-z][A-Za-z'’.&, -]*$/.test(s(v))),
    distinct: new Set(lc).size,
  };
}

// A column with no header whose cells are only section labels ("Checking")
// and total lines is the report's left margin, not data.
function labelsOnly(table, c) {
  return dataRows(table).every(b => {
    const v = s(b.cells[c]);
    if (!v) return true;
    return NUMERIC_TOTAL_RE.test(v) || b.cells.filter(x => !isBlank(x)).length === 1 || b.cells.every((x, i) => i === c || isBlank(x) || looksMoney(x));
  });
}

function contentFits(role, p) {
  if (!p.count) return true;
  switch (role) {
    case "amount": case "pledgeTotal": return p.money >= 0.8;
    case "date": return p.date >= 0.8;
    case "email": return p.email >= 0.6;
    case "phone": return p.phone >= 0.6 || p.money < 0.5;
    case "zip": return p.zip >= 0.6 || p.money < 0.5;
    case "paid": return p.yesno >= 0.8;
    case "status": return p.status >= 0.6 || p.yesno >= 0.8;
    case "first": case "last": case "name": case "lastFirst": return p.money < 0.5 && p.email < 0.5;
    default: return true;
  }
}

export function mapColumns(table, opts = {}) {
  const cols = [];
  const taken = new Set();
  const header = table.header;
  for (let c = 0; c < header.length; c++) {
    if (!table.used[c]) continue;
    const h = hnorm(header[c]);
    const p = profileColumn(table, c, opts);
    const col = { index: c, header: header[c], profile: p, role: null, reason: "", by: null };
    if (!p.count) { col.role = "ignore"; col.reason = "the column is empty"; col.by = "rule"; cols.push(col); continue; }
    if (IGNORED_HEADERS.has(h)) { col.role = "ignore"; col.reason = IGNORED_HEADERS.get(h); col.by = "rule"; cols.push(col); continue; }
    if (!h && labelsOnly(table, c)) { col.role = "ignore"; col.reason = "section labels and totals, not a column"; col.by = "rule"; cols.push(col); continue; }
    let role = HEADER_INDEX.get(h) || null;
    if (!role && /(^| )(id|number|no|#)$/.test(h) && p.money < 1.01) role = taken.has("externalId") ? "giftId" : "externalId";
    // a header with "total" and years over a money column is a multi-year total
    if (!role && /\b(\d|three|two|five)\s*(yr|year)s?\b.*total|total.*\b(\d|three)\s*(yr|year)/i.test(h)) role = "pledgeTotal";
    if (!role && /\bamount\b|\bgift\b.*\$|donation/i.test(h) && p.money >= 0.8) role = "amount";
    if (!role && DATE_HDR_WORD.test(h) && p.date >= 0.8) role = "date";
    if (!role && /\bname\b/.test(h) && !/\b(user|campaign|fund|event|opportunity|appeal|page|file|company|employer|team|product|item)\b/.test(h) && p.money < 0.5) role = "name";
    if (!role && /\be-?mail\b/.test(h) && p.email >= 0.6) role = "email";
    if (role === "status" && p.yesno >= 0.8 && p.status < 0.6) role = "paid";
    if (role === "name" && p.lastFirst >= 0.8) role = "lastFirst";
    if (role === "type" && p.method >= 0.8) role = "method";
    if (role && !contentFits(role, p)) { col.mismatch = `the header says ${ROLE_LABELS[role].toLowerCase()}, but the cells do not read that way`; role = null; }
    if (role) { col.by = "header"; col.reason = `the header "${header[c]}"`; }
    // contents alone, only when unmistakable
    if (!role && !col.mismatch) {
      if (p.email >= 0.9) role = "email";
      else if (p.money >= 0.9 && p.currency >= 0.5) role = "amount";
      else if (p.date >= 0.9 && !p.serials) role = "date";
      else if (p.yesno >= 0.95 && p.distinct <= 4 && !isBlank(header[c])) role = null;   // a yes/no we cannot name: ask
      else if (p.lastFirst >= 0.9) role = "lastFirst";
      else if (p.frequency >= 0.9) role = "frequency";
      else if (p.method >= 0.9) role = "method";
      if (role) { col.by = "contents"; col.reason = `the cells read as ${ROLE_LABELS[role].toLowerCase()}`; }
    }
    if (role && taken.has(role) && role !== "note") {
      col.duplicateOf = role; col.role = null;
    } else if (role) { col.role = role; taken.add(role); }
    cols.push(col);
  }
  // A second unclaimed money column next to "Amount" is unknown, not a gift.
  return cols;
}

// Apply a person's (or a model's) overrides: {headerOrIndex: role}. Each is
// checked against the contents; a role that does not fit is refused by name.
export function applyOverrides(cols, overrides = {}) {
  const refused = [];
  if (!overrides || typeof overrides !== "object") return { cols, refused };
  const byKey = k => cols.find(c => String(c.index) === String(k) || c.header === k);
  const next = cols.map(c => ({ ...c }));
  for (const [k, role] of Object.entries(overrides)) {
    const col = next.find(c => String(c.index) === String(k) || c.header === k);
    if (!col || !byKey(k)) continue;
    if (!ROLE_LABELS[role]) { refused.push({ header: col.header, role, reason: "not a place Steward can put a column" }); continue; }
    if (role !== "ignore" && role !== "note" && !contentFits(role, col.profile)) {
      refused.push({ header: col.header, role, reason: `the cells in "${col.header}" do not read as ${ROLE_LABELS[role].toLowerCase()}` });
      continue;
    }
    // the role moves: whoever held it lets go
    if (role !== "ignore" && role !== "note") for (const o of next) if (o !== col && o.role === role) { o.role = null; o.duplicateOf = role; }
    col.role = role; col.by = "person"; col.reason = "you chose it"; col.mismatch = null; col.duplicateOf = null;
  }
  return { cols: next, refused };
}

// ── 3. names ──────────────────────────────────────────────────────────────
// "Suzanna & Walt" + "Arnold" → two people, one household. "Arnold, Suzanna
// & Walt", "Mr. and Mrs. Walt Arnold", "Walt and Suzanna Arnold" too. An
// organisation's name stays whole.
const JOINT_RE = /\s*(?:&|\band\b|\+)\s*/i;
function titleCase(w) { return w && (w === w.toUpperCase() || w === w.toLowerCase()) ? w.replace(/[A-Za-zÀ-ÿ][^\s-]*/g, x => x[0].toUpperCase() + x.slice(1).toLowerCase()) : w; }
function cleanPart(x) { return titleCase(s(x).replace(/^[,.\s]+|[,.\s]+$/g, "")); }

export function readName({ first, last, full, lastFirst, org }) {
  first = s(first); last = s(last); full = s(full || lastFirst); org = s(org);
  if (org && !first && !last && !full) return { kind: "organization", name: org, people: [] };
  if (!first && !last && full) {
    if (ORG_WORDS.test(full) || resolveDonorIdentity({ name: full }).kind === "organisation") return { kind: "organization", name: full, people: [] };
    if (/^anonymous$/i.test(full)) return { kind: "anonymous", name: "Anonymous", people: [] };
    const comma = full.match(/^([^,]+),\s*(.+)$/);
    if (comma) { last = comma[1]; first = comma[2]; }
    else {
      // "Mr. and Mrs. Walt Arnold" / "Walt and Suzanna Arnold" / "Walt Arnold"
      const words = full.split(/\s+/);
      const lastWord = words[words.length - 1];
      const rest = words.slice(0, -1).join(" ");
      if (/^(the )?[A-Za-z'’-]+ family$/i.test(full)) return { kind: "person", name: titleCase(full), people: [{ name: titleCase(full) }] };
      if (JOINT_RE.test(rest)) {
        if (/family$/i.test(full)) return { kind: "person", name: titleCase(full), people: [{ name: titleCase(full) }] };
        first = rest; last = lastWord;
      } else return { kind: "person", name: titleCase(full), people: [{ name: titleCase(full.replace(/^(mr|mrs|ms|dr|rev)\.?\s+/i, "")) }] };
    }
  }
  if (!first && last) {
    if (ORG_WORDS.test(last)) return { kind: "organization", name: last, people: [] };
    return { kind: "person", name: cleanPart(last), people: [{ name: cleanPart(last) }] };
  }
  if (first && !last) return { kind: "person", name: cleanPart(first), people: [{ name: cleanPart(first) }] };
  const L = cleanPart(last);
  const parts = first.split(JOINT_RE).map(cleanPart).filter(Boolean);
  if (parts.length >= 2) {
    // titles only ("Mr. and Mrs. Walt") → one named person and a spouse by title
    const named = [], titled = [], attached = [];
    for (const p of parts) {
      const all = p.split(/\s+/);
      const ws = all.filter(w => !TITLE_RE.test(w));
      if (ws.length) { named.push(ws.join(" ")); attached.push(...all.filter(w => TITLE_RE.test(w))); } else titled.push(p);
    }
    const household = `${parts.join(" & ")} ${L}`;
    if (named.length >= 2) return { kind: "household", name: household, household, people: named.map(n => ({ name: `${n} ${L}` })) };
    if (named.length === 1) {
      const t0 = (attached[0] || titled[0] || "").replace(/\.$/, "");
      return { kind: "household", name: household, household, people: [{ name: `${named[0]} ${L}`, spouse: t0 ? `${titleCase(t0)}. ${L}` : null }] };
    }
  }
  const one = parts[0] || cleanPart(first);
  const clean = one.split(/\s+/).filter(w => !TITLE_RE.test(w)).join(" ") || one;
  return { kind: "person", name: `${clean} ${L}`, people: [{ name: `${clean} ${L}` }] };
}

function methodOf(raw) {
  const t = s(raw);
  if (!t) return { method: "Other", original: "", known: false };
  for (const [re, m, channel] of METHOD_MAP) if (re.test(t)) return { method: m, original: t, known: true, channel };
  return { method: "Other", original: t, known: false };
}
export function frequencyOf(raw) {
  const t = s(raw);
  if (!t) return { kind: "unknown", original: "" };
  if (ONCE_RE.test(t)) return { kind: "once", original: t };
  if (RECURRING_RE.test(t)) return { kind: "monthly", original: t };
  if (ANNUAL_RE.test(t)) return { kind: "annual", original: t };
  if (QUARTERLY_RE.test(t)) return { kind: "quarterly", original: t };
  const m = t.match(MULTIYEAR_RE);
  if (m) return { kind: "multiYear", years: +(m[1] || m[3] || m[5]), original: t };
  return { kind: "unknown", original: t };
}
export function mapMethodWord(raw) { return methodOf(raw); }

// Suggested event name from a file name: "Finding Joy Dinner Gifts.xlsx" →
// "Finding Joy Dinner".
export function eventNameFromFile(fileName) {
  let n = s(fileName).replace(/\.(xlsx|xls|csv|tsv|txt)$/i, "").replace(/[_]+/g, " ");
  n = n.replace(/\b(gifts?|donations?|pledges?|export|final|copy|v\d+|\(\d+\)|list|sheet|results|totals?|scrubbed|tally)\b/gi, " ").replace(/\s+/g, " ").trim();
  return n || null;
}

// ── 4. the plan ───────────────────────────────────────────────────────────
// understand({sheets:[{name, grid}], fileName, today, overrides, answers})
// → everything the review screen shows and everything the write does.
//
// answers: { date: "YYYY-MM-DD", eventName, linkEvent: bool,
//            rows: { "<sheet>:<line>": "gift" | "pledge" | "skip" },
//            columns: { "<tableKey>|<index>": role } }
export function understand({ sheets = [], fileName = "", today, overrides = {}, answers = {} } = {}) {
  const T = today || new Date().toISOString().slice(0, 10);
  const all = [], notes = [];
  for (const sh of sheets) {
    const f = findTables(sh.name, sh.grid || []);
    f.tables.forEach((t, i) => { t.key = `${sh.name}#${i + 1}`; all.push(t); });
    notes.push(...f.notes);
  }
  const tables = all.map(t => {
    const auto = mapColumns(t, { today: T });
    const ov = {};
    for (const [k, v] of Object.entries(overrides || {})) { const [tk, idx] = String(k).split("|"); if (tk === t.key) ov[idx] = v; }
    const { cols, refused } = applyOverrides(auto, ov);
    return { ...t, cols, refused };
  });
  // what each table is
  for (const t of tables) {
    const has = r => t.cols.some(c => c.role === r);
    const named = has("name") || has("first") || has("last") || has("lastFirst") || has("org") || has("email");
    t.kind = named && has("amount") ? "gifts" : named ? "people" : has("amount") ? "summary" : "other";
  }
  const usable = tables.filter(t => t.kind === "gifts" || t.kind === "people");
  const giftTables = usable.filter(t => t.kind === "gifts");
  const fileKind = giftTables.length ? "gifts" : usable.length ? "people" : "unknown";
  const needsDate = giftTables.some(t => !t.cols.some(c => c.role === "date"));
  const dateAnswer = answers.date && /^\d{4}-\d{2}-\d{2}$/.test(answers.date) ? answers.date : null;
  const questions = [];
  const help = [];

  // columns nobody placed → Help me with these
  for (const t of (usable.length ? usable : tables)) for (const c of t.cols) {
    if (c.role && usable.length) continue;
    help.push({ kind: "column", key: `${t.key}|${c.index}`, sheet: t.sheet, header: c.header || `(column ${c.index + 1})`,
                sample: c.profile.sample, reason: c.mismatch || (c.duplicateOf ? `another column is already the ${ROLE_LABELS[c.duplicateOf].toLowerCase()}` : "Steward could not tell what this column is"),
                options: SHEET_ROLES });
  }
  for (const t of tables) if (t.kind === "summary" || t.kind === "other") {
    help.push({ kind: "table", key: t.key, sheet: t.sheet, header: t.header.filter(Boolean).join(", "), line: t.headerLine,
                reason: t.kind === "summary" ? "a table of amounts with no names: read as a summary, not gifts" : "a table with no names and no amounts",
                informational: true });
  }

  const people = new Map();   // key → {key, name, kind, household, people[], email, ..., rows[]}
  const gifts = [], pledges = [], aside = [], totals = [], flags = [];
  const occ = new Map();
  for (const t of usable) {
    const role = r => t.cols.find(c => c.role === r);
    const get = (b, r) => { const c = role(r); return c ? (b.raw ? b.raw[c.index] : b.cells[c.index]) : null; };
    const dateCol = role("date");
    const dctx = dateCol ? { serials: dateCol.profile.serials, dayFirst: dateCol.profile.dayFirst, today: T } : null;
    const nameCols = ["name", "first", "last", "lastFirst", "org", "email"].map(role).filter(Boolean);
    const moneyCols = t.cols.filter(c => c.role === "amount" || c.role === "pledgeTotal");
    let sectionDate = null;
    t.readCount = 0;   // rows that are people or gifts: not titles, labels or totals
    const tableSums = Object.fromEntries(moneyCols.map(c => [c.index, 0]));
    const sinceSubtotal = Object.fromEntries(moneyCols.map(c => [c.index, 0]));
    for (const b of t.body) {
      if (b.blank || b.repeatHeader) continue;
      const cells = b.cells;
      const filled = cells.filter(c => !isBlank(c));
      const nameText = nameCols.map(c => s(cells[c.index])).filter(Boolean).join(" ");
      const anyTotalWord = cells.some((c, i) => NUMERIC_TOTAL_RE.test(s(c)) && !moneyCols.some(m => m.index === i));
      // a section label ("October 2026") or a stray line inside the table
      if (filled.length === 1 && !moneyCols.some(m => !isBlank(cells[m.index]))) {
        const lbl = filled[0];
        if (MONTH_LABEL_RE.test(lbl)) sectionDate = lbl;
        if (!NUMERIC_TOTAL_RE.test(lbl)) { notes.push({ sheet: t.sheet, line: b.line, text: lbl, label: true }); continue; }
      }
      // totals and subtotals: the person-name cells are empty or say total
      const moneyHere = moneyCols.filter(m => moneyOf(b.raw ? b.raw[m.index] : cells[m.index]) != null);
      // A row with no name is a total when it says so, or when it foots: its
      // amount is exactly the sum of the rows above it. Otherwise it is a row
      // with no name (a withdrawal, a stray line) and is listed, not read.
      const amtCol = moneyCols.find(m => m.role === "amount");
      const foots = amtCol && moneyHere.includes(amtCol) && (() => {
        const v = cents(moneyOf(b.raw ? b.raw[amtCol.index] : cells[amtCol.index]));
        return v !== 0 && (v === tableSums[amtCol.index] || v === sinceSubtotal[amtCol.index]);
      })();
      if (moneyHere.length && (anyTotalWord || (!nameText && t.kind === "gifts" && foots))) {
        const isSub = /sub-?total|total for|total\s+\w+/i.test(cells.join(" ")) && !/grand total/i.test(cells.join(" "));
        for (const m of moneyHere) {
          const stated = cents(moneyOf(b.raw ? b.raw[m.index] : cells[m.index]));
          const against = isSub && sinceSubtotal[m.index] ? sinceSubtotal[m.index] : tableSums[m.index];
          totals.push({ sheet: t.sheet, line: b.line, column: t.header[m.index], role: m.role, statedCents: stated, sumCents: against, rowsAbove: t.readCount,
                        matches: stated === against, subtotal: isSub && !!sinceSubtotal[m.index], label: cells.filter(Boolean).filter(x => !looksMoney(x)).join(" ") || "Total" });
          sinceSubtotal[m.index] = 0;
        }
        continue;
      }
      t.readCount++;
      if (!nameText) {
        for (const m of moneyHere) { const v = cents(moneyOf(b.raw ? b.raw[m.index] : cells[m.index])); tableSums[m.index] += v; sinceSubtotal[m.index] += v; }
        const v = amtCol ? moneyOf(b.raw ? b.raw[amtCol.index] : cells[amtCol.index]) : null;
        aside.push({ sheet: t.sheet, line: b.line, reason: "no name, email or organization on this row", cells: filled.slice(0, 6), cents: v != null ? cents(v) : null });
        continue;
      }
      // who
      const who = readName({ first: get(b, "first"), last: get(b, "last"), full: get(b, "name"), lastFirst: get(b, "lastFirst"), org: get(b, "org") });
      const email = s(get(b, "email")).toLowerCase();
      if (!who.name && email) { who.kind = "person"; who.name = email; who.people = [{ name: "" }]; }
      const pkey = email || (who.kind + ":" + who.name.toLowerCase().replace(/[^a-z0-9& ]/g, "").replace(/\s+/g, " "));
      // A person is read when the file gives them something (a gift, a
      // pledge) or the file is a list of people. A refunded line alone does
      // not make somebody a record.
      const fresh = { key: pkey, name: who.name, kind: who.kind, household: who.household || null, people: who.people,
                           email: email || null, phone: s(get(b, "phone")) || null, address: s(get(b, "address")) || null,
                           address2: s(get(b, "address2")) || null, city: s(get(b, "city")) || null, state: s(get(b, "state")) || null,
                           zip: s(get(b, "zip")) || null, externalId: s(get(b, "externalId")) || null, lines: [] };
      const ensure = () => {
        if (!people.has(pkey)) people.set(pkey, fresh);
        const person = people.get(pkey);
        for (const f of ["phone", "address", "address2", "city", "state", "zip", "externalId"]) if (!person[f] && fresh[f]) person[f] = fresh[f];
        person.lines.push(`${t.sheet}:${b.line}`);
      };
      if (t.kind === "people") { ensure(); continue; }

      // how much
      const amtRaw = get(b, "amount");
      const amt = moneyOf(amtRaw);
      for (const m of moneyCols) { const v = moneyOf(b.raw ? b.raw[m.index] : cells[m.index]); if (v != null) { tableSums[m.index] += cents(v); sinceSubtotal[m.index] += cents(v); } }
      if (amt == null) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: isBlank(amtRaw) ? "no amount on this row" : `the amount "${s(amtRaw)}" is not a number` }); continue; }
      if (amt === 0) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: "the amount is $0" }); continue; }
      if (amt < 0) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: `a refund or reversal (${fmt$(cents(amt))}), not a gift`, cents: cents(amt) }); continue; }
      // is it a gift at all (status / type columns)
      const status = s(get(b, "status")).toLowerCase();
      const type = s(get(b, "type"));
      if (type && TYPE_ASIDE.test(type) && !TYPE_GIFT.test(type)) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: `a ${type.toLowerCase()}, not a gift`, cents: cents(amt) }); continue; }
      if (status && STATUS_ASIDE.has(status)) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: `marked "${s(get(b, "status"))}" in your file`, cents: cents(amt) }); continue; }
      // when
      let date = null;
      if (dateCol) {
        const raw = get(b, "date");
        date = dateOf(b.raw ? b.raw[dateCol.index] : raw, { ...dctx, year: answers.year || null });
        if (!date) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: isBlank(raw) ? "no date on this row" : `the date "${s(raw)}" is not a date Steward can read`, cents: cents(amt) }); continue; }
        if (date > T) { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: `dated ${date}, which is after today`, cents: cents(amt) }); continue; }
      } else date = dateAnswer;
      // paid or promised
      const rowKey = `${t.sheet}:${b.line}`;
      const pledgeList = /\bpledge/i.test(hnorm(t.header[(role("amount") || {}).index] || ""));
      let paid = !pledgeList, paidSource = pledgeList ? "file" : "default";
      const paidCol = role("paid");
      if (paidCol) {
        const yn = yesNo(get(b, "paid"));
        if (yn === true) { paid = true; paidSource = "file"; }
        else if (yn === false) { paid = false; paidSource = "file"; }
        else {
          const a = answers.rows && answers.rows[rowKey];
          if (a === "gift") { paid = true; paidSource = "you"; }
          else if (a === "pledge") { paid = false; paidSource = "you"; }
          else if (a === "skip") { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: "you left it out", cents: cents(amt) }); continue; }
          else {
            questions.push({ id: `row:${rowKey}`, kind: "row", key: rowKey, line: b.line, sheet: t.sheet, who: who.name, cents: cents(amt),
                             text: `Row ${b.line}: ${who.name}, ${fmt$(cents(amt))}. "${t.header[paidCol.index]}" is blank. Was it paid?`,
                             options: [{ key: "gift", label: "Paid, a gift" }, { key: "pledge", label: "Not yet, a pledge" }, { key: "skip", label: "Leave it out" }] });
            continue;
          }
        }
      } else if (status) {
        if (STATUS_PLEDGE.has(status)) { paid = false; paidSource = "file"; }
        else if (STATUS_PAID.has(status)) { paid = true; paidSource = "file"; }
        else if (yesNo(status) === false) { paid = false; paidSource = "file"; }
        else if (yesNo(status) !== true) {
          const a = answers.rows && answers.rows[rowKey];
          if (a === "gift") paid = true; else if (a === "pledge") paid = false;
          else if (a === "skip") { aside.push({ sheet: t.sheet, line: b.line, who: who.name, reason: "you left it out", cents: cents(amt) }); continue; }
          else {
            questions.push({ id: `row:${rowKey}`, kind: "row", key: rowKey, line: b.line, sheet: t.sheet, who: who.name, cents: cents(amt),
                             text: `Row ${b.line}: ${who.name}, ${fmt$(cents(amt))}, status "${s(get(b, "status"))}". Was it paid?`,
                             options: [{ key: "gift", label: "Paid, a gift" }, { key: "pledge", label: "Not yet, a pledge" }, { key: "skip", label: "Leave it out" }] });
            continue;
          }
        }
      }
      const methodCol = role("method");
      const m = methodCol ? methodOf(get(b, "method")) : (type && METHOD_MAP.some(([re]) => re.test(type)) ? methodOf(type) : { method: null, original: "", known: false });
      const freq = frequencyOf(get(b, "frequency"));
      const totalCol = role("pledgeTotal");
      const multiTotal = totalCol ? moneyOf(get(b, "pledgeTotal")) : null;
      const noteParts = [];
      if (s(get(b, "note"))) noteParts.push(s(get(b, "note")));
      if (methodCol && !m.known && m.original) noteParts.push(`Method in your file: ${m.original}`);
      if (methodCol && !m.original) noteParts.push("Method in your file: blank");
      if (methodCol && m.known && /pledge|dist/i.test(m.original) && m.original.toLowerCase() !== m.method.toLowerCase()) noteParts.push(`Method in your file: ${m.original}`);
      if (freq.kind === "unknown" && freq.original) noteParts.push(`Frequency in your file: ${freq.original}`);
      // a stable key for this row, so a second import adds nothing
      const sig = [hnorm(t.header.join("|")), who.name.toLowerCase(), email, cents(amt), s(get(b, "method")).toLowerCase(), freq.original.toLowerCase(),
                   s(get(b, "paid")).toLowerCase(), dateCol ? date : "", s(get(b, "giftId"))].join("|");
      const n = (occ.get(sig) || 0) + 1; occ.set(sig, n);
      const rowId = hash(sig + "#" + n);
      const base = { rowId, sheet: t.sheet, line: b.line, personKey: pkey, who: who.name, cents: cents(amt), date,
                     method: m.method || (methodCol ? "Other" : null), methodOriginal: m.original || null,
                     fund: s(get(b, "fund")) || null, campaign: s(get(b, "campaign")) || null, externalId: s(get(b, "giftId")) || null,
                     note: noteParts.join(". ") || null, frequency: freq.kind, frequencyOriginal: freq.original || null };
      ensure();
      if (freq.kind === "monthly") flags.push({ personKey: pkey, who: who.name, flag: "monthly", cents: cents(amt), line: b.line, sheet: t.sheet });
      if (freq.kind === "multiYear" && freq.years > 1) {
        const yearly = cents(amt);
        const total = multiTotal != null && cents(multiTotal) > 0 ? cents(multiTotal) : yearly * freq.years;
        const installments = [];
        let remaining = total;
        for (let k = 0; k < freq.years; k++) {
          const amtK = k === freq.years - 1 ? remaining : Math.min(yearly, remaining);
          remaining -= amtK;
          installments.push({ seq: k + 1, dueDate: date ? addYears(date, k) : null, cents: amtK, paid: k === 0 && paid });
        }
        pledges.push({ ...base, kind: "pledge", pledgeCents: total, years: freq.years, installments, firstPaid: paid,
                       thisYearCents: yearly, dueDate: date, why: `"${freq.original}": ${fmt$(total)} over ${freq.years} years, ${fmt$(yearly)} a year` + (paid ? ", the first year paid" : "") });
        if (paid) gifts.push({ ...base, kind: "installment", installmentOf: rowId });
        continue;
      }
      if (!paid) {
        pledges.push({ ...base, kind: "pledge", pledgeCents: cents(amt), years: 1, thisYearCents: cents(amt),
                       installments: [{ seq: 1, dueDate: date ? yearEnd(date) : null, cents: cents(amt), paid: false }],
                       dueDate: date ? yearEnd(date) : null, why: paidSource === "you" ? "you said not yet paid" : pledgeList && !paidCol ? `"${t.header[role("amount").index]}": a promise, not yet paid` : `"${t.header[(paidCol || {}).index] || "Status"}" says not yet paid` });
        continue;
      }
      gifts.push({ ...base, kind: "gift" });
    }
  }
  // a missing date is one question for the whole file
  if (needsDate && !dateAnswer && (gifts.length || pledges.length)) {
    const suggestion = eventNameFromFile(fileName);
    questions.unshift({ id: "date", kind: "date", text: "When were these given?",
                        hint: "Your file has no date column. Pick the day, or name the event they came from.",
                        suggestedEventName: suggestion, suggestedDate: answers.suggestedDate || null });
  }
  // nothing readable at all is a question too, never "0 donors + 0 gift rows"
  if (!usable.length) {
    questions.push({ id: "nothing", kind: "nothing", text: "Steward could not find names or amounts in this file. Which sheet holds your people or gifts, and which columns are the names and amounts?" });
  }
  // help on columns blocks the import; informational help does not
  for (const h of help) if (!h.informational) questions.push({ id: `col:${h.key}`, kind: "column", ...h });

  const peopleList = [...people.values()];
  const giftCents = gifts.reduce((a, g) => a + g.cents, 0);
  const pledgeCents = pledges.reduce((a, p) => a + p.pledgeCents, 0);
  const pledgeThisYear = pledges.reduce((a, p) => a + p.thisYearCents, 0);
  const paidInstallments = gifts.filter(g => g.kind === "installment").reduce((a, g) => a + g.cents, 0);
  // "raised" in the file's own terms: this year's amount on every row read
  const rowCents = gifts.filter(g => g.kind === "gift").reduce((a, g) => a + g.cents, 0) + pledgeThisYear;
  const ready = questions.filter(q => q.kind !== "info").length === 0;
  const totalsSentence = totals.filter(t => !t.subtotal && t.role === "amount").map(t => t.matches
    ? `Your total row says ${fmt$(t.statedCents)}, and the ${plural(t.rowsAbove, "row")} above it add up to ${fmt$(t.sumCents)}.`
    : `Your total row says ${fmt$(t.statedCents)}, but the rows above it add up to ${fmt$(t.sumCents)}.`);
  return {
    fileKind, ready,
    tables: tables.map(t => ({ key: t.key, sheet: t.sheet, headerLine: t.headerLine, kind: t.kind, titles: t.titles,
      rows: t.readCount != null ? t.readCount : dataRows(t).length,
      columns: t.cols.map(c => ({ index: c.index, header: c.header, role: c.role, roleLabel: c.role ? ROLE_LABELS[c.role] : null, by: c.by, reason: c.reason, sample: c.profile.sample })),
      refused: t.refused })),
    people: peopleList, gifts, pledges, aside, totals, flags, notes, questions, help,
    counts: {
      people: peopleList.reduce((a, p) => a + Math.max(1, p.people.length), 0),
      records: peopleList.length,
      households: peopleList.filter(p => p.household).length,
      organizations: peopleList.filter(p => p.kind === "organization").length,
      gifts: gifts.length, giftCents, pledges: pledges.length, pledgeCents, pledgeThisYearCents: pledgeThisYear,
      paidInstallmentCents: paidInstallments, rowCents, aside: aside.length, monthly: flags.length,
    },
    totalsSentence, needsDate,
  };
}

function addYears(iso, k) {
  const [y, m, d] = iso.split("-").map(Number);
  const dd = (m === 2 && d === 29 && k % 4) ? 28 : d;
  return `${y + k}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function yearEnd(iso) { return `${iso.slice(0, 4)}-12-31`; }
// FNV-1a, 32-bit, twice with different seeds → 16 hex. Stable across Node and browsers.
function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c; h2 = Math.imul(h2, 0x5bd1e995) >>> 0; h2 ^= h2 >>> 13;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

// What a model is shown and what it may answer: the headers and a sample of
// rows, never the whole file, and only a role per column back. Its answer
// goes through applyOverrides like a person's, so a role the cells refute is
// refused there.
export const MAPPING_TOOL = {
  name: "propose_column_roles",
  description: "Propose what each spreadsheet column is. Only columns you are confident about.",
  input_schema: {
    type: "object", additionalProperties: false, required: ["columns"],
    properties: { columns: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "role"],
      properties: { index: { type: "integer" }, role: { type: "string", enum: Object.keys(ROLE_LABELS) } } } } },
  },
};
export function modelPrompt(table) {
  const rows = dataRows(table).slice(0, 8).map(b => b.cells);
  return `A small nonprofit's spreadsheet. Columns (index: header):\n${table.header.map((h, i) => `${i}: ${h || "(no header)"}`).join("\n")}\n\nFirst rows:\n${rows.map(r => r.join(" | ")).join("\n")}\n\nRoles: ${Object.entries(ROLE_LABELS).map(([k, v]) => `${k} (${v})`).join(", ")}.`;
}
export function tablesForModel(sheets) {
  const out = [];
  for (const sh of sheets || []) findTables(sh.name, sh.grid || []).tables.forEach((t, i) => out.push({ key: `${sh.name}#${i + 1}`, table: t }));
  return out;
}

// When the file should be read by this reader rather than the column mapper:
// whenever the mapper would dead-end ("shape unclear", "0 donors + 0 gift
// rows") or misread it. A file with no date column, a paid/pledge/frequency
// column, more than one table on a sheet, or nothing it recognises.
export function wantsAdaptiveReading(sheets, roled = null) {
  if (roled && roled.some(s => s.role === "unknown")) return true;
  if (roled && !roled.some(s => ["donors", "gifts", "pledges", "recurring"].includes(s.role))) return true;
  // a workbook the workbook flow already reads (a donors sheet and a gifts
  // sheet, every sheet with a role) stays there
  if (roled && roled.filter(s => s.rowCount > 0 && s.role !== "chrome").length > 1) return false;
  const u = understand({ sheets });
  if (u.fileKind === "unknown") return true;
  // No date column: an event night's sheet, unless the file is one row per
  // donor with running totals (Total Giving, Last Gift, year columns), which
  // the column mapper reads as an aggregate file.
  const AGG_HDR = /total|lifetime|last gift|ytd|cumulative|\b(19|20)\d\d\b|first gift|largest/i;
  const aggregate = u.tables.some(tb => tb.columns.some(c => c.role !== "pledgeTotal" && AGG_HDR.test(String(c.header || ""))));
  if (u.fileKind === "gifts" && u.needsDate && !aggregate) return true;
  const perSheet = new Map();
  for (const tb of u.tables) if (tb.kind === "gifts" || tb.kind === "people") perSheet.set(tb.sheet, (perSheet.get(tb.sheet) || 0) + 1);
  if ([...perSheet.values()].some(n => n > 1)) return true;
  // what the mapper misreads: a paid/promised column, a multi-year pledge,
  // a pledge list, couples ("Suzanna & Walt"), total and subtotal rows, and
  // dates with no year ("Oct 22")
  if (u.tables.some(tb => tb.columns.some(c => ["paid", "pledgeTotal"].includes(c.role)))) return true;
  if (u.pledges.some(p => p.years > 1) || (u.pledges.length && !u.gifts.length)) return true;
  // couples, when there is no email to tell people apart (an event sheet);
  // subtotals (one TOTAL line the mapper already reads as chrome)
  const hasEmail = u.tables.some(tb => tb.columns.some(c => c.role === "email"));
  if ((u.counts.households > 0 && !hasEmail) || u.totals.filter(x => x.role === "amount").length > 1) return true;
  return u.tables.some(tb => tb.columns.some(c => c.role === "date" && (c.sample || []).some(v => /^[A-Za-z]{3,9}\.?\s+\d{1,2}$/.test(String(v).trim()))));
}
