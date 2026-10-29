// shared/exportShapes.js · IMPORT-5 item 4. OTHER SYSTEMS' EXPORTS READ
// WITHOUT QUESTIONS.
//
// Real customers come from somewhere: a Salesforce Contacts + Donations pair,
// a Bloomerang transactions file, a QuickBooks report. Each is a known shape:
// its own headers, read the way that system means them. The one reader
// (sheetRead.js understand) asks this module which shape a table is, and a
// table that matches has its columns placed from the shape instead of asking.
//
// The rules (imports.md):
//   * A shape claims a table only on TWO of its own signal headers (a value
//     shape, like a Salesforce record id, counts as one). A tie is no answer.
//   * A shape places columns; it never invents money. Every role it gives is
//     still checked against the cells (contentFits in sheetRead), and a role
//     the cells refuse falls back to the reader's own reading.
//   * A person's own answer (an override) still wins over the shape.
//   * Every spelling is from the system's documented common export, not a real
//     customer file: `documented-not-walked`, like the mapper presets
//     (migrationPresets.js, npspPreset.js), which serve the old mapper.
//
// Pure: no DB, no network, no clock, no JSX.

const s = v => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const hnorm = h => s(h).toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

const FEES = "the processor's fee or payout, not the gift: Steward records what the donor gave";
const SF_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

// columns: header → role, or { role, reason, values, skipWhen }.
//   values    a cell's word → the status word the reader knows (a system's own
//             codes: DonorPerfect's record type G/P, eTapestry's entry types)
//   skipWhen  most cells match → skipped with the reason, else `else` (or kept)
export const EXPORT_SHAPES = [
  {
    key: "sf-contacts", system: "Salesforce", part: "Contacts", pairWith: "sf-donations",
    signals: ["contact id", "mailing street", "mailing city", "mailing state/province", "mailing zip/postal code", "account name", "contact owner"],
    idSignal: { header: "contact id", re: /^003/ },
    columns: {
      "contact id": "externalId", "account name": { role: "ignore", skipWhen: /\bhousehold$/i, else: "keep",
        reason: "the household account Salesforce makes for each person; Steward makes households from the people" },
      "contact owner": "keep", "mobile": "phone", "mobile phone": "phone", "mailing country": "keep", "birthdate": "keep",
    },
  },
  {
    key: "sf-donations", system: "Salesforce", part: "Donations",
    signals: ["opportunity id", "opportunity name", "close date", "stage", "primary contact", "primary campaign source", "general accounting unit", "contact id"],
    idSignal: { header: "opportunity id", re: /^006/ },
    columns: {
      "opportunity id": "giftId", "contact id": "externalId", "primary contact": "name", "close date": "date", "stage": "status",
      "general accounting unit": "fund", "primary campaign source": "campaign", "payment method": "method",
      "opportunity name": { role: "ignore", reason: "the name Salesforce writes for each donation (who, \"Donation\", the date), already read from its own columns" },
      "record type": "giftNote", "account name": { role: "ignore", skipWhen: /\bhousehold$/i, else: "keep",
        reason: "the household account Salesforce makes for each person; Steward makes households from the people" },
    },
  },
  {
    key: "bloomerang", system: "Bloomerang", part: "transactions",
    signals: ["account number", "transaction number", "appeal", "email address"],
    columns: { "account number": "externalId", "transaction number": "giftId", "appeal": "giftNote", "method": "method", "type": "type", "fund": "fund", "campaign": "campaign",
      "name": { role: "ignore", reason: "the same person as First Name and Last Name, which Steward reads" } },
  },
  {
    key: "donorperfect", system: "DonorPerfect", part: "gifts",
    signals: ["donor id", "gl code", "solicit code", "sub solicit code", "record type", "gift id"],
    columns: {
      "donor id": "externalId", "gift id": "giftId", "gift date": "date", "amount": "amount", "gl code": "fund", "solicit code": "campaign",
      "sub solicit code": "giftNote", "gift type": "method",
      // DonorPerfect writes G for a gift and P for a pledge
      "record type": { role: "status", values: { g: "received", p: "pledged", m: "received" } },
    },
  },
  {
    key: "lgl", system: "Little Green Light", part: "gifts",
    signals: ["lgl constituent id", "lgl gift id", "constituent name", "gift amount", "payment type"],
    columns: {
      "lgl constituent id": "externalId", "lgl gift id": "giftId", "gift date": "date", "gift amount": "amount", "payment type": "method",
      "gift type": { role: "status", values: { gift: "received", "in-kind": "received", "in kind": "received", pledge: "pledged", "pledge payment": "received" } },
      "appeal": "giftNote", "fund": "fund", "campaign": "campaign",
      "constituent name": { role: "ignore", reason: "the same person as First Name and Last Name, which Steward reads" },
    },
  },
  {
    key: "neon", system: "Neon CRM", part: "donations",
    signals: ["account id", "email 1", "tender type", "donation id", "donation amount", "purpose"],
    columns: { "account id": "externalId", "email 1": "email", "donation id": "giftId", "donation date": "date", "donation amount": "amount",
      "tender type": "method", "campaign name": "campaign", "purpose": "giftNote", "fund": "fund" },
  },
  {
    key: "etapestry", system: "Blackbaud eTapestry", part: "journal",
    signals: ["journal entry date", "journal entry type", "approach", "letter", "received", "account number"],
    columns: {
      "account number": "externalId", "journal entry date": "date", "received": "amount", "fund": "fund", "campaign": "campaign",
      "approach": "giftNote", "letter": "giftNote",
      "journal entry type": { role: "status", values: { gift: "received", payment: "received", "recurring gift": "received", "split gift": "received",
        pledge: "pledged", "recurring gift schedule": "void", note: "void", contact: "void" } },
      "account name": { role: "ignore", reason: "the same person as First Name and Last Name, which Steward reads" },
    },
  },
  {
    key: "raisers-edge", system: "Raiser's Edge", part: "gifts",
    signals: ["constituent id", "key indicator", "fund description", "campaign description", "appeal description", "gift payment type"],
    columns: {
      "constituent id": "externalId", "gift id": "giftId", "gift date": "date", "gift amount": "amount", "gift payment type": "method",
      "fund description": "fund", "campaign description": "campaign", "appeal description": "giftNote",
      "key indicator": { role: "ignore", reason: "Raiser's Edge's I (a person) or O (an organization); Steward reads that from the name" },
      // Raiser's Edge's gift type is what the gift is, not how it was paid
      "gift type": { role: "status", values: { cash: "received", "pay-cash": "received", "recurring gift pay-cash": "received", "stock/property": "received",
        "stock/property (sold)": "received", "gift-in-kind": "received", "other": "received", pledge: "pledged", "mg pledge": "pledged",
        "recurring gift": "void", "write off": "void", "mg write off": "void" } },
    },
  },
  {
    key: "givebutter", system: "Givebutter", part: "transactions",
    signals: ["campaign title", "campaign code", "fund code", "fee covered", "payout"],
    columns: { "transaction id": "giftId", "campaign title": "campaign", "campaign code": "giftNote", "fund code": "fund", "transaction date": "date",
      "fee": { role: "ignore", reason: FEES }, "fee covered": { role: "ignore", reason: FEES }, "payout": { role: "ignore", reason: FEES },
      "method": "method", "status": "status" },
  },
  {
    key: "donorbox", system: "Donorbox", part: "donations",
    signals: ["make donation anonymous", "converted amount", "processing fee", "platform fee", "net amount", "donor first name", "recurring donation"],
    columns: {
      "donor first name": "first", "donor last name": "last", "donor email": "email", "donation date": "date", "amount": "amount",
      "donation type": "method", "designation": "fund", "campaign": "campaign", "comment": "note", "recurring donation": "giftNote", "make donation anonymous": "giftNote",
      "name": { role: "ignore", reason: "the same person as Donor First Name and Donor Last Name, which Steward reads" },
      "converted amount": { role: "ignore", reason: "the amount in another currency; Amount is the gift" },
      "processing fee": { role: "ignore", reason: FEES }, "platform fee": { role: "ignore", reason: FEES }, "total fee": { role: "ignore", reason: FEES },
      "net amount": { role: "ignore", reason: FEES }, "fee covered": { role: "ignore", reason: FEES },
      "currency": { role: "ignore", reason: "the currency, read with the amount" }, "donor's phone": "phone", "phone": "phone",
    },
  },
  {
    key: "ppgf", system: "PayPal Giving Fund", part: "donations",
    signals: ["payout transaction id", "program name", "reference information", "payout date", "donor first name"],
    columns: {
      "donation date": "date", "donor first name": "first", "donor last name": "last", "donor email": "email", "donation amount": "amount", "gross amount": "amount",
      "program name": "giftNote", "reference information": "giftNote", "payout date": "giftNote", "payout transaction id": "giftNote",
      "currency code": { role: "ignore", reason: "the currency, read with the amount" },
    },
  },
  {
    key: "quickbooks", system: "QuickBooks", part: "Sales by Customer",
    signals: ["transaction type", "num", "product/service", "memo/description", "sales price", "balance", "customer"],
    columns: {
      "customer": "name", "date": "date", "transaction type": "type", "num": "giftId", "amount": "amount", "memo/description": "note", "product/service": "giftNote",
      "qty": { role: "ignore", reason: "the quantity on the sales receipt; Amount is the gift" },
      "sales price": { role: "ignore", reason: "the price of one item; Amount is the gift" },
      "balance": { role: "ignore", reason: "a running balance down the report, not a gift" },
    },
  },
];

// Which shape is this table? header: its header row; rows: its data rows'
// cells. Two of a shape's own signals (an id that reads as the system's own
// record id counts as one), and a tie is null.
export function shapeOfTable(header = [], rows = []) {
  const hs = new Set(header.map(hnorm).filter(Boolean));
  const scored = [];
  for (const sh of EXPORT_SHAPES) {
    let score = sh.signals.filter(x => hs.has(x)).length;
    if (sh.idSignal && hs.has(sh.idSignal.header)) {
      const i = header.findIndex(h => hnorm(h) === sh.idSignal.header);
      const vals = rows.map(r => s(r[i])).filter(Boolean);
      if (vals.length && vals.every(v => SF_ID.test(v) && sh.idSignal.re.test(v))) score++;
    }
    if (score >= 2) scored.push({ sh, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null;
  return scored[0].sh;
}

// The column spec a shape gives one header, normalised: { role, reason, values }.
export function shapeColumn(shape, header, cells = []) {
  const spec = shape && shape.columns[hnorm(header)];
  if (!spec) return null;
  if (typeof spec === "string") return { role: spec };
  if (spec.skipWhen) {
    const vals = cells.map(s).filter(Boolean);
    const hit = vals.length && vals.filter(v => spec.skipWhen.test(v)).length >= vals.length * 0.8;
    return hit ? { role: "ignore", reason: spec.reason } : { role: spec.else || "keep" };
  }
  return { role: spec.role, reason: spec.reason || null, values: spec.values || null };
}

// What the preview says when the file is a known shape: "Read as a Salesforce
// Contacts + Donations export". A pair is one sentence.
export function knownShapeSentence(shapes = []) {
  const seen = [];
  for (const sh of shapes) if (sh && !seen.includes(sh)) seen.push(sh);
  if (!seen.length) return null;
  const bySystem = new Map();
  for (const sh of seen) { if (!bySystem.has(sh.system)) bySystem.set(sh.system, []); bySystem.get(sh.system).push(sh.part); }
  const parts = [...bySystem].map(([sys, ps]) => `${/^[AEIOU]/i.test(sys) ? "an" : "a"} ${sys} ${ps.join(" + ")} export`);
  const systems = [...bySystem.keys()];
  return { system: systems.join(" + "), keys: seen.map(x => x.key), parts: seen.map(x => x.part),
           sentence: `Read as ${parts.join(" and ")}.`, confidence: "documented-not-walked" };
}

// QuickBooks's Sales by Customer Detail writes the customer as a row above
// their lines ("Aldous Penhale", then rows with a blank first cell, then
// "Total for Aldous Penhale"). Each line gets its customer, and the blank
// first header reads "Customer". Any other grid comes back unchanged.
export function reshapeKnownGrid(grid = []) {
  const hi = grid.findIndex(r => Array.isArray(r) && !s(r[0]) && ["date", "transaction type", "num", "amount"].every(h => r.some(x => hnorm(x) === h)));
  if (hi < 0) return grid;
  // only when the report names nobody in a column (a Deposit Detail has a
  // Customer column, and its "Checking" above the lines is an account), and a
  // label above the lines is closed by its own "Total for <label>"
  if (grid[hi].some(x => ["customer", "name", "donor", "received from"].includes(hnorm(x)))) return grid;
  const closes = new Set(grid.slice(hi + 1).map(r => (Array.isArray(r) ? s(r[0]) : "")).filter(x => /^total for /i.test(x)).map(x => x.slice(10).toLowerCase()));
  const labels = grid.slice(hi + 1).filter(r => Array.isArray(r) && s(r[0]) && !r.slice(1).some(x => s(x))).map(r => s(r[0]).toLowerCase());
  if (!labels.some(l => closes.has(l)) || labels.some(l => /^(checking|savings|undeposited funds|income|expenses?)$/.test(l))) return grid;
  const out = grid.map(r => (Array.isArray(r) ? r.slice() : r));
  out[hi][0] = "Customer";
  let who = "";
  for (let i = hi + 1; i < out.length; i++) {
    const r = out[i];
    if (!Array.isArray(r)) continue;
    const first = s(r[0]), rest = r.slice(1).filter(x => s(x));
    if (first && !rest.length && !/^total\b/i.test(first)) { who = first; continue; }
    if (/^total for /i.test(first) || /^total$/i.test(first)) { if (/^total$/i.test(first)) who = ""; continue; }
    if (!first && rest.length && who) r[0] = who;
  }
  return out;
}
