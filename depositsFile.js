// depositsFile.js — FIX-11 Part 3. THE FILE A BOOKKEEPER IMPORTS.
//
// Jonathan exported bookkeeper-2026-08.csv on 30 September. The arithmetic was
// right — 243 gifts, $240,853.00, the fund totals footed — and a bookkeeper
// still could not use it:
//
//   · it is one row per GIFT, and a bank statement has one line per DEPOSIT.
//     Nothing in the file tied the gifts to the payout they arrived in, so
//     reconciling meant adding up gifts by hand until they matched a line.
//   · it carried no processing fees and no net. Twenty-six card gifts,
//     $11,478, and no fee line — so the file's total could never equal what
//     reached the bank.
//   · stock and in-kind gifts sat in the same list as cash. Fifty-five stock
//     gifts ($54,806) and thirty in-kind ($33,286) are revenue, and they are
//     not a deposit; putting them in one would make the deposit wrong.
//
// THIS MODULE IS THE PURE HALF: grouping, the fee line, the net, and the
// assertion that the file foots. No database, no Express, no formatting of
// anybody's vendor columns. It is a pure function over rows for the same
// reason bookkeeper.js is: the refusal has to be provable on a synthetic tree
// containing the exact defect, with no server running.
//
// EVERYTHING IS INTEGER CENTS. Nothing here adds two floats.
//
// It lives at the ROOT rather than in shared/ for the same reason
// bookkeeper.js and money.js do: shared/ is ESM and this is required
// synchronously by a route that is not async at the point it needs it.

// ── WHAT IS NOT CASH ──────────────────────────────────────────────────────
// A deposit is money that reached a bank account. Stock is sold by a broker
// and in-kind never becomes money at all; both are revenue a bookkeeper
// records, and neither belongs in a bank deposit. Matched on the gift's type,
// lower-cased, so "Stock", "stock" and "STOCK" are one case.
const NON_CASH_TYPES = new Set([
  "stock", "securities", "shares", "in kind", "in-kind", "in_kind", "inkind",
  "gift in kind", "gik", "crypto", "cryptocurrency", "property", "vehicle",
]);

function isNonCash(row) {
  return NON_CASH_TYPES.has(String((row && row.type) || "").trim().toLowerCase());
}

// A gift Steward could not tie to a deposit is not dropped and not guessed at.
// It is grouped by the day it was recorded under a reference that says so, so
// the file still accounts for every penny and says which pennies it cannot
// place. Silence here would be money going missing from a reconciliation.
const UNMATCHED_REF = "not matched to a deposit";

function depositKey(row) {
  const on = String((row && (row.depositedOn || row.deposited_on)) || "").slice(0, 10)
    || String((row && row.date) || "").slice(0, 10);
  const ref = String((row && (row.depositRef || row.deposit_ref)) || "").trim() || UNMATCHED_REF;
  return on + "|" + ref;
}

// ── THE GROUPS ────────────────────────────────────────────────────────────
// One group per deposit. Inside it, one line per fund (the income account the
// money is credited to), then ONE negative fee line, then the net — which is
// the number that has to equal the line on the bank statement.
//
// rows: [{ cents, feeCents, type, fund, paymentMethod, date, depositedOn,
//          depositRef, depositAccount }]
function depositGroups(rows = []) {
  const cash = [], nonCash = [];
  for (const r of rows) (isNonCash(r) ? nonCash : cash).push(r);

  const byKey = new Map();
  for (const r of cash) {
    const k = depositKey(r);
    if (!byKey.has(k)) {
      byKey.set(k, {
        key: k,
        depositedOn: k.split("|")[0],
        ref: k.split("|").slice(1).join("|"),
        account: String(r.depositAccount || "").trim() || null,
        matched: (k.split("|").slice(1).join("|")) !== UNMATCHED_REF,
        byFund: new Map(),
        grossCents: 0, feeCents: 0, giftCount: 0,
        methods: new Set(),
      });
    }
    const g = byKey.get(k);
    const fund = String(r.fund || "").trim() || "(no fund)";
    const cents = Math.round(Number(r.cents) || 0);
    const fee = Math.round(Number(r.feeCents) || 0);
    g.byFund.set(fund, (g.byFund.get(fund) || 0) + cents);
    g.grossCents += cents;
    g.feeCents += fee;
    g.giftCount += 1;
    if (r.paymentMethod) g.methods.add(String(r.paymentMethod));
    if (!g.account && r.depositAccount) g.account = String(r.depositAccount);
  }

  const groups = [...byKey.values()]
    .sort((a, b) => (a.depositedOn < b.depositedOn ? -1 : a.depositedOn > b.depositedOn ? 1
      : String(a.ref).localeCompare(String(b.ref))))
    .map(g => ({
      key: g.key,
      depositedOn: g.depositedOn,
      ref: g.ref,
      matched: g.matched,
      account: g.account,
      giftCount: g.giftCount,
      methods: [...g.methods].sort(),
      lines: [...g.byFund.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([fund, cents]) => ({ fund, cents })),
      grossCents: g.grossCents,
      feeCents: g.feeCents,
      // NET IS GROSS MINUS FEES, and it is what hit the bank. A positive fee
      // is written as a NEGATIVE line, because that is what it does to the
      // deposit and because a bookkeeper importing a positive fee books
      // income twice.
      netCents: g.grossCents - g.feeCents,
    }));

  return {
    groups,
    nonCash: nonCash.map(r => ({
      date: String(r.date || "").slice(0, 10),
      donorName: r.donorName || "",
      type: String(r.type || ""),
      description: r.description || r.notes || "",
      cents: Math.round(Number(r.cents) || 0),
      fund: String(r.fund || "").trim() || "(no fund)",
    })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    grossCents: groups_total(groups, "grossCents"),
    feeCents: groups_total(groups, "feeCents"),
    netCents: groups_total(groups, "netCents"),
    nonCashCents: nonCash.reduce((s, r) => s + Math.round(Number(r.cents) || 0), 0),
    unmatchedCents: groups.filter(g => !g.matched).reduce((s, g) => s + g.grossCents, 0),
  };
}

function groups_total(groups, key) {
  return groups.reduce((s, g) => s + (Number(g[key]) || 0), 0);
}

// MONEY IN THIS FILE IS TWO DECIMALS, ALWAYS.
//
// A fee line is negative, and the CSV writer's formula-injection guard used to
// prefix ANY text cell starting with "-" with an apostrophe, so `-3.68` went
// out as `'-3.68` and QuickBooks read it as text. The guard is the thing that
// was wrong — "-3.68" is a number — and it was narrowed
// (reportCsvCell/CSV_PLAIN_NUMBER). Dropping to a JS number here would have
// worked too, and would have written "-8.3" into a money column.
//
// Found by adding the file's own Amount column up and getting NaN, which is
// the cheapest possible check and the one the suite now makes.
const amt = cents => (Number(cents) / 100).toFixed(2);

function fmtMoney(cents) {
  const n = Number(cents) || 0;
  const neg = n < 0, abs = Math.abs(n);
  return (neg ? "-$" : "$") + Math.floor(abs / 100).toLocaleString("en-US") + "." + String(abs % 100).padStart(2, "0");
}

// ── THE ASSERTION THAT GATES THE FILE ─────────────────────────────────────
// Same bar as bookkeeper.js: the deposits file may not be written unless it
// foots. Stated over the numbers rather than trusted to the grouping, and
// proven able to fire on a synthetic tree.
//
// WHAT IT CHECKS, and why each one would otherwise be invisible:
//   1. every group's lines add up to its gross — a fund bucket that lost a
//      gift leaves the group's own arithmetic wrong
//   2. every group's net is exactly gross minus fees — the one number the
//      bank statement is compared against
//   3. the file's gross plus its non-cash equals the gross Steward was asked
//      for — a gift that fell out of both lists would otherwise be silent
//   4. no non-cash gift is inside a deposit
function depositsRefusals(built, expectedCashCents, expectedNonCashCents) {
  const out = [];
  for (const g of built.groups) {
    const lineSum = g.lines.reduce((s, l) => s + l.cents, 0);
    if (lineSum !== g.grossCents) {
      out.push(`${g.ref} on ${g.depositedOn}: the fund lines add up to ${fmtMoney(lineSum)} and the deposit is ${fmtMoney(g.grossCents)}.`);
    }
    if (g.netCents !== g.grossCents - g.feeCents) {
      out.push(`${g.ref} on ${g.depositedOn}: the net is ${fmtMoney(g.netCents)} and gross minus fees is ${fmtMoney(g.grossCents - g.feeCents)}.`);
    }
  }
  if (expectedCashCents !== undefined && built.grossCents !== Math.round(Number(expectedCashCents) || 0)) {
    out.push(`The deposits add up to ${fmtMoney(built.grossCents)} and the cash gifts for this month add up to ${fmtMoney(expectedCashCents)}.`);
  }
  if (expectedNonCashCents !== undefined && built.nonCashCents !== Math.round(Number(expectedNonCashCents) || 0)) {
    out.push(`The non-cash gifts add up to ${fmtMoney(built.nonCashCents)} and should add up to ${fmtMoney(expectedNonCashCents)}.`);
  }
  for (const g of built.groups) {
    // Belt and braces: the grouping already filters non-cash out, so this can
    // only fire if somebody changes `isNonCash` without changing the grouping.
    if (g.lines.some(l => NON_CASH_TYPES.has(String(l.fund || "").toLowerCase()))) {
      out.push(`${g.ref} on ${g.depositedOn} contains a non-cash gift.`);
    }
  }
  return out;
}

function depositsRefusalMessage(refusals) {
  if (!refusals || !refusals.length) return null;
  return "Steward will not write this deposits file, because it does not foot: "
    + refusals.join(" ")
    + " Nothing is wrong with your gifts; this is Steward refusing to hand a bookkeeper a file it cannot stand behind.";
}

// ── THE COLUMNS EACH TOOL WANTS ───────────────────────────────────────────
// A RESHAPE, not a second computation. Every flavour reads the same groups and
// only renames and reorders, which is why the totals cannot diverge: there is
// nothing here that adds anything up.
//
// QuickBooks Online's bank deposit import takes one row per deposit LINE with
// the deposit's date and account repeated; a fee is a negative line against
// the fee account. Xero's bank statement / spend-money import is the same
// shape with its own headings. Documented, not walked, exactly as the gift
// flavours say of themselves.
const DEPOSIT_FLAVOURS = {
  steward: {
    label: "Steward", confidence: "walked",
    note: "Steward's own columns: one row per line, grouped by deposit.",
    headers: ["Deposit date", "Deposit", "Deposit account", "Line", "Fund or account", "Amount", "Gifts", "Deposit net"],
    rows: built => built.groups.flatMap(g => [
      ...g.lines.map(l => [g.depositedOn, g.ref, g.account || "", "Gift income", l.fund, amt(l.cents), "", ""]),
      ...(g.feeCents ? [[g.depositedOn, g.ref, g.account || "", "Processing fees", "Processing fees", amt(-g.feeCents), "", ""]] : []),
      [g.depositedOn, g.ref, g.account || "", "Deposit total (net)", "", amt(g.netCents), String(g.giftCount), amt(g.netCents)],
    ]),
  },
  quickbooks: {
    label: "QuickBooks", confidence: "documented-not-walked",
    note: "QuickBooks Online's bank deposit import. One row per line; the fee is a negative line.",
    headers: ["Date", "Deposit To", "Received From", "Account", "Description", "Amount", "Memo"],
    rows: built => built.groups.flatMap(g => [
      ...g.lines.map(l => [g.depositedOn, g.account || "", "", l.fund, "Gift income", amt(l.cents), g.ref]),
      ...(g.feeCents ? [[g.depositedOn, g.account || "", "", "Processing fees", "Payment processing fees", amt(-g.feeCents), g.ref]] : []),
    ]),
  },
  xero: {
    label: "Xero", confidence: "documented-not-walked",
    note: "Xero's bank statement import. One row per line; the fee is a negative line.",
    headers: ["*Date", "*Amount", "Payee", "Description", "Reference", "Account Code", "*Bank Account"],
    rows: built => built.groups.flatMap(g => [
      ...g.lines.map(l => [g.depositedOn, amt(l.cents), "", "Gift income · " + l.fund, g.ref, l.fund, g.account || ""]),
      ...(g.feeCents ? [[g.depositedOn, amt(-g.feeCents), "", "Payment processing fees", g.ref, "Processing fees", g.account || ""]] : []),
    ]),
  },
};

// The non-cash gifts, as their own file. Never a section inside the deposits
// file: a bookkeeper importing that file imports bank transactions, and a
// stock gift is not one.
const NON_CASH_HEADERS = ["Gift date", "Donor", "Kind", "Description", "Value", "Fund or designation"];
const nonCashRows = built => built.nonCash.map(r =>
  [r.date, r.donorName, r.type, r.description, amt(r.cents), r.fund]);

// One sentence for the screen, the CSV's companion and anything printed later.
function depositsSentence(built) {
  if (!built.groups.length && !built.nonCash.length) return "No money arrived in this month, so there is nothing to deposit.";
  const parts = [];
  if (built.groups.length) {
    parts.push(`${built.groups.length} ${built.groups.length === 1 ? "deposit" : "deposits"}, `
      + `${fmtMoney(built.grossCents)} gross`
      + (built.feeCents ? ` less ${fmtMoney(built.feeCents)} in fees` : "")
      + `, ${fmtMoney(built.netCents)} to the bank.`);
  }
  if (built.nonCash.length) {
    parts.push(`${built.nonCash.length} non-cash ${built.nonCash.length === 1 ? "gift" : "gifts"} worth `
      + `${fmtMoney(built.nonCashCents)}, listed separately because they never reached a bank account.`);
  }
  if (built.unmatchedCents) {
    parts.push(`${fmtMoney(built.unmatchedCents)} is not yet matched to a payout or a deposit sheet, `
      + `so it is grouped by the day it was recorded.`);
  }
  return parts.join(" ");
}

module.exports = {
  NON_CASH_TYPES, UNMATCHED_REF, DEPOSIT_FLAVOURS, NON_CASH_HEADERS,
  isNonCash, depositKey, depositGroups, depositsRefusals, depositsRefusalMessage, amt,
  nonCashRows, depositsSentence, fmtMoney,
};
