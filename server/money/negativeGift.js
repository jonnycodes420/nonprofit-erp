// INPUT-1 item 1 · A NEGATIVE GIFT IS NEVER SAVED, AND NEVER SAVED AS POSITIVE.
//
// Jarvis's sweep (25 Nov) typed "-50" on a profile's gift form and got a $50
// gift with no word: the form stripped the minus as she typed. The Finance
// ledger's Money in took a negative row as typed. Money going back to a donor
// has one way in, Record a refund, which writes a negative row LINKED to the
// gift it refunds (MONEY-4, `refundOf`). Every other door refuses a negative
// amount with this sentence, said under the field, keeping what she typed.
"use strict";

const NEGATIVE_GIFT_SENTENCE = "A gift can't be negative. To give money back, refund the gift.";
const NEGATIVE_LEDGER_SENTENCE = "An amount can't be negative. Choose Money in or Money out, and type the amount without a minus.";

// The error a writer throws; the app's error handler answers it as a 400 with
// its sentence (server/boot/steps-4.js), never a 500.
function refusal(sentence, code, field = "amount") {
  const e = new Error(sentence);
  e.code = code; e.field = field; e.status = 400; e.refusal = true;
  return e;
}

// recordGift's check: a negative amount is a refund, and only a refund.
function assertGiftAmount(amount, o = {}) {
  if (Number(amount) < 0 && !o.refundOf) throw refusal(NEGATIVE_GIFT_SENTENCE, "negative_gift");
}

// A route's check, before it writes: the body to answer with, or null.
function giftAmountRefusal(amount) {
  return Number(amount) < 0 ? { error: NEGATIVE_GIFT_SENTENCE, code: "negative_gift", field: "amount", sentence: NEGATIVE_GIFT_SENTENCE } : null;
}

// The ledger's check. Money in is a gift's sentence; Money out its own.
function ledgerAmountRefusal(amount, type) {
  if (!(Number(amount) < 0)) return null;
  const s = type === "income" ? NEGATIVE_GIFT_SENTENCE : NEGATIVE_LEDGER_SENTENCE;
  return { error: s, code: type === "income" ? "negative_gift" : "negative_amount", field: "amount", sentence: s };
}

module.exports = { NEGATIVE_GIFT_SENTENCE, NEGATIVE_LEDGER_SENTENCE, assertGiftAmount, giftAmountRefusal, ledgerAmountRefusal, refusal };
