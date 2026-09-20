// shared/sourcePresets.js — BUILD-89S 89d. A STATEMENT FILE IS A PRESET ON THE
// MAPPER, NEVER A SECOND IMPORTER.
//
// Cash App and Venmo have no API that reads an account. PayPal has one, but a
// bookkeeper may still have a CSV in hand. For all three the honest product is
// the same sentence: "once a month you drop the statement in and Steward reads
// it."
//
// So there is NO new import path here. A preset is a pre-filled answer to the
// questions the existing mapper already asks: which column is the date, which
// is the amount, which is the transaction id, and which rows are money coming
// in. Choosing "Cash App statement" fills those in and lands on the SAME review
// step as any other file, with the same mapping screen, the same duplicate
// review and the same receipt.
//
// ── THE THING THAT MAKES RE-UPLOADING SAFE ─────────────────────────────────
// Next month's statement overlaps this month's. That is fine because the
// transaction id becomes the gift's external id, which de-duplicates — and it
// is NAMESPACED BY PROVIDER exactly as the API adapters namespace theirs
// (`presetExternalId` and 89a's `externalKey` produce the same string). So a
// PayPal CSV row and the PayPal API reading the same transaction land on ONE
// gift, not two. That is the payoff of having namespaced in the first place.
//
// ── WHAT IS CONFIRMED, AND WHAT IS NOT ─────────────────────────────────────
// 89d's brief asked for one real scrubbed export of each. None were available
// when this was built, so each preset declares its own `confidence`, its
// columns are CANDIDATE SPELLINGS (the same shape as the provider adapters'
// FIELD_MAPs), and `BLOCKED-build89d.md` names the ten-minute walk that
// confirms each one. A preset that turns out to be wrong is a one-line edit to
// the table below, and its suite fails by column name rather than the file
// importing quietly wrong.
//
// Pure: no DB, no network, no clock, no JSX.

import { normalizeHeader, normalizeMoney } from "./importShape.js";

// A statement row is money coming IN, money going OUT, or neither. Only the
// first is a gift, and the reason a row was set aside is always kept so the
// review step can say it out loud.
export const ROW_INCOMING = "incoming";
export const ROW_OUTGOING = "outgoing";
export const ROW_NOT_MONEY = "not_money";

// Movements that are NEVER a gift, whichever way the money went. Matched
// against a whole normalised cell, never as a substring: "Payment" is a gift on
// Venmo, but "Standard Transfer" is the organisation moving its own money
// whether it is leaving PayPal or arriving from the bank.
const NEVER_A_GIFT_TYPE_WORDS = [
  "standard transfer", "instant transfer", "bank transfer", "transfer to bank",
  "withdrawal", "cash out", "payout", "atm withdrawal", "card purchase",
  "purchase", "fee", "merchant fee", "chargeback", "refund sent",
  "general withdrawal", "auto-sweep", "account to account sent",
];
const NOT_MONEY_TYPE_WORDS = [
  "balance", "beginning balance", "ending balance", "statement", "adjustment",
  "hold", "authorization", "pending", "reserve release", "reserve hold",
];

export const SOURCE_PRESETS = {
  // ── PAYPAL ACTIVITY DOWNLOAD ─────────────────────────────────────────────
  // The best-documented of the three. Its columns have been stable for years.
  paypal_csv: {
    key: "paypal_csv",
    label: "PayPal activity download",
    provider: "paypal",
    paymentMethod: "PayPal",
    confidence: "documented",
    help: "In PayPal, open Activity, then Statements, then Custom. Download the range as CSV.",
    // Candidate header spellings per mapper field, most likely first.
    columns: {
      date: ["date", "transaction date"],
      externalId: ["transaction id", "transaction reference id", "txn id"],
      amount: ["gross", "amount", "gross amount"],
      donorName: ["name", "from name", "payer name"],
      donorEmail: ["from email address", "sender email", "email", "payer email"],
      notes: ["item title", "subject", "note", "invoice number"],
      currency: ["currency"],
      fee: ["fee"],
    },
    typeColumn: ["type", "transaction type"],
    statusColumn: ["status"],
    // PayPal marks a completed payment plainly; anything else waits.
    completedStatuses: ["completed", "succeeded", "cleared"],
    required: ["date", "amount", "externalId"],
  },

  // ── VENMO STATEMENT ──────────────────────────────────────────────────────
  // Venmo's CSV carries a preamble row before the header and signs its amounts
  // ("+ $50.00" / "- $20.00"), which `normalizeMoney` already reads. The
  // `Amount (total)` spelling, with the parenthesis, is the distinctive one.
  venmo_csv: {
    key: "venmo_csv",
    label: "Venmo statement",
    provider: "venmo",
    paymentMethod: "Venmo",
    confidence: "reported",
    help: "In Venmo on the web, open Statement, choose the month, and download the CSV.",
    columns: {
      date: ["datetime", "date"],
      externalId: ["id", "transaction id"],
      amount: ["amount (total)", "amount total", "amount"],
      donorName: ["from", "sender", "name"],
      donorEmail: ["from email", "email"],
      notes: ["note", "memo", "description"],
      fee: ["amount (fee)", "amount fee"],
    },
    typeColumn: ["type", "transaction type"],
    statusColumn: ["status"],
    completedStatuses: ["complete", "completed", "settled", "issued"],
    required: ["date", "amount", "externalId"],
  },

  // ── CASH APP STATEMENT ───────────────────────────────────────────────────
  // THE LEAST CONFIRMED OF THE THREE, and the brief said so: sources disagree
  // about whether Cash App exports a CSV at all or only monthly PDF
  // statements. The columns below are the commonly-reported CSV shape. If the
  // real export turns out to be PDF-only, this preset is withdrawn rather than
  // propped up — see BLOCKED-build89d.md. NO PDF PARSER WAS BUILT.
  cashapp_csv: {
    key: "cashapp_csv",
    label: "Cash App statement",
    provider: "cashapp",
    paymentMethod: "Cash App",
    confidence: "unconfirmed",
    help: "In Cash App, open your profile, then Documents, then Account Statements, and export the month as CSV.",
    columns: {
      date: ["date", "transaction date"],
      externalId: ["transaction id", "id", "reference id"],
      amount: ["amount", "net amount", "amount (usd)"],
      donorName: ["name of sender/receiver", "sender", "name", "counterparty"],
      notes: ["notes", "note", "description"],
      fee: ["fee", "fees"],
      currency: ["currency"],
    },
    typeColumn: ["transaction type", "type"],
    statusColumn: ["status"],
    completedStatuses: ["complete", "completed", "settled", "paid"],
    required: ["date", "amount"],
  },
};

export const PRESET_KEYS = Object.keys(SOURCE_PRESETS);
export function presetFor(key) { return SOURCE_PRESETS[key] || null; }

// The same namespaced key 89a's `externalKey` builds, so a statement row and
// the same transaction read through the API are ONE gift. Kept as its own
// function rather than a string built at a call site, because the two halves
// agreeing is the whole mechanism.
export function presetExternalId(presetKey, rawId) {
  const p = presetFor(presetKey);
  const id = String(rawId ?? "").trim();
  if (!p || !id) return null;
  return `${p.provider}:${id}`;
}

function headerIndex(headers = []) {
  const idx = new Map();
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (n && !idx.has(n)) idx.set(n, h);
  }
  return idx;
}
function findColumn(idx, candidates = []) {
  for (const c of candidates) {
    const hit = idx.get(normalizeHeader(c));
    if (hit) return hit;
  }
  return null;
}

// applySourcePreset(key, headers)
//   -> { mapping, constants, matched, missingRequired, unmatchedColumns, ok }
//
// `mapping` is in the EXISTING mapper's vocabulary (autoDetectTxMapping's
// shape), so the review step needs no special case for a statement.
// `constants` carries what is true of every row in the file rather than of a
// column — the payment method, which is the whole reason the bookkeeper's
// export later reads "Venmo" on the row.
export function applySourcePreset(key, headers = []) {
  const p = presetFor(key);
  if (!p) return { ok: false, reason: "unknown_preset" };
  const idx = headerIndex(headers);

  const mapping = {
    donorName: "", firstName: "", lastName: "", orgName: "", donorEmail: "",
    amount: "", date: "", type: "", campaign: "", notes: "", phone: "",
    address: "", city: "", state: "", zip: "", owner: "", externalId: "",
    fund: "", paymentMethod: "", donorType: "",
  };
  const matched = {};
  for (const [field, candidates] of Object.entries(p.columns)) {
    const col = findColumn(idx, candidates);
    if (!col) continue;
    matched[field] = col;
    // `fee` and `currency` have no home in the mapper's vocabulary and are
    // deliberately not forced into one — they are matched so the review step
    // can say the column was recognised rather than listing it as unknown.
    if (field in mapping) mapping[field] = col;
  }

  // THE PAYMENT METHOD IS A FACT ABOUT THE FILE, NOT A COLUMN IN IT. It is
  // never guessed from a row: every row in a Venmo statement came through
  // Venmo, which is exactly why a preset can state it.
  const constants = { paymentMethod: p.paymentMethod };

  const missingRequired = (p.required || []).filter(f => !matched[f]);
  const usedCols = new Set(Object.values(matched));
  for (const c of [p.typeColumn, p.statusColumn]) {
    const col = findColumn(idx, c || []);
    if (col) usedCols.add(col);
  }
  const unmatchedColumns = headers.filter(h => !usedCols.has(h));

  return {
    ok: missingRequired.length === 0,
    preset: p.key, provider: p.provider, label: p.label, confidence: p.confidence,
    mapping, constants, matched, missingRequired, unmatchedColumns,
    typeColumn: findColumn(idx, p.typeColumn || []),
    statusColumn: findColumn(idx, p.statusColumn || []),
  };
}

// detectSourcePreset(headers) -> { key, score, label } | null
//
// Offered, never applied on its own. The mapper's existing "We detected: …"
// banner with a one-tap override is the pattern (BUILD-80), and a statement is
// no different: Steward says what it thinks the file is and a human agrees.
export function detectSourcePreset(headers = []) {
  const idx = headerIndex(headers);
  let best = null;
  for (const p of Object.values(SOURCE_PRESETS)) {
    let score = 0, required = 0;
    for (const [field, candidates] of Object.entries(p.columns)) {
      if (findColumn(idx, candidates)) {
        score++;
        if ((p.required || []).includes(field)) required++;
      }
    }
    // Every REQUIRED column must be present, or it is not that statement.
    if (required < (p.required || []).length) continue;
    if (!best || score > best.score) best = { key: p.key, label: p.label, provider: p.provider, score, confidence: p.confidence };
  }
  return best;
}

// classifyStatementRow(key, row, applied)
//   -> { kind, reason }
//
// A statement is a bank register: money in, money out, and lines that are not
// money at all. ONLY money in becomes a gift.
//
// TWO SIGNALS, and the ORDER matters. The amount's SIGN is the reliable one —
// every one of these providers signs an outgoing amount negative — so it is
// read FIRST and a transaction-type word is only consulted when the sign says
// nothing (a positive row labelled "Standard Transfer" is a transfer IN, and
// reading the word first would drop real money).
export function classifyStatementRow(key, row = {}, applied = null) {
  const p = presetFor(key);
  if (!p) return { kind: ROW_NOT_MONEY, reason: "unknown_preset" };
  const a = applied || applySourcePreset(key, Object.keys(row));

  const rawAmount = a.mapping.amount ? row[a.mapping.amount] : undefined;
  const cents = amountCents(rawAmount);
  if (cents === null) return { kind: ROW_NOT_MONEY, reason: "no readable amount" };

  // A NAMED MOVEMENT THAT IS NEVER A GIFT IS REFUSED WHICHEVER WAY THE MONEY
  // WENT. A "Standard Transfer" is the organisation moving its own money: out
  // of PayPal to the bank, or in from the bank to fund the balance. Both are
  // the same non-event, and a positive one is not a donation just because the
  // number is positive. THEN, and only then, the sign decides — because a row
  // whose type word says nothing useful is judged on the one signal every
  // provider agrees about.
  const typeCell = a.typeColumn ? normalizeHeader(row[a.typeColumn]) : "";
  if (typeCell) {
    if (NOT_MONEY_TYPE_WORDS.includes(typeCell)) return { kind: ROW_NOT_MONEY, reason: typeCell };
    if (NEVER_A_GIFT_TYPE_WORDS.includes(typeCell)) return { kind: ROW_OUTGOING, reason: typeCell };
  }

  if (cents < 0) return { kind: ROW_OUTGOING, reason: "money left the account" };
  if (cents === 0) return { kind: ROW_NOT_MONEY, reason: "a zero line" };

  const statusCell = a.statusColumn ? normalizeHeader(row[a.statusColumn]) : "";
  if (statusCell && (p.completedStatuses || []).length && !p.completedStatuses.includes(statusCell)) {
    return { kind: ROW_NOT_MONEY, reason: `not complete (${statusCell})` };
  }

  return { kind: ROW_INCOMING, reason: "money came in" };
}

// Money off a statement cell, in integer cents, or null. Venmo writes
// "+ $50.00" and "- $20.00"; normalizeMoney already reads a leading sign and
// parenthesised negatives, and this keeps ONE money seam rather than a second
// parser living here.
export function amountCents(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  // normalizeMoney reports { value, warn, blank } — a refusal is a null value
  // with the reason beside it, and a refusal must never become a zero.
  const n = normalizeMoney(raw);
  if (!n || n.value === null || n.value === undefined || Number.isNaN(Number(n.value))) return null;
  return Math.round(Number(n.value) * 100);
}

// The sentence the review step shows when a preset is chosen — one line, in
// the same voice as the rest of the import, naming what was pre-filled and
// what still needs a human.
export function presetSentence(applied) {
  if (!applied?.ok) {
    const missing = (applied?.missingRequired || []).join(", ");
    return `This does not look like a ${applied?.label || "statement"}: ${missing ? `there is no ${missing} column` : "the columns do not match"}. Map it by hand instead.`;
  }
  const n = Object.keys(applied.matched).length;
  const left = applied.unmatchedColumns.length;
  const method = applied.constants.paymentMethod;
  return left
    ? `${n} columns mapped from your ${applied.label}, and every gift will read "${method}". ${left} column${left === 1 ? "" : "s"} had no home and ${left === 1 ? "was" : "were"} left alone.`
    : `${n} columns mapped from your ${applied.label}, and every gift will read "${method}".`;
}
