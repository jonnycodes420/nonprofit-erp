// server/give/stripeCard.js · FLOWS-15 item 6 (W-1116-Atlas-30). THE STRIPE CARD SAYS TWO
// THINGS, EACH TRUE ON ITS OWN, AND ONE WEEKLY RATE.
//
// The expanded panel read "Connected, synced 5 days ago", "Stripe Healthy" and "Take gifts on your
// giving pages: On", while the same panel offered "Set up Stripe to accept online donations" and
// the public giving page said "Not open yet". "On" was "Stripe Connect finished OR any Stripe gift
// in the last thirty days" (routes/give.js), and the gifts Steward READ from Stripe's history
// counted, so reading the history turned taking gifts on. The panel also gave two weekly rates,
// "about 6.1 gifts a week" and "about 5.5 gifts a week": one from the gifts the pages took, one
// from the history connection's gifts, each through its own rhythm.
//
// THE RULE:
//   · Take gifts on your giving pages is the public page's own check (server/give/takesGifts.js
//     orgTakesGifts: Stripe connected and an account on file). On exactly when the page is open.
//   · Read your Stripe history is the history connection's own state, and says only that.
//   · One weekly rate for the card: shared/connections.js rhythmOf over every Stripe gift either
//     half brought in, its window named. The halves never carry a rate of their own.
"use strict";
const { orgTakesGifts } = require("./takesGifts");

const PAGES_ON = "On. Your giving pages take gifts through your Stripe account.";
const PAGES_OFF = "Off. Your giving pages show donors \"Not open yet\" until Stripe is set up for them.";

// main-fix: an instant is read as the ORG's civil date, as `today` is. Its UTC
// date said "4 days ago" for a read 5 org-days ago every evening in a US org
// (flows15 §6 red after 7 PM Eastern). A bare date stays as it is.
function ago(at, today, org = null) {
  const inst = at instanceof Date ? at : (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(String(at || "")) ? new Date(at) : null);
  const d = inst ? (isNaN(inst) ? "" : require("../../orgTime").orgToday(org || {}, inst)) : String(at || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !today) return null;
  const n = Math.round((Date.parse(String(today).slice(0, 10) + "T00:00:00Z") - Date.parse(d + "T00:00:00Z")) / 86400000);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

// card: the Stripe card as routes/give.js built it; org: the orgs row; C: shared/connections.js;
// ownDates / historyDates: the gift dates each half brought in; historyCard: the provider card the
// history half was made from (or null); today: the org's civil today.
function settleStripeCard(card, { org, C, ownDates = [], historyDates = [], historyCard = null, today }) {
  if (!card) return card;
  const takes = orgTakesGifts(org);
  const pages = (card.parts || []).find(p => p.key === "pages");
  if (pages) Object.assign(pages, { connected: takes, sentence: takes ? PAGES_ON : PAGES_OFF,
    action: takes ? null : "connect", actionLabel: takes ? null : "Set up Stripe" });
  const history = (card.parts || []).find(p => p.key === "history");
  const reads = !!(history && history.connected);
  if (history && reads) {
    const when = ago(historyCard && historyCard.lastSyncedAt, today, org);
    history.sentence = `On. Steward reads the gifts Stripe already holds onto your donor records${when ? `; it last read them ${when}` : ""}.`;
  }
  // The card: connected when either half is; its status and its one rate over every Stripe gift.
  const connected = takes || reads;
  const dates = [...new Set([...(ownDates || []), ...(historyDates || [])])];
  const lastGiftDate = dates.slice().sort().pop() || null;
  const a = C.assessConnection({ connected, lastError: historyCard && historyCard.status === "broken" ? historyCard.sentence : null,
    lastGiftDate, giftDates: dates, today });
  Object.assign(card, {
    connected, status: a.status, sentence: a.sentence, statusDefinition: a.definition,
    rhythmSentence: a.rhythm ? a.rhythm.sentence : null, silentDays: a.silentDays ?? null, quietAfterDays: a.quietAfterDays ?? null,
    takesGifts: takes, readsHistory: reads,
  });
  return card;
}

module.exports = { settleStripeCard, ago, PAGES_ON, PAGES_OFF };
