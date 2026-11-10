// shared/auctionSheet.js · ASKS-1 item 3. A GALA'S AUCTION SHEET.
//
// Sarah (CKRH), 10 Nov: "could I send you one more spreadsheet to get uploaded
// with the purchases from our gala auction?" A sheet like hers has a Bidder, an
// Item, the Winning bid (or Amount paid) and, usually, the item's Value (FMV).
// Before this build the reader mapped none of it: Bidder was not a name, and
// Winning bid, Item and FMV were kept as custom fields. No gifts were made.
//
// THE RULE (IRS Publication 1771): an auction purchase is a gift only for what
// was paid OVER the item's fair market value. The whole amount paid is revenue
// (the gift row's amount), and the receipt states the deductible part from
// quid_pro_quo_value, the way a gala ticket's does (COMMS-2, statementTotals.js).
//
// So a row of an auction sheet is a gift of the amount paid, type "auction",
// with quid_pro_quo_value = the item's value and quid_pro_quo_desc = the item.
// A sheet with no value column is ASKED, never assumed: "What were these items
// worth?", answered with a value per item or "treat as $0 (fully deductible)".
//
// Pure: no I/O. shared/sheetRead.js reads it, the browser and the server walk
// one plan, and routes/sheetImport.js writes it through recordGifts.

// The headers an auction sheet uses, matched whole (the imports rule). The
// name and amount ones join sheetRead's own lists for those roles.
export const AUCTION_HEADER_ROLES = [
  ["name", ["bidder", "bidder name", "winning bidder", "winner", "winner name", "buyer", "buyer name", "purchaser", "purchaser name", "high bidder"]],
  ["amount", ["winning bid", "amount paid", "paid amount", "final bid", "high bid", "winning amount", "sale price", "sold for", "purchase price", "price paid", "bid amount"]],
  ["item", ["item", "auction item", "item name", "item title", "item description", "lot", "lot name", "lot title", "package", "package name", "item won"]],
  ["fmv", ["fmv", "fair market value", "value", "item value", "retail value", "estimated value", "est value", "market value", "value received", "fmv value"]],
];
export const AUCTION_ROLE_LABELS = { item: "Auction item", fmv: "Fair market value (auction item)" };

// A value column only means "what the item was worth" on a sheet that names
// items. Anywhere else a "Value" column is kept, as it was before this build.
export function tidyAuctionColumns(cols) {
  if (!cols.some(c => c.role === "fmv") || cols.some(c => c.role === "item")) return cols;
  for (const c of cols) if (c.role === "fmv") { c.role = "keep"; c.by = "rule"; c.reason = `"${c.header}" without an item column is kept as written`; }
  return cols;
}

const itemKey = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();

// One row's auction facts: { item, fmvCents, valueFrom } or null when the row
// names no item. `valueFrom` says where the value came from: "file", "you"
// (her answer, per item) or "zero" (her answer: worth $0, fully deductible).
// A row with an item and no value yet has fmvCents null, which holds Import.
export function auctionFactsOf({ itemRaw, fmvRaw, hasFmvColumn, answers, moneyOf }) {
  const item = String(itemRaw == null ? "" : itemRaw).replace(/\s+/g, " ").trim();
  if (!item) return null;
  if (hasFmvColumn) {
    const v = moneyOf(fmvRaw);
    if (v != null && v >= 0) return { item, fmvCents: Math.round(v * 100), valueFrom: "file" };
  }
  const a = answers || {};
  if (a.auctionValue === "zero") return { item, fmvCents: 0, valueFrom: "zero" };
  const typed = a.auctionValue === "enter" && a.itemValues ? a.itemValues[itemKey(item)] : undefined;
  const v = typed == null || typed === "" ? null : moneyOf(typed);
  return v != null && v >= 0 ? { item, fmvCents: Math.round(v * 100), valueFrom: "you" } : { item, fmvCents: null, valueFrom: null };
}

// The one question, when the file gives no value for an auction row. It holds
// Import until every item has one: a receipt cannot say what is deductible
// without it. Once answered it stays on screen (optional), so she can change it.
export function auctionValueQuestion(gifts, answers) {
  const asked = gifts.filter(g => g.auction && g.auction.valueFrom !== "file");
  if (!asked.length) return null;
  const missing = asked.filter(g => g.auction.fmvCents == null);
  const items = [];
  const seen = new Set();
  for (const g of asked) {
    const k = itemKey(g.auction.item);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ key: k, item: g.auction.item, paidCents: g.cents, line: g.line, sheet: g.sheet, who: g.who });
  }
  const typed = (answers && answers.itemValues) || {};
  return {
    id: "auctionValue", kind: "auctionValue", count: asked.length, missing: missing.length, optional: !missing.length,
    text: "What were these items worth? Without a value, the receipts can't say what's deductible.",
    hint: "An auction purchase is a gift only for what was paid over the item's fair market value. Steward does not guess the value.",
    options: [{ key: "enter", label: "Enter values" }, { key: "zero", label: "Treat as $0 value (fully deductible)" }],
    answer: (answers && answers.auctionValue) || null,
    items: items.map(x => ({ ...x, typed: typed[x.key] != null ? String(typed[x.key]) : "" })),
  };
}

// The key a typed value is stored under, so the browser and the reader agree.
export { itemKey as auctionItemKey };

// "Amount paid $500, value received $200, deductible $300": the one sentence
// for one purchase, for the preview and the import's receipt.
// `deductibleCents` is the rows' own deductibles added up (each never below
// zero), which is not paid minus value when an item was bought under its value.
export function auctionLine(paidCents, fmvCents, deductibleCents = Math.max(0, paidCents - fmvCents)) {
  const f = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return `Amount paid ${f(paidCents)}, value received ${f(fmvCents)}, deductible ${f(deductibleCents)}`;
}
