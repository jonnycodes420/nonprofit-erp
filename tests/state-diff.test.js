// BUILD-43 — the WIRING test: full-org state-diff harness.
//
// Don't test surfaces one at a time. Take a complete numeric snapshot of the
// entire org, perform ONE canonical action, snapshot again, and assert the
// diff equals a committed manifest EXACTLY:
//   - anything that moved and shouldn't have = a bug (double-counting — the
//     class that hid the BUILD-23 Stripe-webhook doubling)
//   - anything that should have moved and didn't = a bug (a dead wire)
// Then REVERSAL SYMMETRY: perform the action, reverse it through the
// product's own reversal path, and assert state returns to the baseline
// byte-for-byte (append-only ledgers — audit rows, workflow runs,
// notification reservations — are declared exclusions in the manifest, and
// every exclusion is a reviewed decision, not a shrug).
//
// The manifests live in tests/state-diff.manifests.js and ARE the spec:
// when one has to change, that's a deliberate reviewed decision, not silent
// drift. See that file's header for the review discipline.
//
// Scale: a deterministic synthetic fixture at WAP scale — 1,530 donors /
// 5,738 gifts (seeded LCG, byte-stable across runs) — big enough that an
// off-by-one or a double-count is visible in every total.
//
// Runs against the local scratch stack (tests/README.md recipe; needs
// STRIPE_WEBHOOK_SECRET=whsec_localtest for the online-gift actions).
// Runtime ~60-90s, dominated by the one-time fixture import.
//
// DISCOVER=1 prints each action's raw diff instead of asserting — the tool
// for writing/reviewing a manifest, never for CI.

const { ok, summary, login, api, q } = require("./helpers");
const { buildManifests, FIX } = require("./state-diff.manifests");
const { DISCOVER, makeSnapshotter, diffState, makeAsserters, buildFixtureOrg, makeWebhookFirer, settle: settleMs } = require("./state-diff.lib");

const ORG = "org_wap";
const ACCT = "acct_wap_test";
const ADMIN_ID = "u_wap_admin", ADMIN = "wap-admin@example.org";
const OFFICER_ID = "u_wap_officer", OFFICER = "wap-officer@example.org";

const snapshotOrgState = makeSnapshotter(ORG);
const { assertManifest, assertReversal } = makeAsserters(ok);
const fireWebhook = makeWebhookFirer(ACCT);
const em = i => `wap+${String(i).padStart(4, "0")}@example.org`;
async function buildFixture() {
  return buildFixtureOrg({ ORG, ACCT, ADMIN_ID, ADMIN, OFFICER_ID, OFFICER, FIX, enableGiftThanks: true });
}

// ── the run ────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  const ctx = await buildFixture();
  const { token, idByEmail, campaignId, fixture } = ctx;
  console.log(`fixture: ${FIX.N_DONORS} donors / ${FIX.N_GIFTS} gifts built in ${Math.round((Date.now() - t0) / 1000)}s\n`);
  const M = buildManifests({ ...ctx, em });

  let base = await snapshotOrgState(token);
  const settle = () => settleMs(400); // fire-and-forget workflow/notify writes

  // A1 — log a manual gift ($500, today, campaign-attributed)
  {
    const donorId = idByEmail[em(FIX.A1.donor)];
    const r = await api("POST", `/donors/${donorId}/gifts`, token, { amount: FIX.A1.amount, date: FIX.TODAY, type: "one-time", campaignId, notes: "state-diff A1" });
    ok("A1 manual gift: 200", r.status === 200 || r.status === 201, r.status);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A1 manual-gift", diffState(base, after), M.A1);
    // reverse: delete the gift through the product path
    const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND date=$3 AND amount=$4`, [ORG, donorId, FIX.TODAY, FIX.A1.amount]))[0].id;
    const dr = await api("DELETE", `/gifts/${gid}`, token);
    ok("A1 reverse (delete gift): 200", dr.status === 200, dr.status);
    await settle();
    assertReversal("A1 manual-gift", base, await snapshotOrgState(token), M.A1.reversalExclude);
    base = await snapshotOrgState(token); // new baseline carries append-only residue
  }

  // A2 — import a donor file with gift history (3 donors / 5 historical gifts)
  {
    const r = await api("POST", "/donors/import-combined", token, {
      donors: FIX.A2.donors.map(d => ({ name: d.name, email: d.email })),
      gifts: FIX.A2.gifts,
    });
    ok("A2 import: 200", r.status === 200, r.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A2 import-with-history", diffState(base, after), M.A2);
    // reverse: soft-delete the imported donors, then purge trash (their gifts go with them;
    // historical gifts never stamped the ledger, so finance reverts too)
    const ids = [];
    for (const d of FIX.A2.donors) ids.push((await q(`SELECT id FROM donors WHERE org_id=$1 AND email=$2`, [ORG, d.email]))[0].id);
    await api("POST", "/donors/bulk-delete", token, { ids });
    const pr = await api("POST", "/donors/purge-trash", token);
    ok("A2 reverse (trash + purge): 200", pr.status === 200, pr.body);
    await settle();
    assertReversal("A2 import-with-history", base, await snapshotOrgState(token), M.A2.reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A3 — online gift via signed Stripe webhook (new donor, $120)
  {
    const r = await fireWebhook("payment_intent.succeeded",
      { id: FIX.A3.pi, amount_received: FIX.A3.amount * 100, receipt_email: FIX.A3.email, metadata: { donor_name: FIX.A3.name, campaign_id: campaignId } },
      "evt_wap_a3");
    ok("A3 online gift webhook: 200", r.status === 200, r.body);
    await settle(); await settle(); // receipt render + workflow fire
    const after = await snapshotOrgState(token);
    assertManifest("A3 online-gift", diffState(base, after), M.A3);
    base = after; // A5 (refund) reverses this — asserted there
  }

  // A4 — recurring gift charge, then a failed card
  {
    const sub = { id: FIX.A4.sub, customer: "cus_wap_a4", metadata: { donor_email: FIX.A3.email } };
    const s1 = await fireWebhook("checkout.session.completed",
      { id: "cs_wap_a4", mode: "subscription", subscription: FIX.A4.sub, customer: "cus_wap_a4", amount_total: FIX.A4.monthly * 100,
        customer_email: FIX.A3.email,   // the handler resolves the donor by THIS
        metadata: { donor_name: FIX.A3.name, frequency: "monthly" } }, "evt_wap_a4a");
    ok("A4 subscription created webhook: 200", s1.status === 200, s1.body);
    await settle();
    const mid = await snapshotOrgState(token);
    assertManifest("A4a recurring-created", diffState(base, mid), M.A4a);
    const s2 = await fireWebhook("invoice.payment_failed",
      { id: "in_wap_a4", subscription: FIX.A4.sub, customer: "cus_wap_a4", amount_due: FIX.A4.monthly * 100 }, "evt_wap_a4b");
    ok("A4 failed-card webhook: 200", s2.status === 200, s2.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A4b failed-card", diffState(mid, after), M.A4b);
    base = after;
  }

  // A5 — full refund of the A3 online gift, then a partial refund of a second one
  {
    const r = await fireWebhook("charge.refunded",
      { id: "ch_wap_a3", payment_intent: FIX.A3.pi, amount: FIX.A3.amount * 100, amount_refunded: FIX.A3.amount * 100 }, "evt_wap_a5a");
    ok("A5 full refund webhook: 200", r.status === 200, r.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A5a full-refund", diffState(base, after), M.A5a);
    base = after;

    // second online gift, then PARTIAL refund ($200 → keeps $80)
    await fireWebhook("payment_intent.succeeded",
      { id: FIX.A5.pi, amount_received: FIX.A5.amount * 100, receipt_email: FIX.A3.email, metadata: { donor_name: FIX.A3.name } }, "evt_wap_a5b");
    await settle(); await settle();
    const mid = await snapshotOrgState(token);
    const pr = await fireWebhook("charge.refunded",
      { id: "ch_wap_a5", payment_intent: FIX.A5.pi, amount: FIX.A5.amount * 100, amount_refunded: FIX.A5.refund * 100 }, "evt_wap_a5c");
    ok("A5 partial refund webhook: 200", pr.status === 200, pr.body);
    await settle();
    const after2 = await snapshotOrgState(token);
    assertManifest("A5b partial-refund", diffState(mid, after2), M.A5b);
    base = after2;
  }

  // A6 — edit a gift's amount, then its date, then its campaign (each reversed)
  {
    const donorId = idByEmail[em(FIX.A6.donor)];
    await api("POST", `/donors/${donorId}/gifts`, token, { amount: FIX.A6.amount, date: FIX.TODAY, type: "one-time", notes: "state-diff A6" });
    await settle();
    base = await snapshotOrgState(token);
    // select by the note — an amount-only match collided with one of the
    // donor's IMPORT gifts (a discovery-run lesson: always target scratch
    // objects by an unambiguous key)
    const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND notes=$3`, [ORG, donorId, "state-diff A6"]))[0].id;

    // amount 300 → 750, back
    await api("PUT", `/gifts/${gid}`, token, { amount: FIX.A6.newAmount });
    await settle();
    let after = await snapshotOrgState(token);
    assertManifest("A6a edit-amount", diffState(base, after), M.A6a);
    await api("PUT", `/gifts/${gid}`, token, { amount: FIX.A6.amount });
    await settle();
    assertReversal("A6a edit-amount", base, await snapshotOrgState(token), M.A6a.reversalExclude);
    base = await snapshotOrgState(token);

    // date today → prior fiscal year, back
    await api("PUT", `/gifts/${gid}`, token, { date: FIX.A6.oldDate });
    await settle();
    after = await snapshotOrgState(token);
    assertManifest("A6b edit-date", diffState(base, after), M.A6b);
    await api("PUT", `/gifts/${gid}`, token, { date: FIX.TODAY });
    await settle();
    assertReversal("A6b edit-date", base, await snapshotOrgState(token), M.A6b.reversalExclude);
    base = await snapshotOrgState(token);

    // campaign none → Annual Fund, back
    await api("PUT", `/gifts/${gid}`, token, { campaignId });
    await settle();
    after = await snapshotOrgState(token);
    assertManifest("A6c edit-campaign", diffState(base, after), M.A6c);
    await api("PUT", `/gifts/${gid}`, token, { campaignId: "" });
    await settle();
    assertReversal("A6c edit-campaign", base, await snapshotOrgState(token), M.A6c.reversalExclude);
    // clean up the A6 scratch gift so later baselines stay tidy
    await api("DELETE", `/gifts/${gid}`, token);
    await settle();
    base = await snapshotOrgState(token);
  }

  // A7 — reassign a donor between officers, then back
  {
    const donorId = idByEmail[em(FIX.A7.donor)]; // assigned to OFFICER in fixture
    const r = await api("PATCH", `/donors/${donorId}/assign`, token, { assignedTo: ADMIN_ID });
    ok("A7 reassign: 200", r.status === 200, r.body);
    const after = await snapshotOrgState(token);
    assertManifest("A7 reassign-officer", diffState(base, after), M.A7);
    await api("PATCH", `/donors/${donorId}/assign`, token, { assignedTo: OFFICER_ID });
    assertReversal("A7 reassign-officer", base, await snapshotOrgState(token), M.A7.reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A8 — advance a move stage + log an ask
  {
    const donorId = idByEmail[em(FIX.A8.donor)];
    const st = (await q(`SELECT stage FROM donors WHERE id=$1`, [donorId]))[0].stage;
    const to = st === "cultivate" ? "solicit" : "cultivate";
    const mv = await api("POST", `/pipeline/${donorId}/move`, token, { toStage: to, description: "state-diff A8 move" });
    ok("A8 move: 200/201", mv.status === 200 || mv.status === 201, { status: mv.status, body: mv.body });
    const ask = await api("POST", `/donors/${donorId}/opportunities`, token, { name: "State-diff Ask", targetAmount: FIX.A8.ask });
    ok("A8 ask: 200/201", ask.status === 200 || ask.status === 201, ask.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A8 move+ask", diffState(base, after), M.A8(st, to));
    // reverse: move back + delete the ask
    await api("POST", `/pipeline/${donorId}/move`, token, { toStage: st, description: "state-diff A8 reverse" });
    const oid = (await q(`SELECT id FROM opportunities WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]))[0].id;
    await api("DELETE", `/opportunities/${oid}`, token);
    await settle();
    assertReversal("A8 move+ask", base, await snapshotOrgState(token), M.A8(st, to).reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A9 — record a pledge, then a payment against it
  {
    const donorId = idByEmail[em(FIX.A9.donor)];
    const pl = await api("POST", `/donors/${donorId}/pledges`, token, { amount: FIX.A9.pledge, dueDate: "2026-12-01", campaignId });
    ok("A9 pledge: 200/201", pl.status === 200 || pl.status === 201, pl.body);
    await settle();
    const mid = await snapshotOrgState(token);
    assertManifest("A9a pledge", diffState(base, mid), M.A9a);
    const pid = (await q(`SELECT id FROM pledges WHERE org_id=$1 AND donor_id=$2`, [ORG, donorId]))[0].id;
    const pay = await api("POST", `/donors/${donorId}/gifts`, token, { amount: FIX.A9.payment, date: FIX.TODAY, type: "one-time", pledgeId: pid });
    ok("A9 payment: 200/201", pay.status === 200 || pay.status === 201, pay.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A9b pledge-payment", diffState(mid, after), M.A9b);
    // reverse: delete the payment gift (reopens the pledge), then the pledge
    const gid = (await q(`SELECT id FROM gifts WHERE org_id=$1 AND donor_id=$2 AND amount=$3 AND date=$4`, [ORG, donorId, FIX.A9.payment, FIX.TODAY]))[0].id;
    await api("DELETE", `/gifts/${gid}`, token);
    await api("DELETE", `/pledges/${pid}`, token);
    await settle();
    assertReversal("A9 pledge+payment", base, await snapshotOrgState(token), M.A9b.reversalExclude);
    base = await snapshotOrgState(token);
  }

  // A10 — delete (soft) a donor who has gifts. NO reversal: the product has no
  // restore-from-trash route (documented gap — see CLAUDE.md / BLOCKED files).
  {
    const donorId = idByEmail[em(FIX.A10.donor)];
    const r = await api("DELETE", `/donors/${donorId}`, token);
    ok("A10 delete donor: 200", r.status === 200, r.body);
    await settle();
    const after = await snapshotOrgState(token);
    assertManifest("A10 delete-donor", diffState(base, after), M.A10);
  }

  console.log(`\ntotal runtime ${Math.round((Date.now() - t0) / 1000)}s`);
  if (!DISCOVER) summary(); else process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
