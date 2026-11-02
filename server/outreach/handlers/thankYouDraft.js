// JOBS-1 · gift.recorded → THE THANK-YOU DRAFT (BUILD-88b B.3, moved here
// from recordGift). Drafted, never sent: every gift through the one gift path
// earns a draft in her queue. The exclusions are the ones that would make a
// thank-you wrong rather than merely unnecessary.
//
// The small-pledge-payment exclusion reads the gift's TYPE as it stood after
// the instalment apply (a gift that arrives as "cash" and is recognised as an
// instalment is a pledge payment), which recordGift states in the event.
//
// Idempotent: one draft per gift (queueThankYouDraft's conflict key), so a
// retry or a second run drafts nothing new. A gift removed before this ran
// (an undo) gets no draft.
"use strict";
const OUTBOX = require("../../shared/outbox");

OUTBOX.on("gift.recorded", "thankYouDraft", async (p, deps) => {
  const [g] = await deps.query(`SELECT type FROM gifts WHERE id = ? AND org_id = ?`, [p.giftId, p.orgId]);
  if (!g) return;
  const installment = p.ready ? p.appliedInstallment : g.type === "pledge payment";
  await deps.queueThankYouDraft(p.orgId, { giftId: p.giftId, donorId: p.donorId, cents: p.cents, fundId: p.fundId,
    type: installment ? "pledge payment" : (p.type || "cash"), tribute: p.tribute || null });
}, { applies: (p) => p.thankYou && !p.oldHistory && !p.thankedElsewhere });
