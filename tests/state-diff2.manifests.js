// BUILD-44 Part 1 — B-series state-diff MANIFESTS (extends the BUILD-43 spec;
// same review discipline — see tests/state-diff.manifests.js header).
// Where a delta below encodes behavior that surprised us, it carries a
// FINDING comment and the full account lives in audit/BUILD-44-FINDINGS.md.

const FIX2 = {
  N_DONORS: 1530,
  N_GIFTS: 5738,
  CAMPAIGN: "Annual Fund",
  HOUSEHOLD: "The Wap Household",
  TODAY: new Date().toISOString().slice(0, 10),
  B1: { amount: 15000 },
  B2: { welcomeDonor: 300, majorDonor: 20, lapseDonor: 400, failDonor: 401 },
  B5: { member: 2 },
  B6: { donor: 3 },
  B7: { donor: 6, amount: 500 },
  B8: { donor: 7 },
  B10: { donors: [10, 11, 12, 13, 14] },
  B11: { donor: 402, monthly: 40 },
};

const APPEND_ONLY = [
  "^counts\\.interactions$",
  "^counts\\.moves$",
  "^counts\\.workflowRuns$",
  "^counts\\.notificationSends$",
  "^counts\\.recoveryEvents$",
  "^counts\\.receiptsVoided$",
  "^tasks\\.open$",
];

function buildManifests2(ctx) {
  const { fixture, em } = ctx;
  const lifeTotal = i => fixture[i].gifts.reduce((a, g) => a + g.amount, 0);
  const fyGiftTotal = i => fixture[i].gifts.filter(g => g.date >= "2025-07-01" && g.date <= "2026-06-30")
    .reduce((a, g) => a + g.amount, 0);
  const M = {};
  const B1 = FIX2.B1;

  // ── B1 grant lifecycle ──
  M.B1a = {
    expect: {
      "grants.prospecting.count": { d: 1 },
      "grants.prospecting.amount": { d: B1.amount },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  M.B1b = {
    expect: {
      "grants.prospecting.count": { d: -1 },
      "grants.prospecting.amount": { d: -B1.amount },
      "grants.applied.count": { d: 1 },
      "grants.applied.amount": { d: B1.amount },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // award: the ONE ledger stamp (uq_fin_txns_grant makes a double-book
  // impossible); money lands in cash + period revenue. The fixture grant is
  // NOT campaign-attributed, so no thermometer moves — one appearing fails.
  M.B1c = {
    expect: {
      "grants.applied.count": { d: -1 },
      "grants.applied.amount": { d: -B1.amount },
      "grants.awarded.count": { d: 1 },
      "grants.awarded.amount": { d: B1.amount },
      "counts.ledgerRows": { d: 1 },
      "counts.ledgerGrantLinked": { d: 1 },
      "finance.cashOnHand": { d: B1.amount },
      "finance.ytdRevenue": { d: B1.amount },
      "finance.fyYtdRevenue": { d: B1.amount },
      "finance.fundBalancesTotal": "any", // award stamp may or may not carry a fund — the CASH figure is the money assert
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // close: a WON grant moving on never drops its booking — ONLY the status
  // bucket moves; any money path appearing here fails the run.
  M.B1d = {
    expect: {
      "grants.awarded.count": { d: -1 },
      "grants.awarded.amount": { d: -B1.amount },
      "grants.closed.count": { d: 1 },
      "grants.closed.amount": { d: B1.amount },
      "tasks.open": { d: 1 }, // closing schedules "Follow up re: next cycle" (+6mo)
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };

  // ── B2 workflows ──
  // first gift on an unassigned donor: new_donor_welcome (branded thank-you
  // email to the DONOR — not a notification_sends row — + welcome-call task)
  // AND instant_gift_thanks (ED notify + thank task) both fire.
  M.B2a = {
    expect: {
      "counts.workflowRuns": { d: 2 },
      "tasks.open": { d: 2 },
      "counts.notificationSends": { d: 1 },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // $5,000 gift on an OFFICER-assigned donor: major_gift_alert (task to the
  // owner) + instant_gift_thanks. The one-email-per-person-per-event dedup
  // (event key gift:<dedup>) means the officer is notified ONCE even though
  // both recipes target them.
  M.B2b = {
    expect: {
      "counts.workflowRuns": { d: 2 },
      // 3 tasks: instant-thanks' thank task + major_gift_alert's TWO actions
      // (the owner-alert task AND the stewardship task)
      "tasks.open": { d: 3 },
      // 3 = instant-thanks ED (admin) + instant-thanks owner (officer) +
      // the major-alert's task-assignment email to the officer. Under the REAL
      // gift webhook the officer collapses to ONE email (gift:<giftId> event
      // key — pinned by notifications.test.js); simulate's synthetic dedupKey
      // gives the task-assignment path its own taskassign:<id> key, so the
      // simulate-path count is 3. Encoded as observed; see BUILD-44 FINDINGS
      // (Low) for the note.
      "counts.notificationSends": { d: 3 },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // lapsed → re-engage: tag + task, run logged.
  M.B2c = {
    expect: {
      "counts.workflowRuns": { d: 1 },
      "tasks.open": { d: 1 },
      "counts.tags": { d: 1 },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // recurring_failed → recovery recipe: recovery email (donor mail, no
  // notification row) + follow-up task.
  M.B2d = {
    expect: {
      "counts.workflowRuns": { d: 1 },
      "tasks.open": { d: 1 },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // the SAME dedupKey refired: a strict no-op — the empty manifest IS the
  // double-send guarantee, org-wide.
  M.B2e = { expect: {}, allow: [], reversalExclude: APPEND_ONLY };

  // ── B3 tasks ──
  M.B3a = {
    expect: {
      "tasks.open": { d: 1 },
      "counts.notificationSends": { d: 1 }, // assignee ≠ creator → one email
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  M.B3b = {
    expect: { "tasks.open": { d: -1 }, "tasks.done": { d: 1 } },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // admin reassigns the task to THEMSELF: reassignment-to-actor is
  // deliberately silent (no email) — a notification delta here fails.
  M.B3c = { expect: {}, allow: [], reversalExclude: APPEND_ONLY };

  // ── B4 goals ──
  M.B4a = {
    expect: {
      "fundraising.rollup.totalGoal": { d: 50000 },
      "fundraising.rollup.activeGoalCount": { d: 1 },
      "fundraising.goals.Sweep Goal.raised": { to: 0 },
      "fundraising.goals.Sweep Goal.giftRaised": { to: 0 },
      "fundraising.goals.Sweep Goal.grantAwarded": { to: 0 },
      "fundraising.goals.Sweep Goal.pledged": { to: 0 },
      "fundraising.goals.Sweep Goal.pledgeCount": { to: 0 },
      "fundraising.goals.Sweep Goal.donorCount": { to: 0 },
      "fundraising.goals.Sweep Goal.goalAmount": { to: 50000 },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  // the child appears as a goal ENTRY but the top-level rollup must not
  // double-count it: totalGoal and activeGoalCount stay put ({d:0}).
  M.B4b = {
    expect: {
      "fundraising.rollup.totalGoal": { d: 0 },
      "fundraising.rollup.activeGoalCount": { d: 0 },
      "fundraising.goals.Sweep Child.raised": { to: 0 },
      "fundraising.goals.Sweep Child.giftRaised": { to: 0 },
      "fundraising.goals.Sweep Child.grantAwarded": { to: 0 },
      "fundraising.goals.Sweep Child.pledged": { to: 0 },
      "fundraising.goals.Sweep Child.pledgeCount": { to: 0 },
      "fundraising.goals.Sweep Child.donorCount": { to: 0 },
      "fundraising.goals.Sweep Child.goalAmount": { to: 20000 },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  M.B4c = {
    expect: {
      "fundraising.rollup.totalGoal": { d: 10000 },
      "fundraising.goals.Sweep Goal.goalAmount": { d: 10000 },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };

  // ── B5 household member add: combined giving = Σ members' HARD credit
  //    (soft credit is DERIVED — this figure is the soft-credit surface;
  //    org totals must NOT move, which the no-unexpected-delta rule enforces) ──
  M.B5a = {
    expect: {
      [`households.${FIX2.HOUSEHOLD}.members`]: { d: 1 },
      [`households.${FIX2.HOUSEHOLD}.combined`]: { d: lifeTotal(FIX2.B5.member) },
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };

  // ── B6 designation ──
  M.B6 = { expect: { "counts.designations": { d: 1 } }, allow: [], reversalExclude: APPEND_ONLY };

  // ── B7 restricted fund ──
  M.B7a = { expect: {}, allow: [], reversalExclude: APPEND_ONLY }; // an empty fund moves no money
  const b7 = FIX2.B7, b7email = em(b7.donor);
  M.B7b = {
    expect: {
      [`donors.perDonor.${b7email}.total`]: { d: b7.amount },
      [`donors.perDonor.${b7email}.gifts`]: { d: 1 },
      "donors.totalGiving": { d: b7.amount },
      "donors.giftCount": { d: 1 },
      "counts.giftsRows": { d: 1 },
      "counts.giftsSum": { d: b7.amount },
      "counts.ledgerRows": { d: 1 },
      "counts.ledgerGiftLinked": { d: 1 },
      "counts.interactions": { d: 1 },
      // the routing assert: the money lands in the RESTRICTED bucket
      "finance.restrictedTotal": { d: b7.amount },
      "finance.cashOnHand": { d: b7.amount },
      "finance.ytdRevenue": { d: b7.amount },
      "finance.fyYtdRevenue": { d: b7.amount },
      "finance.giftHistoryTotal": { d: b7.amount },
      "finance.fundBalancesTotal": { d: b7.amount },
      "fundraising.period.raised": { d: b7.amount },
      "fundraising.period.giftCount": { d: 1 },
      "fundraising.period.donorCount": { d: 1 },
      "fundraising.thisWeek.raised": { d: b7.amount },
      "fundraising.thisWeek.giftCount": { d: 1 },
      "reports.summaryFY.total": { d: b7.amount },
      "reports.summaryFY.giftCount": { d: 1 },
      "reports.summaryFY.uniqueDonors": { d: 1 },
      "reports.summaryFY.returningDonors": { d: 1 },
      "reports.annual.total": { d: b7.amount },
      "reports.annual.giftCount": { d: 1 },
      "reports.annual.uniqueDonors": { d: 1 },
      "reports.sybunt.count": { d: -1 },
    },
    allow: ["^reports\\.annual\\.growthPct$"],
    reversalExclude: APPEND_ONLY,
  };
  M.B7b.expect["reports.lybunt.count"] = { d: -1 };            // donor 6 is a band donor
  M.B7b.expect["reports.lybunt.priorTotal"] = { d: -fyGiftTotal(FIX2.B7.donor) };

  // ── B8 planned giving (the interaction is the donor-timeline record) ──
  M.B8 = {
    expect: { "counts.plannedGifts": { d: 1 }, "counts.interactions": { d: 1 } },
    allow: [], reversalExclude: APPEND_ONLY,
  };

  // ── B9 branding: ZERO numeric movement anywhere. This is the whole point. ──
  M.B9 = { expect: {}, allow: [], reversalExclude: [] };

  // ── B10 bulk reassign ──
  const b10total = FIX2.B10.donors.reduce((a, i) => a + lifeTotal(i), 0);
  M.B10 = {
    expect: Object.assign(
      {
        "officers.wap2-officer@example.org.count": { d: -5 },
        "officers.wap2-officer@example.org.giving": { d: -b10total },
        "officers.wap2-admin@example.org.count": { d: 5 },
        "officers.wap2-admin@example.org.giving": { d: b10total },
      },
      ...FIX2.B10.donors.map(i => ({ [`donors.perDonor.${em(i)}.assigned`]: { to: "u_wap2_admin" } }))
    ),
    allow: [], reversalExclude: APPEND_ONLY,
  };

  // ── B11 recurring created / canceled (NO pause state exists — FINDINGS) ──
  M.B11a = {
    expect: {
      "counts.subsActive": { d: 1 },
      "recurring.active": { d: 1 },
      "tasks.open": { d: 1 }, // the welcome task
      [`donors.perDonor.${em(FIX2.B11.donor)}.stage`]: { to: "steward" }, // a lapsed donor starting a subscription steps to steward
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };
  M.B11b = {
    expect: {
      "counts.subsActive": { d: -1 },
      "counts.subsCanceled": { d: 1 },
      "recurring.active": { d: -1 },
      "counts.recoveryEvents": { d: 1 }, // subscription_canceled logged (the "lost" outcome)
    },
    allow: [], reversalExclude: APPEND_ONLY,
  };

  // ── B12 year-end statements ──
  M.B12a = { expect: { "counts.receiptsActive": { d: 1 } }, allow: [], reversalExclude: null };
  // regenerate = SUPERSEDE: the prior statement is voided, exactly one active
  // remains (receiptsActive net 0 — enforced by absence), voided history +1.
  M.B12b = { expect: { "counts.receiptsVoided": { d: 1 } }, allow: [], reversalExclude: null };

  return M;
}

module.exports = { FIX2, buildManifests2 };
