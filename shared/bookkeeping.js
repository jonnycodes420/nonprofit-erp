// shared/bookkeeping.js — INT-2. THE BOOKKEEPER NEVER RETYPES A GIFT.
//
// ── WHAT A BOOKKEEPER ACTUALLY DOES, AND WHY A GIFT LIST IS NOT IT ─────────
// Steward knows every gift. QuickBooks needs DEPOSITS: one entry per thing
// that hit the bank, with the gifts inside it split by fund, the processor's
// fee as a negative line, and a net that equals what the bank statement says.
// A bookkeeper handed a list of gifts still has to do that by hand, which is
// the job this build removes.
//
// So the unit is the PAYOUT, not the gift, and the arithmetic is the only part
// that has to be perfect:
//
//     Σ(gift lines by fund) − fee line = net = what arrived in the bank
//
// A deposit whose lines do not foot to its payout IS NOT SENT. Not rounded,
// not sent with a note: refused, with the difference stated in cents. An
// accounting system is the one place in this product where "close enough"
// becomes somebody's audit finding.
//
// ── IDEMPOTENT BY PAYOUT ID, AND THAT IS THE WHOLE SAFETY MODEL ────────────
// A daily send, a manual send and a retry after a timeout are three things
// that happen to the same payout on the same afternoon. Two deposits for one
// payout doubles a nonprofit's recorded revenue in its own books, which is a
// worse outcome than sending nothing at all.
//
// The guarantee is Steward's own ledger, not the vendor's good manners: one
// row per (org, vendor, payout), claimed BEFORE the call and kept afterwards
// whatever happened. The vendor's idempotency key rides along as a second
// belt, because a timeout means Steward does not know whether the first call
// landed — and only the vendor can answer that.
//
// ── WHAT IS NEVER SENT ─────────────────────────────────────────────────────
// POS event and shop revenue goes as its OWN income lines and never as
// donations (INT-POS's rule, one system along: a raffle ticket is not a gift
// here either). Donor names go on lines only if the organisation turns that
// on, and the default is off — most small nonprofits do not want their donor
// list mirrored into a bookkeeping system their accountant's staff can read.
//
// Pure: no DB, no network, no clock, no vendor SDK, no JSX.

export const VENDORS = {
  quickbooks: {
    key: "quickbooks", label: "QuickBooks Online",
    // Intuit calls the second axis a CLASS; Xero calls it a tracking category.
    // They are the same idea and this is the only place that knows they differ.
    secondAxis: "class", secondAxisLabel: "Class",
    authNote: "Connect with Intuit's OAuth 2.0. Steward asks for accounting scope and nothing else.",
    sends: true,
  },
  xero: {
    key: "xero", label: "Xero",
    secondAxis: "tracking", secondAxisLabel: "Tracking category",
    authNote: "Connect with Xero's OAuth 2.0. Steward asks for accounting transactions and settings, and nothing else.",
    // FIX-20 Part 4: the Xero send was a stub that posted to an endpoint Xero
    // does not have. Until a real one exists (bank transactions from the
    // org's own accounts and tracking categories, a Pending list, sent once),
    // every screen says plainly that nothing is sent, and the route refuses.
    sends: false,
    notSendingSentence: "Sending to Xero is not available yet. Steward has sent nothing to Xero, and the bookkeeper file on the Finance tab has the same gifts in Xero's columns.",
  },
};
export const VENDOR_KEYS = Object.keys(VENDORS);
export const isVendor = k => VENDOR_KEYS.includes(k);

// ── THE MAPPING ────────────────────────────────────────────────────────────
// Set once. Nothing is sent until it is saved, and "nothing is sent" is
// literal: `readyToSend` is false and the send route refuses.
export const MAPPING_PARTS = [
  { key: "funds", label: "Each fund and designation",
    sentence: "Which income account each of your funds posts to. A fund with no account stops the send rather than guessing one." },
  { key: "fees", label: "The processing fee",
    sentence: "The expense account the card fees post to, as a negative line inside the deposit." },
  { key: "deposits", label: "The bank account, per source",
    sentence: "Which bank account each payout lands in. Stripe and PayPal often settle to different ones." },
];

/**
 * Is this mapping complete enough to send anything?
 * Deliberately strict: a fund with no account is a MISSING mapping, not a
 * default, because a default here silently posts restricted money to the wrong
 * place and nobody notices until an auditor does.
 */
export function mappingReady({ funds = [], feeAccountId = null, depositAccounts = {} } = {}, { sources = [] } = {}) {
  const missingFunds = funds.filter(f => !f.accountId).map(f => f.name || f.id);
  const missingDeposits = sources.filter(s => !depositAccounts[s]).map(s => s);
  const problems = [];
  if (missingFunds.length) problems.push(`${missingFunds.length} fund${missingFunds.length === 1 ? "" : "s"} with no account: ${missingFunds.slice(0, 5).join(", ")}`);
  if (!feeAccountId) problems.push("no account for the processing fee");
  if (missingDeposits.length) problems.push(`no bank account for ${missingDeposits.slice(0, 5).join(", ")}`);
  return {
    ready: problems.length === 0, problems,
    sentence: problems.length
      ? `Steward will not send anything yet: ${problems.join("; ")}.`
      : "Every fund, the fee and each bank account have somewhere to go. Steward can send.",
  };
}

// ── BUILDING ONE DEPOSIT ───────────────────────────────────────────────────
/**
 * @param {object} payout  { id, arrivedOn, netCents, sourceKey }
 * @param {array}  gifts   [{ id, donorName, fundId, fundName, amountCents, feeCents }]
 * @param {array}  revenue [{ category, amountCents, eventName }]  INT-POS money, never donations
 * @param {object} mapping { funds: {fundId: accountId}, classes: {fundId: classId},
 *                           feeAccountId, depositAccounts: {sourceKey: accountId}, donorNames: bool }
 * @returns {{ok, deposit?, problem?, sentence}}
 */
export function buildDeposit(payout, gifts = [], revenue = [], mapping = {}) {
  const net = int(payout && payout.netCents);
  const bankAccountId = (mapping.depositAccounts || {})[payout && payout.sourceKey] || null;
  if (!bankAccountId) return refuse(payout, `no bank account is mapped for ${payout && payout.sourceKey}`);

  // Gifts, grouped by fund. One line per fund, never one per gift: a deposit
  // with four hundred lines is a deposit a bookkeeper cannot read, and the
  // gift-level detail already lives in Steward where it belongs.
  const byFund = new Map();
  let feeCents = 0;
  for (const g of gifts) {
    const fundId = g.fundId || "__unrestricted";
    const accountId = (mapping.funds || {})[fundId] || null;
    if (!accountId) return refuse(payout, `the fund "${g.fundName || fundId}" has no account`);
    let row = byFund.get(fundId);
    if (!row) byFund.set(fundId, row = { fundId, fundName: g.fundName || null, accountId,
      classId: (mapping.classes || {})[fundId] || null, amountCents: 0, giftIds: [], donors: [] });
    row.amountCents += int(g.amountCents);
    row.giftIds.push(g.id);
    if (mapping.donorNames && g.donorName) row.donors.push(g.donorName);
    feeCents += int(g.feeCents);
  }

  const lines = [];
  for (const row of byFund.values()) {
    lines.push({ kind: "gift", accountId: row.accountId, classId: row.classId,
      amountCents: row.amountCents, fundId: row.fundId,
      description: describeLine(row, mapping.donorNames), giftIds: row.giftIds });
  }
  // INT-POS money: event and shop revenue, on its OWN lines. Never a donation
  // account, whatever the mapping says, because it was never a donation.
  for (const r of revenue) {
    const accountId = (mapping.revenueAccounts || {})[r.category] || null;
    if (!accountId) return refuse(payout, `"${r.category}" revenue has no account`);
    lines.push({ kind: "revenue", accountId, classId: null, amountCents: int(r.amountCents),
      description: [r.eventName, r.category].filter(Boolean).join(" · ") || r.category });
  }
  if (feeCents > 0) {
    if (!mapping.feeAccountId) return refuse(payout, "no account is mapped for the processing fee");
    lines.push({ kind: "fee", accountId: mapping.feeAccountId, classId: null,
      amountCents: -feeCents, description: "Processing fees" });
  }

  // THE ASSERTION, and it is the reason this function exists. Gross minus fees
  // must equal what arrived in the bank, to the cent.
  const linesTotal = lines.reduce((t, l) => t + l.amountCents, 0);
  if (linesTotal !== net) {
    const d = linesTotal - net;
    return { ok: false, problem: "does_not_foot", differenceCents: d,
      sentence: `This deposit's lines come to ${money(linesTotal)} and ${money(net)} arrived in the bank — ${money(Math.abs(d))} ${d > 0 ? "more" : "less"} than Steward can account for. Nothing was sent.` };
  }

  return { ok: true, sentence: `${lines.length} line${lines.length === 1 ? "" : "s"} totalling ${money(net)}, which is what arrived in the bank.`,
    deposit: {
      payoutId: payout.id, sourceKey: payout.sourceKey, bankAccountId,
      date: String(payout.arrivedOn || "").slice(0, 10),
      netCents: net, lines,
      // The key the VENDOR dedupes on, and it is derived from the payout so
      // two different runs of this function produce the same one.
      idempotencyKey: idempotencyKey(payout),
    } };
}

export function idempotencyKey(payout) {
  return `steward:payout:${String(payout && payout.id || "").slice(0, 64)}`;
}

function describeLine(row, donorNames) {
  const base = row.fundName ? `Gifts to ${row.fundName}` : "Gifts";
  const n = row.giftIds.length;
  const count = `${n} gift${n === 1 ? "" : "s"}`;
  if (!donorNames || !row.donors.length) return `${base} (${count})`;
  const shown = row.donors.slice(0, 6).join(", ");
  return `${base} (${count}): ${shown}${row.donors.length > 6 ? ` and ${row.donors.length - 6} more` : ""}`;
}

function refuse(payout, why) {
  return { ok: false, problem: "mapping", sentence: `Steward did not send the deposit for ${payout && payout.id}: ${why}. Finish the mapping and it will go on the next send.` };
}

// ── AGREEMENT ──────────────────────────────────────────────────────────────
// Steward's deposits beside the accounting system's, for one month. Matched on
// the payout id Steward stamped when it sent; anything on either side with no
// partner is LISTED rather than quietly netted off, because the whole value of
// this view is the row that is missing.
export function agree(stewardDeposits = [], vendorDeposits = [], { month = "" } = {}) {
  const byKey = new Map(vendorDeposits.map(v => [String(v.payoutId || v.idempotencyKey || v.id), v]));
  const matched = [], onlyInSteward = [], differing = [];
  const seen = new Set();
  for (const s of stewardDeposits) {
    const key = String(s.payoutId || s.idempotencyKey || s.id);
    const v = byKey.get(key);
    if (!v) { onlyInSteward.push(s); continue; }
    seen.add(key);
    if (int(v.netCents) !== int(s.netCents)) differing.push({ payoutId: key, stewardCents: int(s.netCents), vendorCents: int(v.netCents), differenceCents: int(v.netCents) - int(s.netCents) });
    else matched.push({ payoutId: key, netCents: int(s.netCents) });
  }
  const onlyInVendor = vendorDeposits.filter(v => !seen.has(String(v.payoutId || v.idempotencyKey || v.id)));
  const stewardCents = stewardDeposits.reduce((t, s) => t + int(s.netCents), 0);
  const vendorCents = vendorDeposits.reduce((t, v) => t + int(v.netCents), 0);
  const agreed = !onlyInSteward.length && !onlyInVendor.length && !differing.length;
  return {
    month, matched, onlyInSteward, onlyInVendor, differing,
    stewardCents, vendorCents, differenceCents: vendorCents - stewardCents, agreed,
    sentence: agreed
      ? `${matched.length} deposit${matched.length === 1 ? "" : "s"} totalling ${money(stewardCents)}, and the two agree to the cent.`
      : [onlyInSteward.length ? `${onlyInSteward.length} Steward sent that ${onlyInSteward.length === 1 ? "is" : "are"} not there` : null,
         onlyInVendor.length ? `${onlyInVendor.length} there that Steward did not send` : null,
         differing.length ? `${differing.length} where the amounts differ` : null]
        .filter(Boolean).join(", ") + ".",
  };
}

const int = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
export const money = cents => {
  const n = int(cents) / 100;
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US",
    { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
};

export default { VENDORS, VENDOR_KEYS, isVendor, MAPPING_PARTS, mappingReady,
                 buildDeposit, idempotencyKey, agree, money };
