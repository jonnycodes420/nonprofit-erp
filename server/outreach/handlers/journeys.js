// JOBS-1 · gift.recorded → THE JOURNEY TRIGGERS A GIFT CAN FIRE (THREAD-2a,
// PARITY-1 Part D, moved here from recordGift):
//
//   first_gift          gift_count reached 1
//   gift_over           this gift clears the amount the ORG set
//   lapsed_return       they were marked lapsed and have just given
//   next_gift           any gift after the first
//   first_recurring     the first payment of their first recurring gift
//   membership_payment  a gift that paid for a membership
//
// ORDER is the priority order, not this list's: the engine replaces a
// lower-priority journey with a higher one, so a $25,000 first gift starts the
// first-gift journey and is then replaced by the major-donor one, with the
// reason written down.
//
// THEN THE GIFT'S THREAD (BUILD-81): a live gift a door says opens a thread
// ("Thank", +2 days) opens it here, after the journeys, so a journey's first
// step holds the thread when one starts, as it did when both ran in recordGift.
//
// Idempotent: every gift trigger is held to its gift (`gift:<id>`), once and
// only once, so a retry starts nothing twice, and a person has one open thread
// (openThreadTx's conflict). A journey the engine could not start for an error
// (not for a reason it can name) is tried again.
"use strict";
const OUTBOX = require("../../shared/outbox");
const { giftFacts, fires } = require("./giftFacts");

OUTBOX.on("gift.recorded", "journeys", async (raw, deps) => {
  // TEST_MODE only: a person whose address ends @jobs1-fail.test makes this
  // handler fail, so tests/jobs1-outbox.test.js can watch it retry and stop.
  if (process.env.TEST_MODE === "1") {
    const [t] = await deps.query(`SELECT 1 FROM donors WHERE id = ? AND email LIKE '%@jobs1-fail.test'`, [raw.donorId]);
    if (t) throw new Error("the journey engine is down (a test told it to be)");
  }
  const p = await giftFacts(raw, deps);
  if (!p) return;
  const failed = fires(p) && p.amount > 0 ? await startJourneys(p, deps) : [];
  if (p.thread) await deps.openGiftThread(p.orgId, p.donorId, { giftId: p.giftId, actorId: p.thread.actorId, actorName: p.thread.actorName });
  // SENDS-1: the gift's step is its thank-you; a task written for the same gift a moment earlier is voided.
  await require("../../shared/thankYouOnce").settleThankYous(p.orgId, p.donorId, p.giftId).catch(e => console.error("[thank-you] settle:", e.message));
  if (failed.length) throw new Error(`journeys: ${failed.join("; ")}`.slice(0, 480));
}, { applies: (p) => fires(p) || !!p.thread });

async function startJourneys(p, deps) {
  const gopts = { amountCents: p.cents, giftId: p.giftId, fundId: p.fundId || null, campaignId: p.campaignId || null,
                  importId: p.importId || null, armed: p.armedJourneys ? new Set(p.armedJourneys) : null };
  const failed = [];
  const start = async (trigger) => {
    const r = await deps.maybeStartJourneyFromServer(p.orgId, p.donorId, trigger, gopts);
    if (r && r.reason === "error") failed.push(`${trigger}: ${r.detail || "error"}`);
  };
  const count = Number(p.giftCount);
  if (count === 1) await start("first_gift");
  await start("gift_over");
  if (count > 1 && (p.status === "lapsed" || p.stage === "lapsed")) await start("lapsed_return");
  if (count > 1) await start("next_gift");
  if ((p.recurring === true || p.recurringSubscriptionId) && !p.priorRecurring) await start("first_recurring");
  if (p.appliedMembership) await start("membership_payment");
  return failed;
}
