// shared/giftFooting.js — GIVE-2 §5. THE FOUR NUMBERS ON ONE GIFT.
//
// A gift taken online now carries four money figures, and the brief's one test
// is that they foot to the cent:
//
//   GROSS     what the card or the bank account was actually charged.
//             `gifts.amount`. The receipt's number, the donor's statement's
//             number, and what every giving total in the product already counts.
//   COVERED   the part of gross the donor added on purpose so the processor's
//             cut would not come out of the mission. `gifts.cover_fee_amount`.
//             Zero on every gift where the box was not ticked.
//   FEE       what the processor actually took. `gifts.processor_fee_amount`,
//             read off the charge's own balance transaction by the webhook —
//             NOT computed from the org's configured rate. The configured rate
//             is what the form ASKED for; this is what happened.
//   NET       what landed in the org's bank account: gross minus fee.
//
// ── WHY NET IS DERIVED AND NOT STORED ──────────────────────────────────────
// "When two surfaces show the same number, it's computed once" (CLAUDE.md).
// Net is gross minus fee by definition, so a stored net column would be a
// second opinion about a subtraction, and the only thing a second opinion about
// a subtraction can do is disagree. One function, every surface.
//
// ── AND WHY INTENDED IS NOT NET ────────────────────────────────────────────
// They are three different questions and the product already answers two of
// them in different places, which is exactly how they get confused:
//
//   · A campaign thermometer counts INTENDED (gross − covered): the donor meant
//     to give $100 and pressed a button that charged $103.20. Their gift to the
//     campaign is $100. This is the attribution-FIX rule and it is unchanged.
//   · A receipt, Reports and the ledger count GROSS: $103.20 left their
//     account and $103.20 is deductible.
//   · The bank reconciliation counts NET: $100.00 arrived.
//
// Every one of those is right for its own screen and none of them is right for
// another's, so this module names all four and leaves the choosing to the
// caller. `footsToTheCent` is the identity a suite can assert.
//
// Pure: integer cents in, integer cents out. No DB, no clock, no rounding
// decisions of its own — every input is already a whole number of cents
// (`money.js` is the seam that made it one).

// The three answers to "who told us what the processor took". Anything else,
// including NULL, means nobody has.
export const FEE_SOURCES = Object.freeze(["stripe_balance_transaction", "provider", "none"]);

const int = v => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// `o` is { grossCents, feeCents, coveredCents } — whole cents, in the caller's
// hands from `money.toCents`. A missing fee is zero and NOT a guess: a gift
// whose balance transaction has not been read yet has no fee on file, and
// pretending it cost the configured rate would put an invented number beside
// three real ones.
export function giftFooting(o) {
  const grossCents = Math.max(0, int(o && o.grossCents));
  // A fee can never exceed the charge, and a negative fee is a refund that
  // belongs on its own row rather than inside this one's arithmetic.
  const feeCents = Math.min(grossCents, Math.max(0, int(o && o.feeCents)));
  const coveredCents = Math.min(grossCents, Math.max(0, int(o && o.coveredCents)));
  return {
    grossCents,
    feeCents,
    coveredCents,
    netCents: grossCents - feeCents,
    intendedCents: grossCents - coveredCents,
    // WHETHER THE FEE IS KNOWN AT ALL. A cash gift has no processor and no fee;
    // an online gift whose balance transaction could not be read has a fee
    // nobody has stated. Both carry 0 in `gifts.processor_fee_amount` (the
    // column has defaulted to 0 since BUILD-89S) and they are not the same
    // fact, so the caller passes `feeSource` — `gifts.processor_fee_source`,
    // NULL until somebody says. A screen that showed the same "received" for
    // both would be wrong about one of them.
    feeKnown: FEE_SOURCES.includes(String((o && o.feeSource) || "")),
    feeSource: (o && o.feeSource) || null,
  };
}

// THE IDENTITY. gross = net + fee, and gross = intended + covered. Both to the
// cent, by construction above — which is the point: the assertion is cheap
// because the arithmetic has one home.
export function footsToTheCent(f) {
  if (!f) return false;
  return f.netCents + f.feeCents === f.grossCents
      && f.intendedCents + f.coveredCents === f.grossCents;
}

// ── THE SENTENCE UNDER EACH ONE ────────────────────────────────────────────
// Every number has a sentence (CLAUDE.md), and these are the four. They name
// the column so a bookkeeper asked "where does this come from" has an answer.
export const FOOTING_DEFINITIONS = Object.freeze({
  gross: "What the card or bank account was charged. This is the receipt's amount and the amount every giving total counts.",
  covered: "The part the donor added on purpose to cover the processing fee. Zero unless they ticked the box.",
  fee: "What the payment processor took, read from the charge itself rather than from a rate.",
  net: "What reached the organisation's bank account: the charge less the processor's fee.",
  intended: "What the donor meant to give to the mission: the charge less the part they added for the fee. This is what a campaign's progress counts.",
});

// A one-line summary for a gift row, used on the donor profile and the
// fundraising panel. Dollars are formatted by the caller (`en-US`, named —
// never `toLocaleString(undefined, …)`, which flips the separator in half of
// Europe and makes `$25.000` read as twenty-five dollars).
export function footingLine(f, fmtCents) {
  if (!f || !f.grossCents) return "";
  const parts = [`${fmtCents(f.grossCents)} charged`];
  if (f.coveredCents) parts.push(`${fmtCents(f.coveredCents)} of it added to cover the fee`);
  if (f.feeKnown && f.feeCents) parts.push(`${fmtCents(f.feeCents)} taken by the processor`);
  if (f.feeKnown) parts.push(`${fmtCents(f.netCents)} received`);
  return parts.join(", ") + ".";
}
