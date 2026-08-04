// FIX — honest "what Steward has done for you" number (GET /impact).
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// The whole point of this feature is HONESTY, so the test's job is to prove the
// number can only ever be attributable:
//   - recoveredAmount = Σ TRACKED recovery amounts ONLY (payment_recovered
//     events with an amount) — NEVER total gifts, and a recovery event with no
//     tracked amount is excluded (we don't fabricate)
//   - platformFeesPaid is factually 0 (0% platform fee, own Stripe)
//   - onlineGivingProcessed counts only online (stripe_payment_id) gifts, and
//     the estimate = that × the SHOWN assumption (feeAssumptionPct)
//   - forward-looking empty state: a new org with nothing recovered → $0
//     recovered + a real watching count (never a fake number)
//   - planMonthlyCost reflects the org's plan
//   - org isolation both directions

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const A = "org_impact_a", B = "org_impact_b";
const TODAY = new Date().toISOString().slice(0, 10);
let _c = 0;
const uid = p => `${p}_${Date.now().toString(36)}${(_c++).toString(36)}`;

async function reset() {
  for (const org of [A, B]) {
    for (const t of ["payment_recovery_events", "recurring_subscriptions", "gifts", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag, plan = "core") {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active',$4)`,
    [o, `Impact ${tag}`, `impact-${tag}`, plan]);
}
async function seedAdmin(o, email) {
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`,
    [uid("u"), o, email, bcrypt.hashSync("loadtest1234", 10), "Admin"]);
}
async function seedDonor(o, id) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ($1,$2,$3,$4,'mid','steward',0,0)`,
    [id, o, id, `${id}@impact.local`]);
}
// An online gift carries stripe_payment_id; an offline one doesn't.
async function seedGift(o, donor, amount, online) {
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,stripe_payment_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [uid("g"), o, donor, amount, TODAY, online ? uid("pi") : null]);
}
async function seedSub(o, donor, amount, status) {
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,status) VALUES ($1,$2,$3,$4,$5,$6)`,
    [uid("rs"), o, donor, uid("sub"), amount, status]);
}
// A recovery event as the workflow logs it. detail carries the recovered amount
// (or omits it for the safety-net path — which MUST be excluded from the sum).
async function seedRecovery(o, donor, amount) {
  const detail = amount == null ? { source: "subscription.updated" } : { amount };
  await q(`INSERT INTO payment_recovery_events (id,org_id,donor_id,subscription_id,type,stripe_event_id,detail) VALUES ($1,$2,$3,$4,'payment_recovered',$5,$6)`,
    [uid("ev"), o, donor, uid("sub"), uid("evt"), JSON.stringify(detail)]);
}
async function seedLost(o, donor) {
  await q(`INSERT INTO payment_recovery_events (id,org_id,donor_id,subscription_id,type,stripe_event_id,detail) VALUES ($1,$2,$3,$4,'subscription_canceled',$5,'{}')`,
    [uid("ev"), o, donor, uid("sub"), uid("evt")]);
}

(async () => {
  await reset();

  // ── Org A: real activity ──────────────────────────────────────────────────
  await seedOrg(A, "a", "core");
  await seedAdmin(A, "admin@impact-a.local");
  await seedDonor(A, "da1");
  await seedDonor(A, "da2");

  // Recoveries: two tracked ($25 + $50) + one WITHOUT an amount (safety-net) +
  // one "lost" (canceled). Only the two tracked amounts count → $75.
  await seedRecovery(A, "da1", 25);
  await seedRecovery(A, "da1", 50);   // same donor, second cycle — still real money
  await seedRecovery(A, "da2", null); // no tracked amount → excluded, NOT fabricated
  await seedLost(A, "da2");           // a canceled/lost event → never counted as recovered

  // Giving: $1000 online + $500 offline. Only the $1000 online is the fee base.
  await seedGift(A, "da1", 1000, true);
  await seedGift(A, "da2", 500, false);

  // Recurring health: 2 active + 1 past_due being watched.
  await seedSub(A, "da1", 25, "active");
  await seedSub(A, "da1", 50, "active");
  await seedSub(A, "da2", 10, "past_due");

  // Re-engaged giving (BUILD-32 Part 2) — a LAPSED donor who came back. da3 gave
  // $200 ~400 days ago, then $15,000 today → the $15k is a re-engagement gift
  // (a gift after a >365-day gap). da1/da2 each have only a single gift (no prior
  // gift), so they are first-time/repeat, NOT re-engaged. This is a SEPARATE,
  // precisely-labelled number from recovered (the failed-card workflow) — proving
  // the two never merge.
  await seedDonor(A, "da3");
  const d400 = new Date(); d400.setDate(d400.getDate() - 400);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ($1,$2,'da3',200,$3)`, [uid("g"), A, d400.toISOString().slice(0, 10)]);
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date) VALUES ($1,$2,'da3',15000,$3)`, [uid("g"), A, TODAY]);

  const tokA = await login("admin@impact-a.local");
  const imp = (await api("GET", "/impact", tokA)).body;

  // (1b) Re-engaged giving — separate from recovered.
  ok("reengagedAmount = the returned gift after a >365-day gap (15000)", imp.reengagedAmount === 15000, imp.reengagedAmount);
  ok("reengagedDonorCount = 1 lapsed donor who came back", imp.reengagedDonorCount === 1, imp.reengagedDonorCount);
  ok("re-engaged is SEPARATE from recovered — both present, not merged", imp.recoveredAmount === 75 && imp.reengagedAmount === 15000, { r: imp.recoveredAmount, e: imp.reengagedAmount });
  ok("re-engaged excludes first-time gifts (da1/da2 have no prior gift)", imp.reengagedAmount === 15000);

  // (1) Hero — recovered dollars = tracked recoveries ONLY.
  ok("recoveredAmount = Σ tracked recovery amounts (25+50=75)", imp.recoveredAmount === 75, imp.recoveredAmount);
  ok("recoveredCount counts only events with a tracked amount (2)", imp.recoveredCount === 2, imp.recoveredCount);
  ok("recovered is NOT total giving (would be 1500) nor online (1000)", imp.recoveredAmount !== 1500 && imp.recoveredAmount !== 1000);

  // (2) Fees kept — factual.
  ok("platformFeesPaid is factually 0 (0% platform fee)", imp.platformFeesPaid === 0, imp.platformFeesPaid);
  ok("onlineGivingProcessed = online gifts only (1000, offline excluded)", imp.onlineGivingProcessed === 1000, imp.onlineGivingProcessed);

  // (3) Estimate carries its assumption.
  ok("feeAssumptionPct is present (the shown assumption)", imp.feeAssumptionPct === 3, imp.feeAssumptionPct);
  ok("estimatedFeesElsewhere = onlineGiving × assumption (1000×3%=30)", imp.estimatedFeesElsewhere === 30, imp.estimatedFeesElsewhere);

  // Forward-looking + plan cost.
  ok("watchingRecurringCount = active/recovering/past_due subs (3)", imp.watchingRecurringCount === 3, imp.watchingRecurringCount);
  ok("planMonthlyCost reflects the org plan (core → 149)", imp.planMonthlyCost === 149, imp.planMonthlyCost);
  ok("plan echoed", imp.plan === "core", imp.plan);

  // ── Org B: brand-new, nothing recovered — honest empty state ──────────────
  await seedOrg(B, "b", "team");
  await seedAdmin(B, "admin@impact-b.local");
  await seedDonor(B, "db1");
  await seedSub(B, "db1", 40, "active");   // one recurring donor being watched
  // NO recovery events, NO gifts.

  const tokB = await login("admin@impact-b.local");
  const impB = (await api("GET", "/impact", tokB)).body;
  ok("empty org → recoveredAmount is honestly 0 (no fake number)", impB.recoveredAmount === 0, impB.recoveredAmount);
  ok("empty org → recoveredCount 0", impB.recoveredCount === 0, impB.recoveredCount);
  ok("empty org → reengagedAmount honestly 0", impB.reengagedAmount === 0, impB.reengagedAmount);
  ok("empty org → reengagedDonorCount 0", impB.reengagedDonorCount === 0, impB.reengagedDonorCount);
  ok("empty org → onlineGivingProcessed 0, estimate 0", impB.onlineGivingProcessed === 0 && impB.estimatedFeesElsewhere === 0);
  ok("empty org → forward-looking watching count is real (1)", impB.watchingRecurringCount === 1, impB.watchingRecurringCount);
  ok("empty org → platformFeesPaid still factually 0", impB.platformFeesPaid === 0);
  ok("team plan → planMonthlyCost 299", impB.planMonthlyCost === 299, impB.planMonthlyCost);

  // ── Org isolation both directions ─────────────────────────────────────────
  ok("A does not see B's data (A recovered still 75)", imp.recoveredAmount === 75);
  ok("B does not see A's recoveries (B recovered 0)", impB.recoveredAmount === 0);
  ok("B does not see A's re-engaged giving (B reengaged 0)", impB.reengagedAmount === 0);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
