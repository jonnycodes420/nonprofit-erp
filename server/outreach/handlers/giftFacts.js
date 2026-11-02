// JOBS-1 · THE FACTS A GIFT'S TRIGGERS ARE DECIDED ON (not a handler: the
// sequences and journeys handlers share it).
//
// recordGift states them in its event once the rollup has happened, which is
// where the triggers always read them: "first gift" is gift_count reaching 1,
// "lapsed return" a lapsed status at the moment the gift landed. A handler
// that runs later must not read them again, or a second gift that landed in
// between would make the first one look like a next gift.
//
// An event whose door died before stating them (not `ready`) is decided on the
// record as it stands now, which is the best answer left.
"use strict";

// A gift removed before its handlers ran (an undo, a delete) starts nothing.
async function giftFacts(p, { query }) {
  const [g] = await query(`SELECT id FROM gifts WHERE id = ? AND org_id = ?`, [p.giftId, p.orgId]);
  if (!g) return null;
  if (p.ready) return p;
  const [d] = await query(
    `SELECT d.gift_count, d.stage, d.status, d.stripe_subscription_status,
            (SELECT COUNT(*)::int FROM gifts x WHERE x.org_id = d.org_id AND x.donor_id = d.id AND x.id <> ?
                AND (x.notes ILIKE '%recurring%' OR x.type = 'recurring')) AS prior_recurring_noted,
            (SELECT COUNT(*)::int FROM gifts x WHERE x.org_id = d.org_id AND x.donor_id = d.id AND x.id <> ? AND x.amount > 0
                AND (x.recurring_subscription_id IS NOT NULL OR x.type = 'recurring')) AS prior_recurring,
            EXISTS (SELECT 1 FROM gifts x WHERE x.id = ? AND x.type = 'pledge payment') AS installment
       FROM donors d WHERE d.id = ? AND d.org_id = ?`, [p.giftId, p.giftId, p.giftId, p.donorId, p.orgId]);
  if (!d) return null;
  return { ...p, giftCount: Number(d.gift_count), status: d.status, stage: d.stage, subscriptionStatus: d.stripe_subscription_status || null,
           priorRecurringNoted: d.prior_recurring_noted, priorRecurring: d.prior_recurring, appliedInstallment: d.installment,
           appliedMembership: false };
}

// The live gift triggers: never for history, an import, or a gift already
// thanked elsewhere (FIX-36, SEND-GATE-1, FIX-37).
const fires = (p) => !p.oldHistory && !p.thankedElsewhere && !p.fromImport;

module.exports = { giftFacts, fires };
