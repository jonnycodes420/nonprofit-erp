// BUILD-32 Part 1 — gift → campaign attribution.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// What it proves:
//   - POST /donors/:id/gifts accepts campaignId (and campaign_id alias), writes
//     gifts.campaign_id, and validates it org-scoped (foreign → 404)
//   - a campaign's raised/percent recompute LIVE from attributed gifts the moment
//     a gift is attributed (never a stored counter)
//   - PUT /gifts/:id can set / change / clear campaign attribution
//   - the fund_id/fundId spelling mismatch is fixed (Add-Gift form's fund lands)
//   - import path: a gift carrying the campaign NAME rolls up to that campaign
//   - online/Stripe webhook path: a gift with campaign_id in PI metadata rolls up
//   - an UNATTRIBUTED gift still posts to org totals (donor total, org gift sum)
//   - the pure fuzzy-matcher (client/src/lib/campaignMatch.js): exact, contains,
//     token, typo hits; ambiguous → no suggestion; unrelated → null
//   - org isolation both ways

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_ga_a";
const ORG_B = "org_ga_b";
const iso = d => d.toISOString().slice(0, 10);
const TODAY = iso(new Date());

async function fixture() {
  // Children first (FK-safe), then donors, then campaigns/funds/accounts, users, org.
  const CHILD = [
    "workflow_runs", "workflows", "digest_sends", "moves", "opportunities", "tasks",
    "payment_recovery_events", "recurring_subscriptions", "receipts", "pledges",
    "fin_audit_log", "fin_transactions", "gifts", "interactions",
  ];
  for (const org of [ORG_A, ORG_B]) {
    for (const t of CHILD) await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    for (const t of ["donors", "campaigns", "fin_funds", "accounts", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]).catch(() => {});
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'Attr A','ga-a',1,'active','growth','acct_ga_a')`, [ORG_A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ga_a',$1,'ga-a@test.local',$2,'GA A','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_ga_a1',$1,'Ada Attr','ada.ga@test.local','mid','cultivate',0,0)`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_ga_a2',$1,'Ben Attr','ben.ga@test.local','new','cultivate',0,0)`, [ORG_A]);
  // Goal'd campaign with a thermometer (the whole point — attribution must move it)
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,recipient_count,open_count) VALUES ('c_ga_1',$1,'Spring Studio Scholarships','appeal','draft',15000,0,0)`, [ORG_A]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,recipient_count,open_count) VALUES ('c_ga_2',$1,'Annual Fund 2026','appeal','draft',60000,0,0)`, [ORG_A]);
  // A fin account so the gift ledger stamp path runs
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_ga_rev',$1,'4010','Contributions','revenue') ON CONFLICT DO NOTHING`, [ORG_A]).catch(()=>{});
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_ga_gen',$1,'General',false) ON CONFLICT DO NOTHING`, [ORG_A]).catch(()=>{});

  // Org B — isolation probe
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,stripe_account_id) VALUES ($1,'Attr B','ga-b',1,'active','growth','acct_ga_b')`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_ga_b',$1,'ga-b@test.local',$2,'GA B','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_ga_b1',$1,'Bob B','bob.ga@test.local','new','cultivate',0,0)`, [ORG_B]);
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount) VALUES ('c_ga_b1',$1,'Org B Campaign','appeal','draft',5000)`, [ORG_B]);
}

const raisedFor = (rows, id) => { const r = (rows || []).find(x => x.id === id); return r ? r.raised : null; };

async function run() {
  await fixture();
  const tokA = await login("ga-a@test.local");
  const tokB = await login("ga-b@test.local");

  // ── 1. campaignId attribution moves the thermometer live ──
  let camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("campaign starts at $0 raised", raisedFor(camps, "c_ga_1") === 0, raisedFor(camps, "c_ga_1"));

  const g1 = await api("POST", "/donors/d_ga_a1/gifts", tokA, { amount: 5000, date: TODAY, campaignId: "c_ga_1", fundId: "fund_ga_gen" });
  ok("gift with campaignId → 201", g1.status === 201, g1.body);
  const g1row = (await q(`SELECT campaign_id, campaign, fund_id FROM gifts WHERE id=$1`, [g1.body.gift.id]))[0];
  ok("gift.campaign_id persisted", g1row.campaign_id === "c_ga_1", g1row);
  ok("gift.campaign name synced from campaign", g1row.campaign === "Spring Studio Scholarships", g1row);
  ok("gift.fund_id persisted (fundId spelling)", g1row.fund_id === "fund_ga_gen", g1row);

  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("thermometer moved to $5,000 live", raisedFor(camps, "c_ga_1") === 5000, raisedFor(camps, "c_ga_1"));
  const c1 = camps.find(c => c.id === "c_ga_1");
  ok("campaign percent recomputed (5000/15000≈33%)", c1 && Math.round(c1.percent) === 33, c1 && c1.percent);

  // second attributed gift from another donor → raised + donorCount both move
  await api("POST", "/donors/d_ga_a2/gifts", tokA, { amount: 2500, date: TODAY, campaignId: "c_ga_1" });
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("thermometer now $7,500 (live SUM, not stored)", raisedFor(camps, "c_ga_1") === 7500, raisedFor(camps, "c_ga_1"));
  ok("donorCount now 2", camps.find(c => c.id === "c_ga_1").donorCount === 2);

  // ── 2. campaign_id alias also accepted ──
  const g3 = await api("POST", "/donors/d_ga_a1/gifts", tokA, { amount: 1000, date: TODAY, campaign_id: "c_ga_2" });
  ok("gift with campaign_id alias → 201", g3.status === 201);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("Annual Fund raised $1,000 via alias", raisedFor(camps, "c_ga_2") === 1000, raisedFor(camps, "c_ga_2"));

  // ── 3. foreign campaign id rejected (org isolation on attribution) ──
  const gForeign = await api("POST", "/donors/d_ga_a1/gifts", tokA, { amount: 100, date: TODAY, campaignId: "c_ga_b1" });
  ok("gift with FOREIGN campaign id → 404", gForeign.status === 404, gForeign.body);
  const planted = await q(`SELECT COUNT(*)::int c FROM gifts WHERE campaign_id='c_ga_b1'`);
  ok("no gift planted with foreign campaign_id", planted[0].c === 0);

  // ── 4. unattributed gift still posts to org totals ──
  const donorBefore = (await q(`SELECT total_giving FROM donors WHERE id='d_ga_a2'`))[0];
  const gUn = await api("POST", "/donors/d_ga_a2/gifts", tokA, { amount: 800, date: TODAY });
  ok("unattributed gift → 201", gUn.status === 201);
  const gUnRow = (await q(`SELECT campaign_id FROM gifts WHERE id=$1`, [gUn.body.gift.id]))[0];
  ok("unattributed gift has NULL campaign_id", gUnRow.campaign_id === null, gUnRow);
  const donorAfter = (await q(`SELECT total_giving FROM donors WHERE id='d_ga_a2'`))[0];
  ok("donor total still incremented by unattributed gift", Number(donorAfter.total_giving) - Number(donorBefore.total_giving) === 800, { b: donorBefore, a: donorAfter });

  // ── 5. PUT /gifts/:id changes attribution live ──
  const putMove = await api("PUT", `/gifts/${g1.body.gift.id}`, tokA, { campaignId: "c_ga_2", fund_id: "fund_ga_gen" });
  ok("PUT re-attribute → 200", putMove.status === 200, putMove.body);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("moved $5,000 off Spring (now $2,500)", raisedFor(camps, "c_ga_1") === 2500, raisedFor(camps, "c_ga_1"));
  ok("onto Annual (now $6,000)", raisedFor(camps, "c_ga_2") === 6000, raisedFor(camps, "c_ga_2"));
  // clear attribution
  const putClear = await api("PUT", `/gifts/${g1.body.gift.id}`, tokA, { campaignId: "", fund_id: "fund_ga_gen" });
  ok("PUT clear attribution → 200", putClear.status === 200);
  const cleared = (await q(`SELECT campaign_id FROM gifts WHERE id=$1`, [g1.body.gift.id]))[0];
  ok("gift.campaign_id cleared to NULL", cleared.campaign_id === null, cleared);
  // PUT foreign campaign → 404
  const putForeign = await api("PUT", `/gifts/${g3.body.gift.id}`, tokA, { campaignId: "c_ga_b1", fund_id: null });
  ok("PUT foreign campaign → 404", putForeign.status === 404);

  // ── 6. import path: gift carrying campaign NAME rolls up by name-match ──
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('g_imp_1',$1,'d_ga_a1',3000,$2,'cash','Spring Studio Scholarships')`, [ORG_A, TODAY]);
  camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
  ok("imported gift (campaign NAME) rolls up: Spring back to $5,500", raisedFor(camps, "c_ga_1") === 5500, raisedFor(camps, "c_ga_1"));

  // ── 7. online/Stripe webhook path: campaign_id from PI metadata rolls up ──
  const webhookOk = await fireWebhookGift(ORG_A, "acct_ga_a", "d_ga_a1", 4000, "c_ga_2");
  if (webhookOk !== "skipped") {
    camps = (await api("GET", "/fundraising/campaigns", tokA)).body;
    ok("online gift (PI metadata campaign_id) rolls up: Annual +$4,000", raisedFor(camps, "c_ga_2") === 10000, raisedFor(camps, "c_ga_2"));
  } else {
    ok("online gift webhook path (skipped — no signing secret)", true);
  }

  // ── 8. org isolation: org B can't attribute to org A's campaign, sees none of A's ──
  const bAttr = await api("POST", "/donors/d_ga_b1/gifts", tokB, { amount: 100, date: TODAY, campaignId: "c_ga_1" });
  ok("org B attributing to org A's campaign → 404", bAttr.status === 404);
  const bCamps = (await api("GET", "/fundraising/campaigns", tokB)).body;
  ok("org B sees only its own campaigns", Array.isArray(bCamps) && bCamps.every(c => c.id.startsWith("c_ga_b")));

  // ── 9. the pure fuzzy matcher ──
  const { bestCampaignMatch, campaignMatchScore } = await import("../client/src/lib/campaignMatch.js");
  const camplist = [{ id: "c_ga_1", name: "Spring Studio Scholarships" }, { id: "c_ga_2", name: "Annual Fund 2026" }];
  ok("exact match suggested", bestCampaignMatch("Spring Studio Scholarships", camplist)?.id === "c_ga_1");
  ok("case-insensitive exact", bestCampaignMatch("spring studio scholarships", camplist)?.id === "c_ga_1");
  ok("substring/phrase match", bestCampaignMatch("Studio Scholarships", camplist)?.id === "c_ga_1");
  ok("typo tolerated", bestCampaignMatch("Anual Fund 2026", camplist)?.id === "c_ga_2");
  ok("unrelated text → no suggestion", bestCampaignMatch("General Operating", camplist) === null);
  ok("empty text → null", bestCampaignMatch("", camplist) === null);
  ok("exact score is 1", campaignMatchScore("Annual Fund 2026", "Annual Fund 2026") === 1);
  // ambiguity: two near-identical campaigns, a value fitting both equally → null
  const amb = [{ id: "x1", name: "Fall Gala" }, { id: "x2", name: "Fall Gala" }];
  ok("ambiguous (tie) → no suggestion", bestCampaignMatch("Fall Gala", amb) === null);

  await closeDb();
  summary();
}

// Fire a Stripe-signed payment_intent.succeeded at the connected-account webhook,
// mirroring consistency-e2e's approach. Skips cleanly if no signing secret.
async function fireWebhookGift(orgId, acct, donorId, amountDollars, campaignId) {
  // Matches the tests/README.md boot recipe (server booted with whsec_localtest).
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_localtest";
  const donor = (await q(`SELECT email, name FROM donors WHERE id=$1`, [donorId]))[0];
  const piId = "pi_ga_" + crypto.randomBytes(5).toString("hex");
  const event = {
    id: "evt_ga_" + crypto.randomBytes(5).toString("hex"),
    type: "payment_intent.succeeded",
    account: acct,
    data: { object: {
      id: piId, amount_received: amountDollars * 100, currency: "usd",
      metadata: { donor_email: donor.email, donor_name: donor.name, campaign_id: campaignId },
    } },
  };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const r = await fetch(BASE + "/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${sig}` },
    body: payload,
  });
  return r.status;
}

run().catch(e => { console.error(e); process.exit(1); });
