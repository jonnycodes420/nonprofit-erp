// FIX-36 · AN OLD GIFT READ FROM HISTORY NEVER STARTS A JOURNEY.
//
// A history read (a giving source's first read, QuickBooks, an import) brings
// in months of gifts at once, and every one of them passes through
// recordGift. Without this rule a check from last March starts a first-gift
// journey today, and the donor is thanked for a gift from seven months ago.
//
// THE RULE, in one place: a gift recorded by a history read starts
// gift-triggered journeys (and sequences, and a thank-you draft) only when its
// date is within the last HISTORY_DAYS days of the org's calendar. The gift is
// recorded either way and counts everywhere a gift counts. A live gift (Stripe,
// a giving page, a later incremental read, a person at the gift form) is never
// a history gift and is never held back by this.
"use strict";

const orgTime = require("./orgTime");

const HISTORY_DAYS = 30;
const HISTORY_NOTE = `Gifts older than ${HISTORY_DAYS} days won't start journeys or thank-yous.`;

// The first day that is still recent: a gift on or after it is treated as new.
function historyFrom(today) { return orgTime.addDays(today, -HISTORY_DAYS); }

// True when a history gift is too old to start anything. A gift with no
// readable date is held back too: a history read that cannot say when a gift
// happened has not said it happened recently.
function isOldHistory(date, today) {
  const d = String(date || "").slice(0, 10);
  const from = historyFrom(today);
  if (!from) return false;
  if (!orgTime.parseCivil(d)) return true;
  return d < from;
}

module.exports = { HISTORY_DAYS, HISTORY_NOTE, historyFrom, isOldHistory };
