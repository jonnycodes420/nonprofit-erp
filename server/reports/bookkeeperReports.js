// server/reports/bookkeeperReports.js — the bookkeeper's and the deposits reports.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

function mount(ctx) {
const {
  money,
} = ctx;

// CSV with proper quoting + formula-injection guard: a leading = + - or @ in
// a TEXT cell gets a ' prefix so Excel/Sheets treat it as literal text, not
// a formula (numbers pass through untouched — a negative total isn't an
// injection). These exports land in real spreadsheets at real orgs.
// ── BUILD-87 PART 4 — THE BOOKKEEPER'S EXPORT ──────────────────────────────
// One row per gift, for the person who reconciles the bank. The column list is
// FIXED and in this order; nothing else goes in it. No custom fields, no
// notes — a bookkeeper's file is not a CRM dump, and every extra column is
// another thing they have to decide whether to ignore.
//
// SOFT CREDITS AND MATCHED-GIFT RELATIONSHIPS ARE EXCLUDED ON PURPOSE. The
// bookkeeper reconciles MONEY THAT ARRIVED, and a soft credit is not money —
// it is an attribution. Structurally they cannot appear: those live in
// `donor_relationships`, and this query reads `gifts`. The one way one could
// leak in is a human typing "soft credit" into a gift's type, so that is
// refused by name too. The DAF GRANT ITSELF is money that arrived and stays.
//
// It is a READ path on the BUILD-79 report/file layer — `/reports/:key`,
// `reportToCsv`, `sendReportCsv`. There is no second export path.

// The fixed columns, in the fixed order, declared ONCE so the screen and the
// file cannot disagree about either.
const BOOKKEEPER_COLUMNS = [
  { key: "date", label: "Gift date" },
  { key: "donorName", label: "Donor" },
  { key: "donorId", label: "Donor ID" },
  { key: "amount", label: "Amount", money: true },
  // FIX-11 Part 3 — THE FOUR COLUMNS A BOOKKEEPER COULD NOT RECONCILE
  // WITHOUT. Jonathan's August file had the gross and nothing else: no fee,
  // so its total could never equal what reached the bank; no net, so he had
  // to work it out per row; nothing naming the deposit a gift arrived in, so
  // tying rows to a bank line meant adding gifts up by hand; and stock and
  // in-kind gifts mixed in with cash, which are revenue and are not a deposit.
  { key: "fee", label: "Processing fee", money: true },
  { key: "net", label: "Net", money: true },
  { key: "deposit", label: "Deposit" },
  { key: "depositedOn", label: "Deposited on" },
  { key: "cashOrNot", label: "Cash or non-cash" },
  { key: "fund", label: "Fund or designation" },
  { key: "paymentMethod", label: "Payment method" },
  // The cheque number is its own column now. It used to be absent from the
  // schema altogether: the deposit sheet wrote it into the gift's NOTES, and
  // this file reads `reference`, which is an external or Stripe id. 0 of 51
  // cheques in the August file carried a number.
  { key: "checkNumber", label: "Check number" },
  { key: "reference", label: "Reference" },
  { key: "pledgePayment", label: "Pledge payment" },
  { key: "recurring", label: "Recurring" },
  { key: "receiptNumber", label: "Receipt number" },
  { key: "giftId", label: "Steward gift ID" },
];

// Dollars from the database, as INTEGER CENTS, through the one money seam.
// Nothing here ever adds two floats.
const bkCents = v => money.toCents(v) ?? 0;
const bkDollars = c => (c / 100).toFixed(2);
return { BOOKKEEPER_COLUMNS, bkCents, bkDollars };
}

module.exports = { mount };
