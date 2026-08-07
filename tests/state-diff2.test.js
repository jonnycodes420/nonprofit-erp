// BUILD-44 Part 1 — state-diff wiring sweep, B-series (extends BUILD-43).
// TESTS ONLY: no product code changed for this suite; behavior that looked
// wrong while authoring manifests is recorded in audit/BUILD-44-FINDINGS.md
// and the manifest encodes CURRENT behavior with a FINDING comment.
//
// Same property as tests/state-diff.test.js (see its header), same WAP-scale
// deterministic fixture, own org (org_wap2) so both suites are independent.
// Covers: grant lifecycle (create/advance/award/close + un-award reversal),
// all five workflow recipes firing + idempotency, task lifecycle, goal
// create/edit/delete + parent/child roll-up recomputation, household member
// add/remove (soft credit is DERIVED — the household combined figure IS the
// soft-credit surface), designations, restricted-fund gift routing,
// planned-giving, org branding (an all-zero manifest: branding must move NO
// number), officer bulk reassign, recurring cancel, year-end statements.
//
// DISCOVER=1 prints raw diffs instead of asserting (manifest authoring).

const { ok, summary, login, api, q } = require("./helpers");
const { DISCOVER, makeSnapshotter, diffState, makeAsserters, buildFixtureOrg, makeWebhookFirer, settle, startMailSink } = require("./state-diff.lib");
const { FIX2, buildManifests2 } = require("./state-diff2.manifests");

const ORG = "org_wap2";
const ACCT = "acct_wap2_test";
const ADMIN_ID = "u_wap2_admin", ADMIN = "wap2-admin@example.org";
const OFFICER_ID = "u_wap2_officer", OFFICER = "wap2-officer@example.org";

const snapshotOrgState = makeSnapshotter(ORG);
const { assertManifest, assertReversal } = makeAsserters(ok);
const fireWebhook = makeWebhookFirer(ACCT);

(async () => {
  const t0 = Date.now();
  const sink = await startMailSink(); // accept notification sends (F-2)
  const ctx = await buildFixtureOrg({ ORG, ACCT, ADMIN_ID, ADMIN, OFFICER_ID, OFFICER, FIX: FIX2, enableGiftThanks: false });
  const { token, idByEmail, campaignId, em, recipes } = ctx;
  console.log(`fixture: ${FIX2.N_DONORS} donors / ${FIX2.N_GIFTS} gifts built in ${Math.round((Date.now() - t0) / 1000)}s\n`);
  const M = buildManifests2({ ...ctx, ADMIN_ID, OFFICER_ID });

  let base = await snapshotOrgState(token);
  const snap = () => snapshotOrgState(token);
  const rebase = async () => { base = await snap(); };

  // ── B1 grant lifecycle ───────────────────────────────────────────────────
  let grantId;
  {
    const r = await api("POST", "/grants", token, { funder: "Sweep Foundation", program: "Capacity", amount: FIX2.B1.amount, status: "prospecting", deadline: "2026-12-01" });
    ok("B1a grant create: 200/201", r.status === 200 || r.status === 201, r.body);
    grantId = r.body.id || r.body.grant?.id;
    assertManifest("B1a grant-created", diffState(base, await snap()), M.B1a);
    await rebase();

    // PUT /grants/:id requires the full body (funder at minimum — a
    // status-only PUT 400s); discovery caught the unchecked silent no-op.
    const gput = (status) => api("PUT", `/grants/${grantId}`, token, { funder: "Sweep Foundation", program: "Capacity", amount: FIX2.B1.amount, status, deadline: "2026-12-01" });
    let pr = await gput("applied");
    ok("B1b advance PUT: 200", pr.status === 200, pr.body);
    assertManifest("B1b grant-advanced", diffState(base, await snap()), M.B1b);
    await rebase();

    pr = await gput("awarded");
    ok("B1c award PUT: 200", pr.status === 200, pr.body);
    await settle();
    assertManifest("B1c grant-awarded (ledger stamps ONCE)", diffState(base, await snap()), M.B1c);
    const preClose = base;
    await rebase();

    pr = await gput("closed");
    ok("B1d close PUT: 200", pr.status === 200, pr.body);
    assertManifest("B1d grant-closed (award booking KEPT)", diffState(base, await snap()), M.B1d);

    // reversal chain: closed → awarded → applied (un-award deletes the stamp)
    await gput("awarded");
    assertReversal("B1d grant-close", base, await snap(), M.B1d.reversalExclude);
    await gput("applied");
    await settle();
    assertReversal("B1c grant-award (un-award reverses the ledger)", preClose, await snap(), M.B1c.reversalExclude);
    const dr = await api("DELETE", `/grants/${grantId}`, token);
    ok("B1 grant delete: 200", dr.status === 200, dr.body);
    await rebase();
  }

  // ── B2 workflows: all five recipes fire, and refires are strict no-ops ───
  {
    // enable everything (fixture enabled none)
    for (const w of recipes) await api("PUT", `/workflows/${w.id}`, token, { enabled: true });
    await rebase();

    // first-gift → new_donor_welcome + instant_gift_thanks both fire
    const dWelcome = idByEmail[em(FIX2.B2.welcomeDonor)];
    await api("POST", "/workflows/simulate", token, { trigger: "gift_received", donorId: dWelcome, amount: 50, isFirstGift: true, dedupKey: "b2:welcome:1" });
    await settle();
    assertManifest("B2a first-gift (welcome + instant-thanks fire)", diffState(base, await snap()), M.B2a);
    await rebase();

    // big gift → major_gift_alert joins instant_gift_thanks
    const dMajor = idByEmail[em(FIX2.B2.majorDonor)];
    await api("POST", "/workflows/simulate", token, { trigger: "gift_received", donorId: dMajor, amount: 5000, isFirstGift: false, dedupKey: "b2:major:1" });
    await settle();
    assertManifest("B2b major-gift (alert + instant-thanks fire)", diffState(base, await snap()), M.B2b);
    await rebase();

    // lapsed donor → lapsing_reengage (tag + task)
    const dLapse = idByEmail[em(FIX2.B2.lapseDonor)];
    await api("POST", "/workflows/simulate", token, { trigger: "donor_lapsed", donorId: dLapse, dedupKey: "b2:lapse:1" });
    await settle();
    assertManifest("B2c donor-lapsed (re-engage recipe fires)", diffState(base, await snap()), M.B2c);
    await rebase();

    // failed recurring → recovery recipe
    const dFail = idByEmail[em(FIX2.B2.failDonor)];
    await api("POST", "/workflows/simulate", token, { trigger: "recurring_failed", donorId: dFail, dedupKey: "b2:fail:1" });
    await settle();
    assertManifest("B2d recurring-failed (recovery recipe fires)", diffState(base, await snap()), M.B2d);
    await rebase();

    // idempotency: the SAME dedupKey refired → the empty manifest
    await api("POST", "/workflows/simulate", token, { trigger: "gift_received", donorId: dWelcome, amount: 50, isFirstGift: true, dedupKey: "b2:welcome:1" });
    await settle();
    assertManifest("B2e refire same dedupKey (strict no-op)", diffState(base, await snap()), M.B2e);
    // disable all recipes again so later actions fire nothing
    for (const w of recipes) await api("PUT", `/workflows/${w.id}`, token, { enabled: false });
    await rebase();
  }

  // ── B3 task lifecycle ────────────────────────────────────────────────────
  {
    const r = await api("POST", "/tasks", token, { title: "Sweep task B3", due: "2026-10-01", priority: "high", assignedTo: OFFICER_ID });
    ok("B3 task create: 200/201", r.status === 200 || r.status === 201, r.body);
    const taskId = r.body.id || r.body.task?.id;
    await settle();
    assertManifest("B3a task-created (assignee notified once)", diffState(base, await snap()), M.B3a);
    const preComplete = await snap();

    await api("POST", `/tasks/${taskId}/complete`, token, { done: true });
    assertManifest("B3b task-completed", diffState(preComplete, await snap()), M.B3b);
    await api("POST", `/tasks/${taskId}/complete`, token, { done: false });
    assertReversal("B3b task-complete", preComplete, await snap(), M.B3b.reversalExclude);

    // reassign officer → admin BY the admin (self-assign = deliberately silent)
    const preReassign = await snap();
    await api("PUT", `/tasks/${taskId}`, token, { assignedTo: ADMIN_ID });
    await settle();
    assertManifest("B3c task-reassigned (self-assign sends NO email)", diffState(preReassign, await snap()), M.B3c);

    await api("DELETE", `/tasks/${taskId}`, token);
    await settle();
    assertReversal("B3 task lifecycle", base, await snap(), M.B3a.reversalExclude);
    await rebase();
  }

  // ── B4 goals: create / child roll-up / edit / delete ─────────────────────
  {
    const g1 = await api("POST", "/fundraising/campaigns", token, { name: "Sweep Goal", goalAmount: 50000, startDate: "2026-07-01", endDate: "2027-06-30", goalCategory: "project" });
    ok("B4 goal create: 200/201", g1.status === 200 || g1.status === 201, g1.body);
    const goalId = g1.body.id || g1.body.campaign?.id;
    assertManifest("B4a goal-created", diffState(base, await snap()), M.B4a);
    const preChild = await snap();

    // a CHILD goal rolls up under the parent: top-level rollup figures must
    // NOT double-count it (activeGoalCount and totalGoal stay top-level-only)
    const g2 = await api("POST", "/fundraising/campaigns", token, { name: "Sweep Child", goalAmount: 20000, startDate: "2026-07-01", endDate: "2027-06-30", parentGoalId: goalId });
    const childId = g2.body.id || g2.body.campaign?.id;
    assertManifest("B4b child-goal (roll-up does NOT double-count)", diffState(preChild, await snap()), M.B4b);
    const preEdit = await snap();

    await api("PUT", `/fundraising/campaigns/${goalId}`, token, { goalAmount: 60000 });
    assertManifest("B4c goal-edited", diffState(preEdit, await snap()), M.B4c);
    await api("PUT", `/fundraising/campaigns/${goalId}`, token, { goalAmount: 50000 });
    assertReversal("B4c goal-edit", preEdit, await snap(), M.B4c.reversalExclude);

    await api("DELETE", `/campaigns/${childId}`, token);
    await api("DELETE", `/campaigns/${goalId}`, token);
    assertReversal("B4 goal create/delete", base, await snap(), M.B4a.reversalExclude);
    await rebase();
  }

  // ── B5 household member add/remove (the soft-credit surface) ─────────────
  {
    const hh = (await q(`SELECT id FROM households WHERE org_id=$1`, [ORG]))[0].id;
    const newMember = idByEmail[em(FIX2.B5.member)];
    const cur = (await q(`SELECT primary_donor_id FROM households WHERE id=$1`, [hh]))[0];
    const members = (await q(`SELECT id FROM donors WHERE household_id=$1`, [hh])).map(r => r.id);
    await api("PUT", `/households/${hh}`, token, { memberIds: [...members, newMember], primaryDonorId: cur.primary_donor_id });
    assertManifest("B5a household-member-added (combined = Σ hard credit)", diffState(base, await snap()), M.B5a);
    await api("PUT", `/households/${hh}`, token, { memberIds: members, primaryDonorId: cur.primary_donor_id });
    assertReversal("B5 household add/remove", base, await snap(), M.B5a.reversalExclude);
    await rebase();
  }

  // ── B6 designation ───────────────────────────────────────────────────────
  {
    const d = idByEmail[em(FIX2.B6.donor)];
    await api("POST", `/donors/${d}/designations`, token, { kind: "planned_prospect" });
    assertManifest("B6 designation-added", diffState(base, await snap()), M.B6);
    await api("DELETE", `/donors/${d}/designations/planned_prospect`, token);
    assertReversal("B6 designation", base, await snap(), M.B6.reversalExclude);
    await rebase();
  }

  // ── B7 restricted-fund routing ───────────────────────────────────────────
  {
    const f = await api("POST", "/finance/funds", token, { name: "Sweep Restricted Fund", restricted: true, target: 0 });
    ok("B7 fund create: 200/201", f.status === 200 || f.status === 201, f.body);
    assertManifest("B7a restricted-fund-created (zero money moved)", diffState(base, await snap()), M.B7a);
    const preGift = await snap();

    const donorId = idByEmail[em(FIX2.B7.donor)];
    const fundId = f.body.id || f.body.fund?.id;
    await api("POST", `/donors/${donorId}/gifts`, token, { amount: FIX2.B7.amount, date: FIX2.TODAY, type: "one-time", fundId, notes: "state-diff B7" });
    await settle();
    assertManifest("B7b gift-to-restricted-fund", diffState(preGift, await snap()), M.B7b);
    const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND notes=$2`, [ORG, "state-diff B7"]))[0].id;
    await api("DELETE", `/gifts/${gid}`, token);
    await settle();
    assertReversal("B7b restricted gift", preGift, await snap(), M.B7b.reversalExclude);
    await rebase(); // the empty fund remains (no fund-delete route) — new baseline
  }

  // ── B8 planned giving ────────────────────────────────────────────────────
  {
    const d = idByEmail[em(FIX2.B8.donor)];
    const r = await api("POST", `/donors/${d}/planned-gifts`, token, { type: "bequest", estimatedValue: 100000, dateIndicated: FIX2.TODAY });
    ok("B8 planned gift: 200/201", r.status === 200 || r.status === 201, r.body);
    assertManifest("B8 planned-gift-indicated", diffState(base, await snap()), M.B8);
    const pgid = (await q(`SELECT id FROM planned_gifts WHERE org_id=$1`, [ORG]))[0].id;
    await api("DELETE", `/planned-gifts/${pgid}`, token);
    assertReversal("B8 planned gift", base, await snap(), M.B8.reversalExclude);
    await rebase();
  }

  // ── B9 branding: must move NO number anywhere ────────────────────────────
  {
    const r = await api("PUT", "/orgs/branding", token, { brandAccent: "#8a3a24" });
    ok("B9 branding: 200", r.status === 200, r.body);
    assertManifest("B9 branding-change (the all-zero manifest)", diffState(base, await snap()), M.B9);
    await api("PUT", "/orgs/branding", token, { brandAccent: "" });
    assertReversal("B9 branding", base, await snap(), M.B9.reversalExclude);
    await rebase();
  }

  // ── B10 officer bulk reassign ────────────────────────────────────────────
  {
    const ids = FIX2.B10.donors.map(i => idByEmail[em(i)]);
    await api("PATCH", "/donors/bulk-assign", token, { ids, assignedTo: ADMIN_ID });
    assertManifest("B10 bulk-reassign", diffState(base, await snap()), M.B10);
    await api("PATCH", "/donors/bulk-assign", token, { ids, assignedTo: OFFICER_ID });
    assertReversal("B10 bulk-reassign", base, await snap(), M.B10.reversalExclude);
    await rebase();
  }

  // ── B11 recurring created then CANCELED (no pause state exists — see
  //        FINDINGS: statuses are active/past_due/recovering/recovered/canceled) ──
  {
    const email = em(FIX2.B11.donor);
    await fireWebhook("checkout.session.completed",
      { id: "cs_wap2_b11", mode: "subscription", subscription: "sub_wap2_b11", customer: "cus_wap2_b11",
        amount_total: FIX2.B11.monthly * 100, customer_email: email, metadata: { donor_name: "B11", frequency: "monthly" } }, "evt_wap2_b11a");
    await settle();
    assertManifest("B11a recurring-created", diffState(base, await snap()), M.B11a);
    const preCancel = await snap();
    await fireWebhook("customer.subscription.deleted",
      { id: "sub_wap2_b11", customer: "cus_wap2_b11" }, "evt_wap2_b11b");
    await settle();
    assertManifest("B11b recurring-canceled", diffState(preCancel, await snap()), M.B11b);
    await rebase();
  }

  // ── B12 year-end statement: issue, then REGENERATE (supersede) ───────────
  {
    const d = idByEmail[em(0)]; // band donor: has a 2026-05-15 gift → CY2026 statement
    const r = await api("POST", `/donors/${d}/year-end-statement`, token, { year: 2026, send: false });
    ok("B12 year-end statement: 200/201", r.status === 200 || r.status === 201, r.body);
    assertManifest("B12a year-end-issued", diffState(base, await snap()), M.B12a);
    const preRegen = await snap();
    await api("POST", `/donors/${d}/year-end-statement`, token, { year: 2026, send: false });
    assertManifest("B12b year-end-REGENERATED (supersede: prior voided, one active)", diffState(preRegen, await snap()), M.B12b);
    // forward-only: receipts are legal artifacts; no reversal path exists.
  }

  console.log(`\ntotal runtime ${Math.round((Date.now() - t0) / 1000)}s`);
  if (sink) sink.close();
  if (!DISCOVER) summary(); else process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
