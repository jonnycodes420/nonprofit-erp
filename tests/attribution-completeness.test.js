// Attribution completeness (FIX, 2026-08-04) — every money path attributes,
// reverses, and reconciles. Local scratch server + Postgres (tests/README.md
// recipe; boot with STRIPE_WEBHOOK_SECRET=whsec_localtest). No external creds.
//
// What it proves:
//   Part 1 — giving pages carry an optional campaign_id (org-scoped; foreign →
//     400); a page-attributed online gift (webhook) moves BOTH the page and the
//     campaign thermometer; recurring RENEWAL charges attribute via the
//     subscription's stored attribution (checkout.session.completed stamps it);
//     an unattributed page still works; page reads expose the campaign linkage.
//   Part 2 — pledges attribute at pledge time (org-scoped; foreign → 404);
//     campaign `pledged` shows committed-but-unpaid SEPARATELY from raised
//     (never summed); a payment against the pledge inherits its campaign and
//     converts pledged → raised exactly once; solicitations reports openPledges.
//   Part 3 — a Stripe refund (charge.refunded) reverses attribution everywhere:
//     full refund deletes the gift + its single ledger stamp, voids an active
//     receipt, reopens a fulfilled pledge, recalcs the donor — campaign raised,
//     Reports, and Finance all read net-zero exactly once; partial refunds
//     shrink the gift + stamp; redelivery is a no-op (idempotent by
//     construction); the manual void path (DELETE /gifts/:id) reverses too.
//   Part 4 — donor-covers-fees: the charged total stays on the gift/ledger/
//     Reports; campaign + page goal progress counts amount − cover_fee_amount
//     (what the donor intended for the mission).
//   Part 5 — grants: optional campaign link (org-scoped; foreign → 404);
//     awarded_at stamps on the transition INTO awarded and the awarded amount
//     joins campaign raised (grantAwarded component, separate from giftRaised);
//     un-awarding reverses; no gift row is ever created by an award (the
//     no-double-count mechanism).
//   Part 6 (server side) — count-matches-destination: the hero chips' numbers
//     equal their destinations' numbers (thisWeek ↔ giving-summary custom
//     range; period ↔ giving-summary current FY; re-engaged chip ↔ the
//     /impact.reengagedDonors drill-down list).
//   Org isolation both ways throughout.

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_ac_a";
const ORG_B = "org_ac_b";
const ACCT_A = "acct_ac_a";
const iso = d => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";

async function fixture() {
  const CHILD = [
    "workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "recurring_subscriptions", "receipts", "pledges",
    "fin_audit_log", "fin_transactions", "gifts", "interactions", "giving_pages", "grants",
  ];
  for (const org of [ORG_A, ORG_B]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id,stripe_connected) VALUES ($1,'AC A','ac-a',1,'active','growth',$2,true)`, [ORG_A, ACCT_A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ac_a',$1,'ac-a@test.local',$2,'AC A','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_ac_a1',$1,'Ada Complete','ada.ac@test.local','mid','cultivate',0,0)`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_ac_a2',$1,'Ben Complete','ben.ac@test.local','new','cultivate',0,0)`, [ORG_A]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,recipient_count,open_count) VALUES ('c_ac_1',$1,'Spring Studio Scholarships','appeal','draft',15000,0,0)`, [ORG_A]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,recipient_count,open_count) VALUES ('c_ac_2',$1,'Capital Push 2026','appeal','draft',100000,0,0)`, [ORG_A]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_ac_rev',$1,'4010','Contributions','revenue') ON CONFLICT DO NOTHING`, [ORG_A]).catch(() => {});
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_ac_gen',$1,'General',false) ON CONFLICT DO NOTHING`, [ORG_A]).catch(() => {});

  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'AC B','ac-b',1,'active','growth')`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ac_b',$1,'ac-b@test.local',$2,'AC B','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_ac_b1',$1,'Bea B','bea.ac@test.local','new','cultivate',0,0)`, [ORG_B]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount) VALUES ('c_ac_b1',$1,'Org B Campaign','appeal','draft',5000)`, [ORG_B]);
}

function signAndPost(event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex");
  return fetch(BASE + "/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${sig}` },
    body: payload,
  });
}

// payment_intent.succeeded on the connected account — the online-gift path.
async function firePI({ email, name, amountCents, piId, metadata = {}, invoice = null }) {
  const event = {
    id: "evt_ac_" + crypto.randomBytes(6).toString("hex"),
    type: "payment_intent.succeeded",
    account: ACCT_A,
    data: { object: {
      id: piId, amount_received: amountCents, currency: "usd", invoice,
      receipt_email: email,
      metadata: { donor_email: email, donor_name: name, ...metadata },
    } },
  };
  return (await signAndPost(event)).status;
}

// charge.refunded on the connected account — the reversal path.
async function fireRefund({ piId, amountCents, refundedCents }) {
  const event = {
    id: "evt_ac_" + crypto.randomBytes(6).toString("hex"),
    type: "charge.refunded",
    account: ACCT_A,
    data: { object: {
      id: "ch_ac_" + crypto.randomBytes(5).toString("hex"),
      payment_intent: piId, amount: amountCents, amount_refunded: refundedCents,
    } },
  };
  return (await signAndPost(event)).status;
}

// checkout.session.completed (mode=subscription) — stores the subscription's
// attribution for renewal charges.
async function fireSubCheckout({ email, name, subId, amountCents, metadata = {} }) {
  const event = {
    id: "evt_ac_" + crypto.randomBytes(6).toString("hex"),
    type: "checkout.session.completed",
    account: ACCT_A,
    data: { object: {
      id: "cs_ac_" + crypto.randomBytes(5).toString("hex"),
      mode: "subscription", customer_email: email, subscription: subId,
      customer: "cus_ac_x", amount_total: amountCents,
      metadata: { donor_email: email, donor_name: name, frequency: "monthly", ...metadata },
    } },
  };
  return (await signAndPost(event)).status;
}

const campRow = (rows, id) => (rows || []).find(x => x.id === id);

async function run() {
  await fixture();
  const tokA = await login("ac-a@test.local");
  const tokB = await login("ac-b@test.local");

  // ════ Part 1 — giving page → campaign attribution ════
  const p1 = await api("POST", "/giving-pages", tokA, { title: "Scholarship Drive", campaignId: "c_ac_1" });
  ok("P1 page created with campaignId → 201", p1.status === 201 && p1.body.campaign_id === "c_ac_1", p1.body);
  const pageId = p1.body.id;

  const pForeign = await api("POST", "/giving-pages", tokA, { title: "Evil Page", campaignId: "c_ac_b1" });
  ok("P1 foreign campaign on page create → 400 (org isolation)", pForeign.status === 400, pForeign.status);
  const pForeign2 = await api("PUT", `/giving-pages/${pageId}`, tokA, { campaignId: "c_ac_b1" });
  ok("P1 foreign campaign on page update → 400", pForeign2.status === 400, pForeign2.status);

  const pList = (await api("GET", "/giving-pages", tokA)).body;
  const pRow = pList.find(x => x.id === pageId);
  ok("P1 page list exposes campaign linkage (name+goal)", pRow && pRow.campaign_name === "Spring Studio Scholarships" && parseFloat(pRow.campaign_goal) === 15000, pRow);

  // Simulated giving-page donation: the donate route stamps the PAGE's campaign
  // into the PI metadata; the webhook writes both ids on the gift.
  const pi1 = "pi_ac_" + crypto.randomBytes(5).toString("hex");
  const st1 = await firePI({ email: "ada.ac@test.local", name: "Ada Complete", amountCents: 20000, piId: pi1, metadata: { campaign_id: "c_ac_1", giving_page_id: pageId } });
  ok("P1 page-attributed online gift webhook → 200", st1 === 200, st1);
  const g1 = (await q(`SELECT * FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG_A, pi1]))[0];
  ok("P1 gift carries campaign_id AND giving_page_id", g1 && g1.campaign_id === "c_ac_1" && g1.giving_page_id === pageId, g1);
  let camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P1 campaign thermometer moved ($200)", campRow(camps, "c_ac_1").raised === 200, campRow(camps, "c_ac_1"));
  const pList2 = (await api("GET", "/giving-pages", tokA)).body.find(x => x.id === pageId);
  ok("P1 page raised moved too ($200)", parseFloat(pList2.raised_amount) === 200, pList2.raised_amount);
  ok("P1 page campaign_raised mirrors the campaign ($200)", parseFloat(pList2.campaign_raised) === 200, pList2.campaign_raised);

  // Recurring: checkout stores attribution on the subscription; a RENEWAL
  // charge (invoice-generated PI, no checkout metadata) still attributes.
  const subId = "sub_ac_" + crypto.randomBytes(5).toString("hex");
  const stSub = await fireSubCheckout({ email: "ben.ac@test.local", name: "Ben Complete", subId, amountCents: 2500, metadata: { campaign_id: "c_ac_1", giving_page_id: pageId } });
  ok("P1 subscription checkout webhook → 200", stSub === 200, stSub);
  const rs = (await q(`SELECT * FROM recurring_subscriptions WHERE stripe_subscription_id=$1`, [subId]))[0];
  ok("P1 subscription row stores campaign + page attribution", rs && rs.campaign_id === "c_ac_1" && rs.giving_page_id === pageId, rs);

  const piRenew = "pi_ac_" + crypto.randomBytes(5).toString("hex");
  const stRenew = await firePI({ email: "ben.ac@test.local", name: "Ben Complete", amountCents: 2500, piId: piRenew, metadata: {}, invoice: "in_ac_renewal1" });
  ok("P1 renewal charge webhook → 200", stRenew === 200, stRenew);
  const gRenew = (await q(`SELECT * FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG_A, piRenew]))[0];
  ok("P1 RENEWAL gift attributed from subscription (campaign + page)", gRenew && gRenew.campaign_id === "c_ac_1" && gRenew.giving_page_id === pageId, gRenew);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P1 renewal moved the thermometer ($225 total)", campRow(camps, "c_ac_1").raised === 225, campRow(camps, "c_ac_1"));

  // Unattributed page still works.
  const pPlain = await api("POST", "/giving-pages", tokA, { title: "General Support" });
  ok("P1 unattributed page → 201, no campaign", pPlain.status === 201 && !pPlain.body.campaign_id, pPlain.body);
  const piPlain = "pi_ac_" + crypto.randomBytes(5).toString("hex");
  await firePI({ email: "ada.ac@test.local", name: "Ada Complete", amountCents: 5000, piId: piPlain, metadata: { giving_page_id: pPlain.body.id } });
  const gPlain = (await q(`SELECT * FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG_A, piPlain]))[0];
  ok("P1 unattributed-page gift lands with page, no campaign", gPlain && gPlain.giving_page_id === pPlain.body.id && !gPlain.campaign_id, gPlain);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P1 unattributed gift did NOT move the campaign", campRow(camps, "c_ac_1").raised === 225, campRow(camps, "c_ac_1"));

  // ════ Part 2 — pledges ════
  const pl1 = await api("POST", "/donors/d_ac_a1/pledges", tokA, { amount: 10000, dueDate: "2027-06-30", campaignId: "c_ac_2" });
  ok("P2 pledge with campaignId → 201, stored", pl1.status === 201 && pl1.body.campaign_id === "c_ac_2", pl1.body);
  const plForeign = await api("POST", "/donors/d_ac_a1/pledges", tokA, { amount: 500, dueDate: "2027-06-30", campaignId: "c_ac_b1" });
  ok("P2 foreign campaign on pledge → 404, no row planted", plForeign.status === 404, plForeign.status);

  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  let c2 = campRow(camps, "c_ac_2");
  ok("P2 campaign shows pledged separately ($10,000 pledged)", c2.pledged === 10000 && c2.pledgeCount === 1, c2);
  ok("P2 pledge NEVER counts in raised ($0 raised)", c2.raised === 0, c2.raised);

  // Payment against the pledge inherits its campaign; pledged converts to raised.
  const pay1 = await api("POST", "/donors/d_ac_a1/gifts", tokA, { amount: 4000, date: TODAY, pledgeId: pl1.body.id });
  ok("P2 payment against pledge → 201", pay1.status === 201, pay1.body);
  ok("P2 payment INHERITED the pledge's campaign", pay1.body.gift.campaign_id === "c_ac_2" && pay1.body.gift.campaign === "Capital Push 2026", pay1.body.gift);
  ok("P2 pledge fulfilled by the payment", pay1.body.pledge && pay1.body.pledge.status === "fulfilled", pay1.body.pledge);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  c2 = campRow(camps, "c_ac_2");
  ok("P2 raised = the payment only ($4,000) — no pledge+payment double-count", c2.raised === 4000, c2);
  ok("P2 pledged dropped to $0 once fulfilled", c2.pledged === 0, c2.pledged);

  // PUT set/clear attribution on a fresh pledge.
  const pl2 = await api("POST", "/donors/d_ac_a2/pledges", tokA, { amount: 2000, dueDate: "2027-01-31" });
  ok("P2 unattributed pledge → 201", pl2.status === 201 && !pl2.body.campaign_id, pl2.body);
  const pl2set = await api("PUT", `/pledges/${pl2.body.id}`, tokA, { campaignId: "c_ac_2" });
  ok("P2 PUT sets campaign", pl2set.body.campaign_id === "c_ac_2", pl2set.body);
  const pl2foreign = await api("PUT", `/pledges/${pl2.body.id}`, tokA, { campaignId: "c_ac_b1" });
  ok("P2 PUT foreign campaign → 404", pl2foreign.status === 404, pl2foreign.status);
  const pl2clear = await api("PUT", `/pledges/${pl2.body.id}`, tokA, { campaignId: "" });
  ok("P2 PUT clears campaign", pl2clear.status === 200 && !pl2clear.body.campaign_id, pl2clear.body);
  await api("PUT", `/pledges/${pl2.body.id}`, tokA, { campaignId: "c_ac_2" }); // leave attributed+open for solicitations

  const sol = await api("GET", "/reports/solicitations", tokA);
  ok("P2 solicitations reports openPledges (1 open, $2,000)", sol.status === 200 && sol.body.openPledges && sol.body.openPledges.count === 1 && sol.body.openPledges.total === 2000, sol.body.openPledges);

  // ════ Part 3 — refunds/voids reverse attribution ════
  const donorBefore = (await q(`SELECT total_giving, gift_count FROM donors WHERE id='d_ac_a1'`))[0];
  const piRef = "pi_ac_" + crypto.randomBytes(5).toString("hex");
  await firePI({ email: "ada.ac@test.local", name: "Ada Complete", amountCents: 30000, piId: piRef, metadata: { campaign_id: "c_ac_1" } });
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P3 setup: $300 attributed gift raised the campaign to $525", campRow(camps, "c_ac_1").raised === 525, campRow(camps, "c_ac_1"));
  const gRef = (await q(`SELECT * FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG_A, piRef]))[0];

  // Plant an ACTIVE receipt on the gift — a full refund must auto-void it.
  await q(`INSERT INTO receipts (id,org_id,donor_id,gift_id,type,receipt_number,amount,deductible_amount,snapshot)
           VALUES ('rc_ac_1',$1,'d_ac_a1',$2,'gift','2026-90001',300,300,'{}')`, [ORG_A, gRef.id]);

  // PARTIAL refund first: $100 of $300 back → gift shrinks to $200.
  const stPart = await fireRefund({ piId: piRef, amountCents: 30000, refundedCents: 10000 });
  ok("P3 partial refund webhook → 200", stPart === 200, stPart);
  const gPart = (await q(`SELECT amount FROM gifts WHERE id=$1`, [gRef.id]))[0];
  ok("P3 partial refund shrank the gift to $200", parseFloat(gPart.amount) === 200, gPart);
  const ftPart = (await q(`SELECT amount FROM fin_transactions WHERE gift_id=$1`, [gRef.id]))[0];
  ok("P3 ledger stamp shrank with it ($200)", parseFloat(ftPart.amount) === 200, ftPart);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P3 campaign reversed partially ($425)", campRow(camps, "c_ac_1").raised === 425, campRow(camps, "c_ac_1"));

  // Redelivered partial-refund event → converges, no further change.
  await fireRefund({ piId: piRef, amountCents: 30000, refundedCents: 10000 });
  const gPart2 = (await q(`SELECT amount FROM gifts WHERE id=$1`, [gRef.id]))[0];
  ok("P3 redelivered refund event is a no-op (still $200)", parseFloat(gPart2.amount) === 200, gPart2);

  // FULL refund: gift's net effect becomes zero everywhere, exactly once.
  const stFull = await fireRefund({ piId: piRef, amountCents: 30000, refundedCents: 30000 });
  ok("P3 full refund webhook → 200", stFull === 200, stFull);
  ok("P3 gift row gone", (await q(`SELECT id FROM gifts WHERE id=$1`, [gRef.id])).length === 0);
  ok("P3 ledger stamp gone with it", (await q(`SELECT id FROM fin_transactions WHERE gift_id=$1`, [gRef.id])).length === 0);
  const rcAfter = (await q(`SELECT voided_at, void_reason, gift_id FROM receipts WHERE id='rc_ac_1'`))[0];
  ok("P3 active receipt auto-VOIDED on full refund", rcAfter.voided_at !== null && /refund/i.test(rcAfter.void_reason || "") && rcAfter.gift_id === null, rcAfter);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P3 campaign fully reversed ($225)", campRow(camps, "c_ac_1").raised === 225, campRow(camps, "c_ac_1"));
  const donorAfter = (await q(`SELECT total_giving, gift_count FROM donors WHERE id='d_ac_a1'`))[0];
  ok("P3 donor totals back to pre-gift state", parseFloat(donorAfter.total_giving) === parseFloat(donorBefore.total_giving) && donorAfter.gift_count === donorBefore.gift_count, { before: donorBefore, after: donorAfter });
  // Redelivered full refund: gift no longer resolves → no-op.
  const stGone = await fireRefund({ piId: piRef, amountCents: 30000, refundedCents: 30000 });
  ok("P3 redelivered full refund no-ops (200)", stGone === 200, stGone);

  // Manual void path — DELETE /gifts/:id on an attributed manual gift.
  const gMan = await api("POST", "/donors/d_ac_a2/gifts", tokA, { amount: 150, date: TODAY, campaignId: "c_ac_1" });
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P3 manual attributed gift raised campaign ($375)", campRow(camps, "c_ac_1").raised === 375, campRow(camps, "c_ac_1"));
  const del = await api("DELETE", `/gifts/${gMan.body.gift.id}`, tokA);
  ok("P3 manual void (gift delete) → 200", del.status === 200, del.body);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P3 manual void reversed the campaign ($225)", campRow(camps, "c_ac_1").raised === 225, campRow(camps, "c_ac_1"));

  // ════ Part 4 — donor-covers-fees ════
  const piFee = "pi_ac_" + crypto.randomBytes(5).toString("hex");
  // $50 intended, donor covered fees → $51.81 charged (5181¢, base 5000¢).
  await firePI({ email: "ada.ac@test.local", name: "Ada Complete", amountCents: 5181, piId: piFee, metadata: { campaign_id: "c_ac_1", cover_fees: "true", base_amount_cents: "5000" } });
  const gFee = (await q(`SELECT amount, cover_fee_amount FROM gifts WHERE org_id=$1 AND stripe_payment_id=$2`, [ORG_A, piFee]))[0];
  ok("P4 gift records the CHARGED total ($51.81)", parseFloat(gFee.amount) === 51.81, gFee);
  ok("P4 cover_fee_amount captured ($1.81)", Math.abs(parseFloat(gFee.cover_fee_amount) - 1.81) < 0.001, gFee);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P4 campaign counts the INTENDED gift ($50 → $275 total)", campRow(camps, "c_ac_1").raised === 275, campRow(camps, "c_ac_1"));
  const ftFee = (await q(`SELECT amount FROM fin_transactions WHERE gift_id=(SELECT id FROM gifts WHERE stripe_payment_id=$1)`, [piFee]))[0];
  ok("P4 Finance ledger keeps the charged total ($51.81)", parseFloat(ftFee.amount) === 51.81, ftFee);
  // The ONLY cents-carrying gift today is the grossed-up one — Reports carrying
  // .81 proves they count the CHARGED $51.81, not the netted $50.
  const gsNow = (await api("GET", `/reports/giving-summary?from=${TODAY}&to=${TODAY}`, tokA)).body;
  ok("P4 Reports count the charged total (money in — total ends in .81)", Math.round(gsNow.total * 100) % 100 === 81, gsNow.total);

  // ════ Part 5 — grants ════
  const gr1 = await api("POST", "/grants", tokA, { funder: "Bright Futures Foundation", program: "Capital", amount: 25000, status: "applied", campaignId: "c_ac_2" });
  ok("P5 grant with campaignId → 201, no awarded_at yet", gr1.status === 201 && gr1.body.campaign_id === "c_ac_2" && !gr1.body.awarded_at, gr1.body);
  const grForeign = await api("POST", "/grants", tokA, { funder: "Evil Fdn", campaignId: "c_ac_b1" });
  ok("P5 foreign campaign on grant → 404", grForeign.status === 404, grForeign.status);

  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  c2 = campRow(camps, "c_ac_2");
  ok("P5 un-awarded grant does NOT count ($4,000 raised)", c2.raised === 4000 && c2.grantAwarded === 0, c2);

  const giftCountBefore = (await q(`SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=$1`, [ORG_A]))[0].c;
  const grAward = await api("PUT", `/grants/${gr1.body.id}`, tokA, { funder: "Bright Futures Foundation", program: "Capital", amount: 25000, status: "awarded" });
  ok("P5 award transition stamps awarded_at (attribution kept without resending campaignId)", grAward.status === 200 && grAward.body.awarded_at != null && grAward.body.campaign_id === "c_ac_2", grAward.body);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  c2 = campRow(camps, "c_ac_2");
  ok("P5 awarded grant joins raised ($29,000 = $4,000 gifts + $25,000 grant)", c2.raised === 29000 && c2.grantAwarded === 25000 && c2.giftRaised === 4000, c2);
  const giftCountAfter = (await q(`SELECT COUNT(*)::int AS c FROM gifts WHERE org_id=$1`, [ORG_A]))[0].c;
  ok("P5 award created NO gift row (no double-count mechanism)", giftCountAfter === giftCountBefore, { giftCountBefore, giftCountAfter });

  const prog = (await api("GET", "/campaigns/c_ac_2/progress", tokA)).body;
  ok("P5 /campaigns/:id/progress agrees (raised, grantAwarded, pledged)", prog.raised === 29000 && prog.grantAwarded === 25000 && prog.pledged === 2000, prog);

  // Un-award (moved back to pending) → thermometer reverses.
  await api("PUT", `/grants/${gr1.body.id}`, tokA, { funder: "Bright Futures Foundation", program: "Capital", amount: 25000, status: "pending" });
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  c2 = campRow(camps, "c_ac_2");
  ok("P5 un-award reverses attribution ($4,000)", c2.raised === 4000 && c2.grantAwarded === 0, c2);
  // Re-award, then closed keeps it (a won grant's status moving on never drops the thermometer).
  await api("PUT", `/grants/${gr1.body.id}`, tokA, { funder: "Bright Futures Foundation", program: "Capital", amount: 25000, status: "awarded" });
  await api("PUT", `/grants/${gr1.body.id}`, tokA, { funder: "Bright Futures Foundation", program: "Capital", amount: 25000, status: "closed" });
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("P5 awarded→closed keeps the attribution ($29,000)", campRow(camps, "c_ac_2").raised === 29000, campRow(camps, "c_ac_2"));

  // ════ Part 6 (server side) — count-matches-destination ════
  const ov = (await api("GET", "/fundraising/overview", tokA)).body;
  ok("P6 thisWeek exposes its window (start/end)", !!ov.thisWeek.start && !!ov.thisWeek.end, ov.thisWeek);
  const gsWeek = (await api("GET", `/reports/giving-summary?from=${ov.thisWeek.start}&to=${ov.thisWeek.end}`, tokA)).body;
  ok("P6 This-week chip == its destination total", Math.abs(gsWeek.total - ov.thisWeek.raised) < 0.001, { chip: ov.thisWeek.raised, dest: gsWeek.total });
  ok("P6 This-week chip == its destination gift count", gsWeek.giftCount === ov.thisWeek.giftCount, { chip: ov.thisWeek.giftCount, dest: gsWeek.giftCount });
  const now = new Date();
  const CUR_FY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const gsFY = (await api("GET", `/reports/giving-summary?year=${CUR_FY}&yearMode=fiscal`, tokA)).body;
  ok("P6 This-FY chip == Giving Summary current FY total", Math.abs(gsFY.total - ov.period.raised) < 0.001, { chip: ov.period.raised, dest: gsFY.total });

  const imp = (await api("GET", "/impact", tokA)).body;
  const listSum = (imp.reengagedDonors || []).reduce((s, r) => s + r.amount, 0);
  ok("P6 re-engaged drill-down list ships with /impact", Array.isArray(imp.reengagedDonors), imp.reengagedDonors);
  ok("P6 re-engaged chip amount == Σ drill-down rows", Math.abs(listSum - imp.reengagedAmount) < 0.001, { chip: imp.reengagedAmount, list: listSum });
  ok("P6 re-engaged chip donor count == drill-down row count", (imp.reengagedDonors || []).length === imp.reengagedDonorCount, { chip: imp.reengagedDonorCount, rows: (imp.reengagedDonors || []).length });

  // ════ Org isolation — org B sees none of it ════
  const campsB = (await api("GET", "/fundraising/campaigns", tokB)).body;
  ok("ISO org B campaign untouched by everything above", campRow(campsB, "c_ac_b1").raised === 0 && campRow(campsB, "c_ac_b1").pledged === 0 && campRow(campsB, "c_ac_b1").grantAwarded === 0, campRow(campsB, "c_ac_b1"));
  const pagesB = (await api("GET", "/giving-pages", tokB)).body;
  ok("ISO org B sees no org A pages", pagesB.every(x => x.org_id !== ORG_A), pagesB.length);

  await closeDb();
  summary();
}

run().catch(e => { console.error(e); process.exit(1); });
