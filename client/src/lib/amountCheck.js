// INPUT-1 · what a typed amount may be, said under the field, keeping what she typed.
// The server says the same sentence (server/money/negativeGift.js); this only says it first.
import { MAX_GIFT_CENTS, OVER_CAP_WORDS } from "../../../shared/importRowChecks.js";
export const NEGATIVE_GIFT_SENTENCE = "A gift can't be negative. To give money back, refund the gift.";
export const NEGATIVE_LEDGER_SENTENCE = "An amount can't be negative. Choose Money in or Money out, and type the amount without a minus.";

const num = v => Number(String(v == null ? "" : v).replace(/[$,\s]/g, ""));
export const isNegativeAmount = v => /^\s*-/.test(String(v == null ? "" : v).replace(/\$/g, "")) && num(v) < 0;

// IMPORT-11: over the cap is refused in the server's words (money.js parseMoneyOrThrow), before the save.
export const OVER_CAP_GIFT_SENTENCE = `This gift is ${OVER_CAP_WORDS}.`;
export function giftAmountProblem(v) {
  if (isNegativeAmount(v)) return NEGATIVE_GIFT_SENTENCE;
  const n = num(v);
  return Number.isFinite(n) && Math.round(Math.abs(n) * 100) > MAX_GIFT_CENTS ? OVER_CAP_GIFT_SENTENCE : "";
}
export function ledgerAmountProblem(v, type) {
  if (!isNegativeAmount(v)) return "";
  return type === "income" ? NEGATIVE_GIFT_SENTENCE : NEGATIVE_LEDGER_SENTENCE;
}
