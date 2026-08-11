// BUILD-43 — the state-diff MANIFESTS. These are the spec.
//
// Each canonical action declares EXACTLY which numbers across the whole org
// may move, and by how much. The harness (tests/state-diff.test.js) snapshots
// the entire org before and after the action and asserts the diff equals the
// manifest: an unexpected non-zero delta ANYWHERE fails (double-counting), a
// declared delta that didn't occur fails (dead wire).
//
// REVIEW DISCIPLINE: when a code change makes one of these manifests wrong,
// the fix is to change the manifest IN THE SAME PR with a comment saying why
// the new movement is correct — never to loosen an assertion to green the
// build. A manifest edit is a statement that the product's money-flow
// contract changed; treat the diff of this file like a schema migration.
//
// Manifest shape:
//   expect: { "<flattened path>": {d: N} exact delta | {to: v} exact new
//             value | "any" (may change, value not asserted — every "any"
//             carries a comment saying why exactness isn't possible) }
//   allow:  [regex] — paths PERMITTED to change without per-path assertion
//           (used for derived floats like retention %, never for money)
//   reversalExclude: [regex] — append-only paths a reversal legitimately
//           leaves behind (audit trails). Every entry is a decision.
//
// Fixture facts the deltas derive from (see makeFixture in the harness):
//   1,530 donors / 5,738 gifts, seeded LCG (byte-stable). All gifts
//   historical (2020-01..2025-06) EXCEPT donors 0..99 whose last gift is
//   forced to 2026-05-15 (FY2026, <90d → stage steward; everyone else is
//   lapsed). So at baseline: FY2027 (current) totals are ZERO, LYBUNT(FY2027)
//   = exactly the 0..99 band, SYBUNT = all 1,530, Week-in-Review = zero.
//   Donors 10..49 are assigned to the officer, 50..89 to the admin.
//
// WEEK-IN-REVIEW FACT (discovery-run): /digests/preview composes the most
// recently COMPLETED week, so an action taken today NEVER appears in it —
// wir.* must stay FROZEN in every manifest, and the no-unexpected-delta
// property enforces exactly that.

const FIX = {
  N_DONORS: 1530,
  N_GIFTS: 5738,
  CAMPAIGN: "Annual Fund",
  HOUSEHOLD: "The Wap Household",
  TODAY: new Date().toISOString().slice(0, 10),
  A1: { donor: 5, amount: 500 },        // steward band, unassigned, low total
  A2: {
    donors: [
      { name: "Import Alpha", email: "wap-import-a@example.org" },
      { name: "Import Beta", email: "wap-import-b@example.org" },
      { name: "Import Gamma", email: "wap-import-c@example.org" },
    ],
    // historical dates ONLY — historical imports deliberately never stamp the
    // ledger (Option A, BUILD-26), which is what makes this action cleanly
    // reversible via trash+purge (purge leaves fin_transactions alone).
    gifts: [
      { donorIndex: 0, amount: 100, date: "2023-03-10" },
      { donorIndex: 0, amount: 150, date: "2024-04-10" },
      { donorIndex: 1, amount: 200, date: "2022-05-10" },
      { donorIndex: 1, amount: 250, date: "2025-02-10" },
      { donorIndex: 2, amount: 300, date: "2021-06-10" },
    ],
  },
  A3: { pi: "pi_wap_a3", amount: 120, email: "wap-online@example.org", name: "Online Olive" },
  A4: { sub: "sub_wap_a4", monthly: 25 },
  A5: { pi: "pi_wap_a5", amount: 280, refund: 200 },
  A6: { donor: 205, amount: 300, newAmount: 750, oldDate: "2026-01-15" },
  A7: { donor: 15 },                     // officer's portfolio → admin → back
  A8: { donor: 20, ask: 10000 },         // officer's portfolio
  A9: { donor: 60, pledge: 1200, payment: 400 }, // admin's portfolio
  A10: { donor: 200 },                   // lapsed, unassigned, has gifts
};

// Append-only trails a reversal legitimately leaves behind. Interactions are
// HERE deliberately: the product logs gift/stage-change/note interactions and
// deleting the underlying object keeps the timeline entry — that's the audit
// trail working, not a leak. (If a reversal leaves anything OUTSIDE these,
// the test fails — that's the point.)
const APPEND_ONLY = [
  "^counts\\.interactions$",
  "^counts\\.moves$",
  "^counts\\.workflowRuns$",
  "^counts\\.notificationSends$",
  "^counts\\.recoveryEvents$",
  "^counts\\.receiptsVoided$",
  "^tasks\\.open$",            // workflow-created thank/steward tasks survive
];

function buildManifests(ctx) {
  const { fixture, em } = ctx;
  const donorOf = i => fixture[i];
  const fyGiftTotal = i => donorOf(i).gifts.filter(g => g.date >= "2025-07-01" && g.date <= "2026-06-30")
    .reduce((a, g) => a + g.amount, 0);
  const attributed = i => donorOf(i).gifts.some(g => g.campaign === FIX.CAMPAIGN);
  const lifeTotal = i => donorOf(i).gifts.reduce((a, g) => a + g.amount, 0);

  const M = {};

  // ── A1: log a manual gift ($500, today, campaign-attributed, steward donor,
  //        unassigned → instant_gift_thanks notifies the ED, creates a task) ──
  const a1 = FIX.A1, a1email = em(a1.donor);
  M.A1 = {
    expect: {
      [`donors.perDonor.${a1email}.total`]: { d: a1.amount },
      [`donors.perDonor.${a1email}.gifts`]: { d: 1 },
      "donors.totalGiving": { d: a1.amount },
      "donors.giftCount": { d: 1 },
      "counts.giftsRows": { d: 1 },
      "counts.giftsSum": { d: a1.amount },
      "counts.ledgerRows": { d: 1 },            // current-period gift stamps once
      "counts.ledgerGiftLinked": { d: 1 },
      "counts.interactions": { d: 1 },          // the gift interaction
      "counts.workflowRuns": { d: 1 },          // instant_gift_thanks fires once
      "counts.notificationSends": { d: 1 },     // ED notified once
      "tasks.open": { d: 1 },                   // the thank task
      [`fundraising.goals.${FIX.CAMPAIGN}.raised`]: { d: a1.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.giftRaised`]: { d: a1.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.donorCount`]: { d: attributed(a1.donor) ? 0 : 1 },
      "fundraising.rollup.totalRaised": { d: a1.amount },
      "fundraising.period.raised": { d: a1.amount },
      "fundraising.period.giftCount": { d: 1 },
      "fundraising.period.donorCount": { d: 1 },
      "fundraising.thisWeek.raised": { d: a1.amount },
      "fundraising.thisWeek.giftCount": { d: 1 },
      "reports.summaryFY.total": { d: a1.amount },
      "reports.summaryFY.giftCount": { d: 1 },
      "reports.summaryFY.uniqueDonors": { d: 1 },
      "reports.summaryFY.returningDonors": { d: 1 }, // gave before → returning
      "reports.annual.total": { d: a1.amount },
      "reports.annual.giftCount": { d: 1 },
      "reports.annual.uniqueDonors": { d: 1 },
      "reports.lybunt.count": { d: -1 },             // donor 5 leaves LYBUNT
      "reports.lybunt.priorTotal": { d: -fyGiftTotal(a1.donor) },
      "reports.sybunt.count": { d: -1 },
      "finance.cashOnHand": { d: a1.amount },
      "finance.ytdRevenue": { d: a1.amount },
      "finance.giftHistoryTotal": { d: a1.amount },
      "finance.fundBalancesTotal": { d: a1.amount },
      "finance.fyYtdRevenue": { d: a1.amount },
    },
    allow: [
      // annual growthPct is derived from total (asserted above) vs prior —
      // a ratio, not money; exact float asserted implicitly via total.
      "^reports\\.annual\\.growthPct$",
    ],
    reversalExclude: APPEND_ONLY,
  };

  // ── A2: import 3 donors + 5 HISTORICAL gifts (no ledger stamps, no
  //        workflow fires — imports must never fire donor-facing machinery) ──
  const a2Total = FIX.A2.gifts.reduce((a, g) => a + g.amount, 0);
  M.A2 = {
    expect: {
      "donors.count": { d: 3 },
      "donors.totalGiving": { d: a2Total },
      "donors.giftCount": { d: 5 },
      "counts.giftsRows": { d: 5 },
      "counts.giftsSum": { d: a2Total },
      "finance.giftHistoryTotal": { d: a2Total }, // Reports-side giving, ledger untouched
      // the three new per-donor entries appear
      "donors.perDonor.wap-import-a@example.org.total": { to: 250 },
      "donors.perDonor.wap-import-a@example.org.gifts": { to: 2 },
      "donors.perDonor.wap-import-a@example.org.stage": "any", // inferStage output — pinned by import-stage.test.js
      "donors.perDonor.wap-import-a@example.org.assigned": { to: null },
      "donors.perDonor.wap-import-a@example.org.deleted": { to: false },
      "donors.perDonor.wap-import-b@example.org.total": { to: 450 },
      "donors.perDonor.wap-import-b@example.org.gifts": { to: 2 },
      "donors.perDonor.wap-import-b@example.org.stage": "any",
      "donors.perDonor.wap-import-b@example.org.assigned": { to: null },
      "donors.perDonor.wap-import-b@example.org.deleted": { to: false },
      "donors.perDonor.wap-import-c@example.org.total": { to: 300 },
      "donors.perDonor.wap-import-c@example.org.gifts": { to: 1 },
      "donors.perDonor.wap-import-c@example.org.stage": "any",
      "donors.perDonor.wap-import-c@example.org.assigned": { to: null },
      "donors.perDonor.wap-import-c@example.org.deleted": { to: false },
      "counts.interactions": { d: 5 },  // the import logs one gift interaction per gift
      // None of the five gifts land in FY2026 (2025-02-10 is FY2025), so
      // LYBUNT is untouched; SYBUNT gains all 3.
      "reports.sybunt.count": { d: 3 },
    },
    allow: [
      // retention's completed-year cohorts shift when historical donors enter
      // prior years; rates are ratios re-derived from the counted years.
      "^reports\\.retention\\.",
    ],
    reversalExclude: APPEND_ONLY,
  };

  // ── A3: online gift via signed Stripe webhook — NEW donor, receipts on ──
  const a3 = FIX.A3;
  M.A3 = {
    expect: {
      "donors.count": { d: 1 },
      "donors.totalGiving": { d: a3.amount },
      "donors.giftCount": { d: 1 },
      [`donors.perDonor.${a3.email}.total`]: { to: a3.amount },
      [`donors.perDonor.${a3.email}.gifts`]: { to: 1 },
      [`donors.perDonor.${a3.email}.stage`]: { to: "steward" }, // a new online donor lands in steward
      [`donors.perDonor.${a3.email}.assigned`]: { to: null },
      [`donors.perDonor.${a3.email}.deleted`]: { to: false },
      "counts.giftsRows": { d: 1 },
      "counts.giftsSum": { d: a3.amount },
      "counts.ledgerRows": { d: 1 },
      "counts.ledgerGiftLinked": { d: 1 },
      "counts.receiptsActive": { d: 1 },        // auto-receipt (org enabled)
      "counts.workflowRuns": { d: 1 },
      "counts.notificationSends": { d: 1 },
      "tasks.open": { d: 2 },                   // the webhook's own thank task + the workflow's
      [`fundraising.goals.${FIX.CAMPAIGN}.raised`]: { d: a3.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.giftRaised`]: { d: a3.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.donorCount`]: { d: 1 },
      "fundraising.rollup.totalRaised": { d: a3.amount },
      "fundraising.period.raised": { d: a3.amount },
      "fundraising.period.giftCount": { d: 1 },
      "fundraising.period.donorCount": { d: 1 },
      "fundraising.thisWeek.raised": { d: a3.amount },
      "fundraising.thisWeek.giftCount": { d: 1 },
      "reports.summaryFY.total": { d: a3.amount },
      "reports.summaryFY.giftCount": { d: 1 },
      "reports.summaryFY.uniqueDonors": { d: 1 },
      "reports.summaryFY.newDonors": { d: 1 },  // first-ever gift in period
      "reports.summaryFY.onlineTotal": { d: a3.amount },
      "reports.summaryFY.onlineCount": { d: 1 },
      "reports.annual.total": { d: a3.amount },
      "reports.annual.giftCount": { d: 1 },
      "reports.annual.uniqueDonors": { d: 1 },
      "reports.annual.newDonors": { d: 1 },
      "finance.cashOnHand": { d: a3.amount },
      "finance.ytdRevenue": { d: a3.amount },
      "finance.giftHistoryTotal": { d: a3.amount },
      "finance.fundBalancesTotal": { d: a3.amount },
      "finance.fyYtdRevenue": { d: a3.amount },
      "counts.interactions": { d: 1 },          // the gift interaction
    },
    allow: ["^reports\\.annual\\.growthPct$"],
    reversalExclude: APPEND_ONLY, // reversed by A5a (the refund)
  };

  // ── A4a: recurring subscription created (checkout.session.completed) ──
  M.A4a = {
    expect: {
      "counts.subsActive": { d: 1 },
      "recurring.active": { d: 1 },
      "tasks.open": { d: 1 },                   // "Welcome … as a recurring donor" task
    },
    allow: [],
    reversalExclude: APPEND_ONLY,
  };

  // ── A4b: the card fails (invoice.payment_failed) ──
  M.A4b = {
    expect: {
      "counts.subsActive": { d: -1 },
      "counts.subsPastDue": { d: 1 },
      "recurring.active": { d: -1 },
      "recurring.atRisk": { d: 1 },
      "recurring.mrrAtRisk": { d: FIX.A4.monthly },
      "counts.recoveryEvents": { d: 1 },        // payment_failed logged
    },
    allow: [],
    reversalExclude: APPEND_ONLY,
  };

  // ── A5a: FULL refund of the A3 online gift — everything A3 added comes
  //        back out in one webhook: gift + ledger row deleted, donor totals
  //        recalced, receipt auto-VOIDED (the void survives as history) ──
  const a3d = FIX.A3;
  M.A5a = {
    expect: {
      "donors.totalGiving": { d: -a3d.amount },
      "donors.giftCount": { d: -1 },
      [`donors.perDonor.${a3d.email}.total`]: { d: -a3d.amount },
      [`donors.perDonor.${a3d.email}.gifts`]: { d: -1 },
      "counts.giftsRows": { d: -1 },
      "counts.giftsSum": { d: -a3d.amount },
      "counts.ledgerRows": { d: -1 },
      "counts.ledgerGiftLinked": { d: -1 },
      "counts.receiptsActive": { d: -1 },
      "counts.receiptsVoided": { d: 1 },
      "counts.interactions": { d: 1 },          // the refund note on the donor
      [`fundraising.goals.${FIX.CAMPAIGN}.raised`]: { d: -a3d.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.giftRaised`]: { d: -a3d.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.donorCount`]: { d: -1 },
      "fundraising.rollup.totalRaised": { d: -a3d.amount },
      "fundraising.period.raised": { d: -a3d.amount },
      "fundraising.period.giftCount": { d: -1 },
      "fundraising.period.donorCount": { d: -1 },
      "fundraising.thisWeek.raised": { d: -a3d.amount },
      "fundraising.thisWeek.giftCount": { d: -1 },
      "reports.summaryFY.total": { d: -a3d.amount },
      "reports.summaryFY.giftCount": { d: -1 },
      "reports.summaryFY.uniqueDonors": { d: -1 },
      "reports.summaryFY.newDonors": { d: -1 },
      "reports.summaryFY.onlineTotal": { d: -a3d.amount },
      "reports.summaryFY.onlineCount": { d: -1 },
      "reports.annual.total": { d: -a3d.amount },
      "reports.annual.giftCount": { d: -1 },
      "reports.annual.uniqueDonors": { d: -1 },
      "reports.annual.newDonors": { d: -1 },
      "finance.cashOnHand": { d: -a3d.amount },
      "finance.ytdRevenue": { d: -a3d.amount },
      "finance.giftHistoryTotal": { d: -a3d.amount },
      "finance.fundBalancesTotal": { d: -a3d.amount },
      "finance.fyYtdRevenue": { d: -a3d.amount },
    },
    allow: ["^reports\\.annual\\.growthPct$"],
    reversalExclude: APPEND_ONLY,
  };

  // ── A5b: PARTIAL refund — the gift SHRINKS to what the org kept ──
  const a5 = FIX.A5, kept = a5.amount - a5.refund;
  M.A5b = {
    expect: {
      "donors.totalGiving": { d: -a5.refund },
      [`donors.perDonor.${a3d.email}.total`]: { d: -a5.refund },
      "counts.giftsSum": { d: -a5.refund },
      "reports.summaryFY.total": { d: -a5.refund },
      "reports.summaryFY.onlineTotal": { d: -a5.refund },
      "reports.annual.total": { d: -a5.refund },
      "finance.cashOnHand": { d: -a5.refund },
      "finance.ytdRevenue": { d: -a5.refund },
      "finance.giftHistoryTotal": { d: -a5.refund },
      "finance.fundBalancesTotal": { d: -a5.refund },
      "finance.fyYtdRevenue": { d: -a5.refund },
      "fundraising.period.raised": { d: -a5.refund },
      "fundraising.thisWeek.raised": { d: -a5.refund },
      "counts.interactions": { d: 1 },          // the partial-refund note
    },
    allow: ["^reports\\.annual\\.growthPct$"],
    reversalExclude: APPEND_ONLY,
  };

  // ── A6a/b/c: gift edits (amount / date / campaign) ──
  const a6 = FIX.A6, dAmt = a6.newAmount - a6.amount, a6email = em(a6.donor);
  M.A6a = {
    expect: {
      [`donors.perDonor.${a6email}.total`]: { d: dAmt },
      "donors.totalGiving": { d: dAmt },
      "counts.giftsSum": { d: dAmt },
      "reports.summaryFY.total": { d: dAmt },
      "reports.annual.total": { d: dAmt },
      // the gift's LEDGER STAMP moves with the edit (BUILD-43 fix — it used
      // to stay at the old amount and Cash on Hand desynced silently)
      "finance.cashOnHand": { d: dAmt },
      "finance.ytdRevenue": { d: dAmt },
      "finance.giftHistoryTotal": { d: dAmt },
      "finance.fundBalancesTotal": { d: dAmt },
      "finance.fyYtdRevenue": { d: dAmt },
      "fundraising.period.raised": { d: dAmt },
      "fundraising.thisWeek.raised": { d: dAmt },
    },
    allow: ["^reports\\.annual\\.growthPct$"],
    reversalExclude: APPEND_ONLY,
  };
  // date: today (FY2027, this week) → 2026-01-15 (FY2026, historical). The
  // money doesn't move; WHICH period holds it does — current-FY and WiR drop,
  // LYBUNT/retention cohorts re-derive (the donor now gave in FY2026).
  M.A6b = {
    expect: {
      "reports.summaryFY.total": { d: -a6.amount },
      "reports.summaryFY.giftCount": { d: -1 },
      "reports.summaryFY.uniqueDonors": { d: -1 },
      "reports.summaryFY.returningDonors": { d: -1 },
      "reports.annual.total": { d: -a6.amount },
      "reports.annual.giftCount": { d: -1 },
      "reports.annual.uniqueDonors": { d: -1 },
      "fundraising.period.raised": { d: -a6.amount },
      "fundraising.period.giftCount": { d: -1 },
      "fundraising.period.donorCount": { d: -1 },
      "fundraising.thisWeek.raised": { d: -a6.amount },
      "fundraising.thisWeek.giftCount": { d: -1 },
      // donor's only FY-current gift moved to FY2026 → they join LYBUNT/SYBUNT
      "reports.lybunt.count": { d: 1 },
      "reports.lybunt.priorTotal": { d: a6.amount },
      "reports.sybunt.count": { d: 1 },
      // the ledger stamp's DATE follows the gift (BUILD-43 fix). The default
      // /finance/summary lens is CALENDAR — 2026-01-15 stays inside CY2026,
      // so calendar ytdRevenue must NOT move ({d:0}) while the FISCAL lens
      // drops. cashOnHand/fundBalances are ALL-TIME: frozen by absence.
      "finance.ytdRevenue": { d: 0 },
      "finance.fyYtdRevenue": { d: -a6.amount },
    },
    allow: ["^reports\\.annual\\.growthPct$", "^reports\\.retention\\."],
    reversalExclude: APPEND_ONLY,
  };
  M.A6c = {
    expect: {
      [`fundraising.goals.${FIX.CAMPAIGN}.raised`]: { d: a6.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.giftRaised`]: { d: a6.amount },
      [`fundraising.goals.${FIX.CAMPAIGN}.donorCount`]: { d: attributed(a6.donor) ? 0 : 1 },
      "fundraising.rollup.totalRaised": { d: a6.amount },
    },
    allow: [],
    reversalExclude: APPEND_ONLY,
  };

  // ── A7: reassign a donor officer → admin (assignment IS portfolio IS board) ──
  const a7 = FIX.A7, a7email = em(a7.donor), a7total = lifeTotal(a7.donor);
  M.A7 = {
    expect: {
      [`donors.perDonor.${a7email}.assigned`]: { to: "u_wap_admin" },
      [`officers.${"wap-officer@example.org"}.count`]: { d: -1 },
      [`officers.${"wap-officer@example.org"}.giving`]: { d: -a7total },
      [`officers.${"wap-admin@example.org"}.count`]: { d: 1 },
      [`officers.${"wap-admin@example.org"}.giving`]: { d: a7total },
    },
    allow: [],
    reversalExclude: APPEND_ONLY,
  };

  // ── A8: pipeline move + an ask ──
  M.A8 = (fromStage, toStage) => ({
    expect: {
      [`donors.perDonor.${em(FIX.A8.donor)}.stage`]: { to: toStage },
      [`pipeline.counts.${fromStage}`]: { d: -1 },
      [`pipeline.counts.${toStage}`]: { d: 1 },
      "counts.moves": { d: 1 },
      "counts.interactions": { d: 1 },          // stage_change interaction
      "counts.opportunitiesOpen": { d: 1 },
      "pipeline.forecastOpen": { d: FIX.A8.ask },
      "pipeline.forecastWeighted": "any",       // ask × stage weight — weight moves WITH the stage; forecast.open is the exact-money assert
      "reports.solicitations.open": { d: FIX.A8.ask },
      "reports.solicitations.weighted": "any",
      "reports.solicitations.byOfficer.Wap Officer.openAsks": { d: 1 },
      "reports.solicitations.byOfficer.Wap Officer.openAskAmount": { d: FIX.A8.ask },
      "reports.solicitations.byOfficer.Wap Officer.asksMade": { d: 1 },
    },
    allow: ["^reports\\.solicitations\\.byStage"],
    reversalExclude: APPEND_ONLY,
  });

  // ── A9a: record a pledge (campaign-attributed) ──
  M.A9a = {
    expect: {
      "counts.pledgesOpen": { d: 1 },
      "counts.pledgesOpenTotal": { d: FIX.A9.pledge },
      "reports.solicitations.openPledges": { d: 1 },
      "reports.solicitations.openPledgeTotal": { d: FIX.A9.pledge },
      [`fundraising.goals.${FIX.CAMPAIGN}.pledged`]: { d: FIX.A9.pledge },
      [`fundraising.goals.${FIX.CAMPAIGN}.pledgeCount`]: { d: 1 },
    },
    allow: [],
    reversalExclude: APPEND_ONLY,
  };
  // ── A9b: a $400 payment against the $1,200 pledge — the gift INHERITS the
  //        pledge's campaign; pledged → raised converts exactly once ──
  const a9 = FIX.A9, a9email = em(a9.donor);
  // BUILD-45 §1.2 F-5 (REVIEWED MANIFEST EDIT — money-contract change): a
  // partial payment applies against the pledge BALANCE. The $400 gift leaves
  // the $1,200 pledge OPEN with an honest $800 remaining — open-pledge COUNT
  // and face-amount total don't move; every "pledged" figure (solicitations
  // openPledgeTotal, campaign pledged) drops by exactly the $400 paid, so
  // pledged → raised converts as money arrives, never all-at-once. (The old
  // manifest encoded the single-payment model this fix retires: any payment
  // fulfilled the whole pledge.)
  M.A9b = {
    expect: {
      "reports.solicitations.openPledgeTotal": { d: -a9.payment },
      [`fundraising.goals.${FIX.CAMPAIGN}.pledged`]: { d: -a9.payment },
      [`donors.perDonor.${a9email}.total`]: { d: a9.payment },
      [`donors.perDonor.${a9email}.gifts`]: { d: 1 },
      "donors.totalGiving": { d: a9.payment },
      "donors.giftCount": { d: 1 },
      "counts.giftsRows": { d: 1 },
      "counts.giftsSum": { d: a9.payment },
      "counts.ledgerRows": { d: 1 },
      "counts.ledgerGiftLinked": { d: 1 },
      "counts.interactions": { d: 1 },
      "counts.workflowRuns": { d: 1 },
      // donor 60's owner IS the admin (also the ED) — notifyUserOnce's
      // one-email-per-person-per-event dedup collapses both to ONE row
      "counts.notificationSends": { d: 1 },
      "tasks.open": { d: 1 },
      [`fundraising.goals.${FIX.CAMPAIGN}.raised`]: { d: a9.payment },
      [`fundraising.goals.${FIX.CAMPAIGN}.giftRaised`]: { d: a9.payment },
      [`fundraising.goals.${FIX.CAMPAIGN}.donorCount`]: { d: attributed(a9.donor) ? 0 : 1 },
      "fundraising.rollup.totalRaised": { d: a9.payment },
      "fundraising.period.raised": { d: a9.payment },
      "fundraising.period.giftCount": { d: 1 },
      "fundraising.period.donorCount": { d: 1 },
      "fundraising.thisWeek.raised": { d: a9.payment },
      "fundraising.thisWeek.giftCount": { d: 1 },
      "reports.summaryFY.total": { d: a9.payment },
      "reports.summaryFY.giftCount": { d: 1 },
      "reports.summaryFY.uniqueDonors": { d: 1 },
      "reports.summaryFY.returningDonors": { d: 1 },
      "reports.annual.total": { d: a9.payment },
      "reports.annual.giftCount": { d: 1 },
      "reports.annual.uniqueDonors": { d: 1 },
      "reports.lybunt.count": { d: -1 },
      "reports.lybunt.priorTotal": { d: -fyGiftTotal(a9.donor) },
      "reports.sybunt.count": { d: -1 },
      "finance.cashOnHand": { d: a9.payment },
      "finance.ytdRevenue": { d: a9.payment },
      "finance.giftHistoryTotal": { d: a9.payment },
      "finance.fundBalancesTotal": { d: a9.payment },
      "finance.fyYtdRevenue": { d: a9.payment },
      [`officers.${"wap-admin@example.org"}.giving`]: { d: a9.payment }, // owner's portfolio total
    },
    allow: ["^reports\\.annual\\.growthPct$"],
    reversalExclude: APPEND_ONLY,
  };

  // ── A10: soft-delete a donor WITH gifts. Reports/finance/donor totals drop;
  //        the campaign thermometer deliberately KEEPS their attributed gifts
  //        (a campaign genuinely received the money — BUILD-33, LOCKED) —
  //        this manifest ENCODES that documented nuance: no fundraising.goals
  //        delta appears in `expect`, so one showing up FAILS the run. ──
  const a10 = FIX.A10, a10email = em(a10.donor), a10total = lifeTotal(a10.donor), a10gifts = donorOf(a10.donor).gifts.length;
  M.A10 = {
    expect: {
      "donors.count": { d: -1 },
      "donors.trashed": { d: 1 },
      "donors.totalGiving": { d: -a10total },
      "donors.giftCount": { d: -a10gifts },
      [`donors.perDonor.${a10email}.deleted`]: { to: true },
      "finance.giftHistoryTotal": { d: -a10total },
      "reports.sybunt.count": { d: -1 },
      // donor 200 is outside the 0..99 band → not in LYBUNT; a LYBUNT delta
      // appearing here would fail, which is exactly right.
    },
    allow: [
      "^reports\\.retention\\.",  // completed-year cohorts re-derive without the donor
      "^reports\\.topLifetime\\.", // top-10 membership may reshuffle
      "^reports\\.threeYearTotals$",
    ],
    reversalExclude: null, // NO reversal: the product has no restore-from-trash route
  };

  return M;
}

module.exports = { FIX, buildManifests };
