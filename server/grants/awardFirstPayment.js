// server/grants/awardFirstPayment.js · MONEY-4 (W-1109-Finance-33).
//
// A Received figure that exists before the award row (the old typed
// `grants.received`, NEA's $35,000) becomes the award's FIRST PAYMENT the
// moment the award is recorded, through GIFTS-1's own path: one gift from the
// funder on the award pledge, written by recordGift (ledger, deposit, the
// after-change step on the queue), history:true and already thanked so it
// starts nothing. Its external id is GIFTS-1's ("gifts1-received:<grant id>"),
// so this and scripts/ops/gifts1-grant-received.js can never both write it.
// Only the difference between the typed figure and what is already recorded
// is written; nothing is ever taken away.
"use strict";
const { GRANT_RECEIVED } = require("../../shared/numbers/pledges");

const extId = grantId => `gifts1-received:${grantId}`;
const NOTE = "Grant payment, from typed Received";
const cents = v => Math.round((Number(v) || 0) * 100);

// { query, recordGift, recalcPledgePayment } from the app; returns the gift written, or null.
async function typedReceivedToFirstPayment(W, { orgId, grantId, date, actorId, actorName }) {
  const [g] = await W.query(
    `SELECT gr.id, gr.funder_donor_id, gr.award_pledge_id, gr.received::text AS typed, ${GRANT_RECEIVED("gr")}::text AS recorded
       FROM grants gr WHERE gr.id=? AND gr.org_id=?`, [grantId, orgId]);
  if (!g || !g.award_pledge_id || !g.funder_donor_id) return null;
  const diff = cents(g.typed) - cents(g.recorded);
  if (diff <= 0) return null;
  const w = await W.recordGift({
    orgId, donorId: g.funder_donor_id, amount: diff / 100, date, type: "pledge payment",
    pledgeId: g.award_pledge_id, notes: NOTE, externalId: extId(grantId), conflict: "external",
    history: true, alreadyThanked: true, actorId, actorName, source: "grant_award",
  });
  if (!w || w.duplicate || !w.gift) return null;
  if (W.recalcPledgePayment) await W.recalcPledgePayment(g.award_pledge_id, orgId);
  return { giftId: w.gift.id, cents: diff };
}

module.exports = { typedReceivedToFirstPayment, extId };
