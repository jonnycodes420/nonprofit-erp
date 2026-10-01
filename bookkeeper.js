// bookkeeper.js — BUILD-87 Part 4. THE ASSERTION THAT GATES THE FILE.
//
// The bookkeeper's export may not be written unless it foots. This is the one
// place that decides, and it lives outside server.js for the same reason
// money.js and orgTime.js do: the rule has to be provable on a synthetic tree
// containing the exact defect, without a database and without a server.
//
// A GUARD WHOSE NUMBER CANNOT FALL IS NOT MEASURING ANYTHING (BUILD-75 A.6).
// `gifts.amount` is NUMERIC(12,2), so in the live schema the row sum and the
// database sum cannot currently disagree — which means the live path alone
// could never demonstrate this guard working. It is therefore stated as a pure
// function over four inputs and PROVEN able to fire in tests/bookkeeper-
// export.test.js, one synthetic case per refusal. What would make it fire for
// real: a column whose scale is widened, a row dropped or duplicated between
// the two reads, a fund bucket that loses a gift, or a filter that diverges
// between the row query and the total query.
//
// EVERYTHING IS COMPARED IN INTEGER CENTS. `dbCents` may arrive as a
// fractional number — that is the point: Postgres is asked for the sum
// EXACTLY, not pre-rounded to the same two decimals the file uses, because
// rounding it first would make the two sides agree by construction.

function fmtMoney(cents) {
  const n = Number(cents) || 0;
  const neg = n < 0, abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const rest = (abs % 100).toFixed(0).padStart(2, "0");
  return (neg ? "-$" : "$") + whole.toLocaleString("en-US") + "." + rest;
}
const fmtInt = n => Number(n || 0).toLocaleString("en-US");

// rows     — [{cents}] exactly as they will be written, one per gift
// byFund   — [{name, cents}] the trailing section of the same file
// dbCents  — the database's own SUM(amount * 100), unrounded
// dbCount  — the database's own COUNT(*)
// Returns a list of sentences. Empty means the file may be written.
function bookkeeperRefusals(rows, byFund, dbCents, dbCount) {
  const out = [];
  const list = Array.isArray(rows) ? rows : [];
  const funds = Array.isArray(byFund) ? byFund : [];
  const rowCents = list.reduce((s, r) => s + (Number(r && r.cents) || 0), 0);
  const fundCents = funds.reduce((s, f) => s + (Number(f && f.cents) || 0), 0);
  const db = Number(dbCents) || 0;

  if (rowCents !== db)
    out.push(`the ${fmtInt(list.length)} rows total ${fmtMoney(rowCents)} but the database holds ${(db / 100).toFixed(4)} dollars`);
  if (fundCents !== rowCents)
    out.push(`the fund totals come to ${fmtMoney(fundCents)} but the rows come to ${fmtMoney(rowCents)}`);
  if (Number(dbCount) !== list.length)
    out.push(`the database counts ${fmtInt(Number(dbCount) || 0)} gifts but ${fmtInt(list.length)} rows were built`);
  return out;
}

// The sentence the user sees. Nothing is repaired, and the file is not written:
// a bookkeeper's file that does not foot is worse than no file, because it
// will be trusted.
function bookkeeperRefusalMessage(refusals) {
  if (!refusals || !refusals.length) return null;
  return `This export does not foot, so nothing was written: ${refusals.join("; ")}. `
       + `Nobody should reconcile against a file that disagrees with itself.`;
}



// ── THE COLUMNS EACH TOOL WANTS, FOR THE GIFT-DETAIL FILE ─────────────────
// FIN-1 wrote these and FIX-11 Part 3 moved them here from routes/finance.js,
// unchanged, for one reason: the Monthly close screen offered QuickBooks and
// Xero as choices and only routes/finance.js could see them, so the DOWNLOAD
// (which lives in routes/crm.js) could not honour the choice. The three
// buttons were `<span>`s and had never been clickable. Declared ONCE, read by
// both routers and by the screen.
//
// A RESHAPE, not a second export. The same rows through the same route, with
// only the headings and their order changed, which is why the totals cannot
// diverge: nothing here adds anything up. A flavour Steward does not know is
// refused by name rather than falling back to one that looks similar.
//
// The mappings are each vendor's documented import header. Marked
// documented-not-walked, the same honesty the import presets carry: neither
// has been run through a real import by us, and the day one is, this comment
// changes.
const BOOKKEEPER_FLAVOURS = {
  steward: { label: "Steward", confidence: "walked",
    note: "Steward's own columns, one row per gift." },
  quickbooks: { label: "QuickBooks", confidence: "documented-not-walked",
    note: "QuickBooks Online's Sales Receipt import columns. Each gift is one sales receipt.",
    columns: [
      ["SalesReceiptNo", r => r.receiptNumber || r.giftId],
      ["Customer", r => r.donorName],
      ["SalesReceiptDate", r => r.date],
      ["Item(Product/Service)", r => r.fund || "Donations"],
      ["ItemAmount", r => r.amount],
      ["ItemDescription", r => [r.paymentMethod, r.reference].filter(Boolean).join(" ")],
      ["PaymentMethod", r => r.paymentMethod],
      ["Memo", r => r.giftId],
    ] },
  xero: { label: "Xero", confidence: "documented-not-walked",
    note: "Xero's Sales Invoice import columns. Each gift is one paid invoice line.",
    columns: [
      ["*ContactName", r => r.donorName],
      ["*InvoiceNumber", r => r.receiptNumber || r.giftId],
      ["*InvoiceDate", r => r.date],
      ["*DueDate", r => r.date],
      ["*Quantity", () => 1],
      ["*UnitAmount", r => r.amount],
      ["Description", r => [r.fund, r.paymentMethod, r.reference].filter(Boolean).join(" · ")],
      ["TrackingName1", r => (r.fund ? "Fund" : "")],
      ["TrackingOption1", r => r.fund || ""],
      ["Reference", r => r.giftId],
    ] },
};

function giftFlavour(name) {
  const key = String(name || "steward").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BOOKKEEPER_FLAVOURS, key)
    ? { key, ...BOOKKEEPER_FLAVOURS[key] } : null;
}

module.exports = {
  bookkeeperRefusals, bookkeeperRefusalMessage, BOOKKEEPER_FLAVOURS, giftFlavour,
};
