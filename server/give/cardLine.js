// server/give/cardLine.js · HONEST-4 item 4. STRIPE'S CARD UPDATER SHOWS ITS WORK.
//
// Steward already listens for payment_method.automatically_updated (Stripe's Card Account Updater:
// the bank reissued or renewed the card and the network passed the new one on) and logs each as a
// `card_auto_updated` recovery event. A donor who changes their own card through the update link
// logs `card_updated`. Neither was on the gift's row, so nobody could see the updater working.
//
// One line per recurring gift: the card, and when it was last updated and by whom.
//   "Visa ending 4242 · updated by the bank Nov 3"
//   "Card ending 0005 · updated by the donor Oct 2"
//   "Visa ending 4242 · not updated since Steward first read it"
// Read-only. No payments code: the webhook and the expiry sweep are unchanged.
"use strict";

const WHO = { card_auto_updated: "the bank", card_updated: "the donor" };
const brandWord = b => !b ? "Card" : String(b).charAt(0).toUpperCase() + String(b).slice(1).toLowerCase();

// The latest card update per Stripe subscription id, one query: { [stripeSubId]: { type, at, day } }.
async function latestUpdates(query, orgId, tzSql) {
  const rows = await query(
    `SELECT DISTINCT ON (subscription_id) subscription_id, type, created_at,
            TO_CHAR(created_at AT TIME ZONE ${tzSql}, 'YYYY-MM-DD') AS day
       FROM payment_recovery_events
      WHERE org_id = ? AND type IN ('card_auto_updated', 'card_updated') AND subscription_id IS NOT NULL
      ORDER BY subscription_id, created_at DESC`, [orgId]);
  return Object.fromEntries(rows.map(r => [r.subscription_id, { type: r.type, at: r.created_at, day: r.day }]));
}

const monDay = day => { const d = new Date(`${day}T12:00:00Z`); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };

// The words for one subscription row ({ card_brand, card_last4 }) and its latest update (or none).
function cardLineOf(sub, upd) {
  if (!sub || !sub.card_last4) return null;
  const card = `${brandWord(sub.card_brand)} ending ${sub.card_last4}`;
  if (!upd) return { card, by: null, day: null, words: `${card} · not updated since Steward first read it` };
  return { card, by: WHO[upd.type] || null, day: upd.day, words: `${card} · updated by ${WHO[upd.type]} ${monDay(upd.day)}` };
}

module.exports = { latestUpdates, cardLineOf, WHO };
