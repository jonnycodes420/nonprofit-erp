// JOBS-1 · gift.recorded → THE SEQUENCE TRIGGERS (BUILD-94 Part 3, moved here
// from recordGift). FIRST GIFT EVER is gift_count reaching 1, read by
// recordGift from the row its rollup wrote. ENROLLMENT IS NEVER RETROACTIVE:
// the only way in is the event itself.
//
// Idempotent: an enrollment is one row per (sequence, person), ON CONFLICT DO
// NOTHING. A sequence that could not enroll is an error the queue tries again.
"use strict";
const OUTBOX = require("../../shared/outbox");
const { giftFacts, fires } = require("./giftFacts");

OUTBOX.on("gift.recorded", "sequences", async (raw, deps) => {
  const p = await giftFacts(raw, deps);
  if (!p) return;
  const armed = (key) => !p.armedSequences || p.armedSequences.includes(key);
  const errors = [];
  const enroll = async (key, ctx) => {
    const r = await deps.enrollInSequences(p.orgId, p.donorId, key, ctx);
    if (r && r.errors && r.errors.length) errors.push(...r.errors);
  };
  if (p.giftCount === 1 && armed("first_gift")) {
    await enroll("first_gift", { amount: p.amount, recurring: p.recurring || !!p.subscriptionStatus, fund: p.fundName, source: p.source });
  }
  if (p.recurring === true && !p.priorRecurringNoted && armed("first_recurring")) {
    await enroll("first_recurring", { amount: p.amount, recurring: true, fund: p.fundName, source: p.source });
  }
  if (errors.length) throw new Error(`sequences: ${errors.join("; ")}`.slice(0, 480));
}, { applies: fires });
