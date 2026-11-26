// INPUT-1 · what a typed amount may be, said under the field, keeping what she typed.
// The server says the same sentence (server/money/negativeGift.js); this only says it first.
export const NEGATIVE_GIFT_SENTENCE = "A gift can't be negative. To give money back, refund the gift.";
export const NEGATIVE_LEDGER_SENTENCE = "An amount can't be negative. Choose Money in or Money out, and type the amount without a minus.";

const num = v => Number(String(v == null ? "" : v).replace(/[$,\s]/g, ""));
export const isNegativeAmount = v => /^\s*-/.test(String(v == null ? "" : v).replace(/\$/g, "")) && num(v) < 0;

export function giftAmountProblem(v) { return isNegativeAmount(v) ? NEGATIVE_GIFT_SENTENCE : ""; }
export function ledgerAmountProblem(v, type) {
  if (!isNegativeAmount(v)) return "";
  return type === "income" ? NEGATIVE_GIFT_SENTENCE : NEGATIVE_LEDGER_SENTENCE;
}
