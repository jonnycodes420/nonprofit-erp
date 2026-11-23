// server/receipts/receiptParts.js · RECEIPTS-1. WHAT A RECEIPT SAYS ABOUT THE DONOR AND THE GIFT.
//
// Jarvis's sweep (22 Nov): "Receipts put the ORG's address in the donor's address block when the
// donor has none on file", and "the in-kind receipt has no FMV line and no deductible-amount line".
// The first was worse than it read: the template never printed a donor address at all. Under the
// donor's name it printed `snapshot.orgAddress`, so EVERY receipt read as if the donor lived at
// the org. The second: an in-kind gift was drawn like cash, an AMOUNT box with a dollar figure the
// org appeared to attest.
//
// Three parts, each frozen into the snapshot at issue time so a later edit never changes an issued
// receipt:
//   donorBlock()  the donor's own mailing address (blank when there is none), never the org's.
//                 The org's legal name, address and EIN live in the header band only.
//   nonCash()     an in-kind or stock gift: the description of the property, shares and ticker,
//                 and no value. For non-cash gifts the charity describes the property and the
//                 donor determines its value (IRS Pub 1771). The org's internal value stays on
//                 the gift for reports, never on the receipt.
//   reissueNumber() the same number with a suffix (2026-00027 → 2026-00027-R1 → -R2).
"use strict";

// The kinds of gift a receipt describes instead of valuing. `gifts.type` keys (shared/giftWords.js).
const NON_CASH = new Set(["in_kind", "in-kind", "in kind", "inkind", "gik", "stock", "securities", "shares"]);
const STOCK = new Set(["stock", "securities", "shares"]);
const isNonCashGift = g => !!g && NON_CASH.has(String(g.type || "").trim().toLowerCase());
const isStockGift = g => !!g && STOCK.has(String(g.type || "").trim().toLowerCase());

// The sentence every non-cash receipt carries, word for word (the brief's).
const NO_VALUE_SENTENCE = "Steward does not state a value for donated property. The donor determines its fair market value.";

// The marker an issued receipt carries once its donor block is the donor's own. A snapshot without
// it, and with an org address, was drawn with the org's address under the donor's name.
const DONOR_BLOCK_KEY = "donorAddress";

let _mailing = null;
async function mailingAddress(d) {
  if (!_mailing) _mailing = (await import("../../shared/mailingAddress.js")).mailingAddress;
  return _mailing(d);
}

// The donor block: the person's (or, on a household statement, the household's) mailing address,
// "" when there is none. `d` is a donors row (address, address2, city, state, zip).
async function donorBlock(d) {
  return { [DONOR_BLOCK_KEY]: d ? await mailingAddress(d) : "" };
}

// The description of property: what she typed for it, else the gift's notes. A stock gift with
// neither is described by its shares and ticker.
function propertyDescription(g) {
  const typed = String((g && g.property_description) || "").trim();
  if (typed) return typed;
  const notes = String((g && g.notes) || "").trim();
  if (notes) return notes;
  if (isStockGift(g)) {
    const s = stockLine(g);
    if (s) return s;
  }
  return "";
}

function stockLine(g) {
  const shares = g && g.stock_shares != null && g.stock_shares !== "" ? Number(g.stock_shares) : null;
  const ticker = String((g && g.stock_ticker) || "").trim().toUpperCase();
  if (!(shares > 0) && !ticker) return "";
  if (shares > 0 && ticker) return `${shares.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${shares === 1 ? "share" : "shares"} of ${ticker}`;
  if (shares > 0) return `${shares.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${shares === 1 ? "share" : "shares"}`;
  return `Shares of ${ticker}`;
}

// What the receipt says about a non-cash gift, or null for money. `null` description means the
// gift cannot be receipted yet (issueGiftReceipt skips it with "no_property_description").
function nonCash(g) {
  if (!isNonCashGift(g)) return null;
  const description = propertyDescription(g);
  return {
    kind: isStockGift(g) ? "stock" : "in_kind",
    description: description || null,
    stock: isStockGift(g) ? (stockLine(g) || null) : null,
    noValueSentence: NO_VALUE_SENTENCE,
  };
}

// The refusal a person reads when an in-kind gift has no description yet.
const NO_DESCRIPTION_MESSAGE = "An in-kind receipt describes the property given, and this gift has no description. Add a Description of property to the gift, then make the receipt.";

// The gift form's three property fields, from a request body (either spelling). `undefined` for a
// field the body does not name, so an edit leaves it as it was.
function propertyFields(body = {}) {
  const pick = (a, b) => body[a] !== undefined ? body[a] : body[b];
  return { propertyDescription: pick("propertyDescription", "property_description"),
           stockShares: pick("stockShares", "stock_shares"), stockTicker: pick("stockTicker", "stock_ticker") };
}
// The three column values an edit writes: what the body says, else what the gift already had.
function propertyValues(f, g) {
  const desc = f.propertyDescription !== undefined ? (String(f.propertyDescription || "").trim().slice(0, 500) || null) : (g.property_description ?? null);
  const shares = f.stockShares !== undefined ? (Number(f.stockShares) > 0 ? Number(f.stockShares) : null) : (g.stock_shares ?? null);
  const ticker = f.stockTicker !== undefined ? (String(f.stockTicker || "").trim().toUpperCase().slice(0, 12) || null) : (g.stock_ticker ?? null);
  return [desc, shares, ticker];
}
// A new in-kind gift says what it was: its Description of property, or its notes.
const IN_KIND_NEEDS_DESCRIPTION = "An in-kind gift needs a Description of property: what was given. The receipt states it, and no value.";
function inKindMissingDescription(type, fields, notes) {
  if (!isNonCashGift({ type }) || isStockGift({ type })) return false;
  return !String(fields.propertyDescription || "").trim() && !String(notes || "").trim();
}

// 2026-00027 → 2026-00027-R1; 2026-00027-R1 → 2026-00027-R2. `taken` is every number already
// on a receipt in the org that starts with the base.
function reissueNumber(number, taken = []) {
  const base = String(number || "").replace(/-R\d+$/, "");
  let n = 0;
  for (const t of taken) {
    const m = String(t || "").match(/-R(\d+)$/);
    if (m && String(t).slice(0, -m[0].length) === base) n = Math.max(n, Number(m[1]));
  }
  return `${base}-R${n + 1}`;
}

// Did this issued receipt's PDF put the org's address in the donor block? (The dry-run script and
// the receipts list read this one rule.)
function orgAddressInDonorBlock(snapshot) {
  const s = typeof snapshot === "string" ? JSON.parse(snapshot) : (snapshot || {});
  return !(DONOR_BLOCK_KEY in s) && String(s.orgAddress || "").trim() !== "";
}
const ORG_ADDRESS_IN_DONOR_BLOCK_SQL = r => `((${r}.snapshot::jsonb -> '${DONOR_BLOCK_KEY}') IS NULL AND COALESCE(BTRIM(${r}.snapshot::jsonb->>'orgAddress'), '') <> '')`;

module.exports = {
  NON_CASH, isNonCashGift, isStockGift, NO_VALUE_SENTENCE, NO_DESCRIPTION_MESSAGE, DONOR_BLOCK_KEY,
  donorBlock, nonCash, propertyDescription, propertyFields, propertyValues, inKindMissingDescription, IN_KIND_NEEDS_DESCRIPTION, stockLine, reissueNumber, orgAddressInDonorBlock, ORG_ADDRESS_IN_DONOR_BLOCK_SQL,
};
