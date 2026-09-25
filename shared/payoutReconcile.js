// shared/payoutReconcile.js — FIX-1 E. WHICH GIFTS MADE UP THIS PAYOUT?
//
// The question a treasurer asks Steward that QuickBooks cannot answer. Stripe
// deposits ONE number in the bank; behind it are charges, refunds and fees.
// This module takes the payout and the balance transactions Stripe says made
// it up, and answers three things, all in INTEGER CENTS:
//
//   1. every row behind the payout — a charge, a refund, a fee — linked to the
//      Steward gift (and donor) its payment intent belongs to;
//   2. whether the rows add up to what arrived in the bank;
//   3. when they do not, BY HOW MUCH, in a sentence. A payout that does not
//      reconcile is never rounded into one that does.
//
// Pure: no DB, no network, no clock. The route hands it rows; the suite hands
// it fixtures; both get the same answer.

// Stripe's balance-transaction `type`s, grouped the way a bookkeeper reads
// them. Anything unrecognised is kept and labelled "other" — never dropped,
// because a dropped row is a payout that silently stops adding up.
const KIND_OF = {
  charge: "charge", payment: "charge",
  refund: "refund", payment_refund: "refund", payment_failure_refund: "refund",
  stripe_fee: "fee", application_fee: "fee", tax_fee: "fee",
  adjustment: "adjustment", dispute: "adjustment",
};
// The payout's own balance transaction is the money LEAVING the balance for the
// bank. It is the thing being explained, never one of its parts.
const SELF_TYPES = new Set(["payout", "payout_cancel", "payout_failure"]);

export function kindOf(type) { return KIND_OF[type] || "other"; }

const int = v => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// A payment intent id off a balance transaction's (expanded) source: a Charge
// carries `payment_intent`, a Refund carries `payment_intent` too. An
// unexpanded source is a bare id string and links nothing.
export function paymentIntentOf(bt) {
  const s = bt && bt.source;
  if (!s || typeof s !== "object") return null;
  const pi = s.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : (pi.id || null);
}

// giftsByPi: Map or object, payment_intent id → { giftId, donorId, donorName, amountCents }
export function reconcilePayout(payout, balanceTxns, giftsByPi = {}) {
  const lookup = giftsByPi instanceof Map ? k => giftsByPi.get(k) : k => giftsByPi[k];
  const payoutCents = int(payout && payout.amount);
  const rows = [];
  for (const bt of balanceTxns || []) {
    if (!bt || SELF_TYPES.has(bt.type)) continue;
    const kind = kindOf(bt.type);
    const pi = paymentIntentOf(bt);
    const gift = pi ? (lookup(pi) || null) : null;
    // `amount` is gross, `fee` is Stripe's cut, `net` is what the balance
    // moved by. A bare fee row carries its cost in `amount` with net === amount.
    rows.push({
      id: bt.id,
      kind,
      type: bt.type,
      grossCents: int(bt.amount),
      feeCents: int(bt.fee),
      netCents: int(bt.net),
      paymentIntent: pi,
      giftId: gift ? gift.giftId : null,
      donorId: gift ? gift.donorId : null,
      donorName: gift ? gift.donorName : null,
      giftCents: gift && gift.amountCents != null ? int(gift.amountCents) : null,
      description: bt.description || null,
    });
  }
  const sumNet = rows.reduce((s, r) => s + r.netCents, 0);
  const differenceCents = payoutCents - sumNet;
  const count = k => rows.filter(r => r.kind === k).length;
  const total = (k, f) => rows.filter(r => r.kind === k).reduce((s, r) => s + r[f], 0);
  const feeCents = rows.reduce((s, r) => s + r.feeCents, 0) + total("fee", "netCents") * -1;
  // A charge whose gift is not on file is money Steward never recorded. It is
  // named, because "which gift was that" is exactly the question.
  const unmatched = rows.filter(r => (r.kind === "charge" || r.kind === "refund") && !r.giftId);
  return {
    payoutId: payout && payout.id,
    payoutCents,
    rows,
    charges: { count: count("charge"), grossCents: total("charge", "grossCents") },
    refunds: { count: count("refund"), grossCents: total("refund", "grossCents") },
    feesCents: feeCents,
    sumNetCents: sumNet,
    reconciled: differenceCents === 0,
    differenceCents,
    unmatchedCount: unmatched.length,
    sentence: payoutSentence({ payoutCents, differenceCents, rows, unmatched: unmatched.length }),
  };
}

const dollars = c => {
  const neg = c < 0, a = Math.abs(c);
  const s = "$" + (a / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return neg ? "-" + s : s;
};
export { dollars as centsToDollarsText };

export function payoutSentence({ payoutCents, differenceCents, rows, unmatched = 0 }) {
  if (!rows.length) return "Stripe returned nothing behind this payout, so Steward cannot say which gifts it held.";
  const parts = [];
  if (differenceCents === 0) {
    parts.push(`These ${rows.length} line${rows.length === 1 ? "" : "s"} add up to the ${dollars(payoutCents)} that reached your bank, to the cent.`);
  } else {
    const which = differenceCents > 0 ? "more than" : "less than";
    parts.push(`This payout does not reconcile. ${dollars(payoutCents)} reached your bank, which is ` +
      `${dollars(Math.abs(differenceCents))} ${which} the lines behind it add up to.`);
  }
  if (unmatched) parts.push(`${unmatched} of them ${unmatched === 1 ? "is" : "are"} not a gift on file in Steward.`);
  return parts.join(" ");
}
