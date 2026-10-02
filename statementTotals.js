// statementTotals.js — COMMS-2. THE YEAR-END STATEMENT'S MONEY, IN CENTS.
//
// One function turns a donor's gift rows for a tax year into the statement's
// line items and totals. It used to add floating-point dollars, and it trusted
// `deductible_amount` even after a partial refund had lowered `amount` under
// it, so a statement could claim more was deductible than was ever given.
//
// The rules, the same ones a single gift receipt follows:
//   · the gift amount is what was given, net of refunds (a refund lowers it, a
//     full refund removes the gift);
//   · the deductible part is the amount minus any goods or services received
//     (`deductible_amount` when it was stored, e.g. an event ticket's fair
//     market value), never more than the amount and never below zero;
//   · a gift the org LOST a dispute over was taken back, so it is not on the
//     statement; a sample gift is not real and is never on one.
// Every sum is integer cents, converted once, by money.js.
const { toCents, toDollars } = require("./money");

const cents = v => toCents(String(v ?? "0")) ?? 0;

function statementLines(gifts) {
  const kept = gifts.filter(g => g.is_sample !== true && String(g.dispute_status || "") !== "lost");
  const lines = kept.map(g => {
    const amount = cents(g.amount);
    const stored = g.deductible_amount != null ? cents(g.deductible_amount) : amount;
    const deductible = amount <= 0 ? amount : Math.max(0, Math.min(stored, amount));
    return { id: g.id, date: g.date, amountCents: amount, deductibleCents: deductible, paymentMethod: g.payment_method || "" };
  });
  const totalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const deductibleCents = lines.reduce((s, l) => s + l.deductibleCents, 0);
  return { lines, totalCents, deductibleCents, totalAmount: toDollars(totalCents), totalDeductible: toDollars(deductibleCents) };
}

module.exports = { statementLines };
