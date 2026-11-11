# TRUTH-6 · One gift count everywhere, future gifts one way, drafts quote the right gift

Why (lead-2026-11-10): the header said 503 gifts over a monthly table of 502 while Finance's months
summed to 505; a $0 gift kept a $200 receipt; a hand-entered postdated gift counted in Lifetime and
Last gift while an import set the same kind aside (a 1,000-row file short its 76 future rows); the
first-gift thank-you quoted the latest gift; a group campaign said "0 can get this email" with no
members beside it; Last FY moved gifts but not goals; Finance's totals had no stated basis.

What was learned:
- The count rule existed (giftCount.js) but two readers kept their own: the `gifts` source counted
  `amount > 0` (a gift refunded in full counted) and Finance's months counted every money row.
- "Postdated" is a state, not a refusal: `gifts.scheduled_on`, read through money.js MONEY and GIFT
  (shared/numbers/scheduled.js DUE), so the rule reaches every total that already used those two.
  Sites that read `NOT_CREDIT` directly for a money window got the same DUE beside it.
- A merge field that names "the gift" has to say which gift. giftFacts.js gives first, last and
  largest by the orders firstGift.js and lastGift.js already keep.
- An audience number with no members beside it reads as a fault even when every reason is right.
