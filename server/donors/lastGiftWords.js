// server/donors/lastGiftWords.js · FLOWS-14 item 4 (W-1116-Fundraising-15X).
// THE GIFT A LETTER THANKS SOMEONE FOR.
//
// "Hello Silas, Thank you for your gift of $-25" came from a merge field that
// read the person's newest gift ROW (ORDER BY date DESC LIMIT 1), and the newest
// row was a refund. Every "most recent gift" read is shared/numbers/lastGift.js's
// rule (FLOWS-11's: a gift above $0, not a refund, not refunded in full, with the
// old system's last gift as the floor). This is that rule for one person, as the
// row a merge field formats: { amount } in dollars, or null when there is none,
// and a letter with no gift leaves its gift sentence out (shared/giftSentence.js).
"use strict";

async function lastGiftRow(query, orgId, donorId) {
  if (!donorId) return null;
  let org = orgId;
  if (!org) { const [d] = await query("SELECT org_id FROM donors WHERE id = ?", [donorId]); org = d && d.org_id; }
  if (!org) return null;
  const last = (await require("../../shared/numbers/lastGift").lastGifts(query, org, [donorId])).get(donorId);
  return last && last.cents > 0 ? { amount: last.cents / 100, date: last.date } : null;
}

module.exports = { lastGiftRow };
