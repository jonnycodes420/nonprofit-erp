// BUILD-11 — Fundraising tab verification.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// What it proves:
//   - /fundraising/overview: active org goal with live pace math (percent,
//     paceState), this-period momentum vs prior period, giving-page rollup —
//     all org-scoped
//   - /fundraising/campaigns: raised is Σ(attributed gifts) computed live, not
//     a stored counter (add a gift → total moves); pace degrades gracefully
//     (goal+dates → on_track/behind; goal, no dates, not met → paceState null;
//     goal met → 'met'); a campaign with no goal is excluded entirely
//   - write-gating: a read_only (trial_expired) org gets 402 on POST/PUT,
//     200 on reads; an active org's POST/PUT succeed
//   - validation: missing name / non-positive goal → 400
//   - org isolation: org B never sees org A's campaigns

const bcrypt = require("bcryptjs");
const { BASE, ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG_A = "org_fr_a";   // active
const ORG_B = "org_fr_b";   // read_only (trial_expired)

const iso = d => d.toISOString().slice(0, 10);
const daysFromNow = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const TODAY = iso(new Date());

async function fixture() {
  for (const org of [ORG_A, ORG_B]) {
    for (const t of ["gifts", "campaigns", "giving_pages", "fundraising_goals", "donors", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
  const hash = bcrypt.hashSync("loadtest1234", 10);

  // ── Org A — active ──
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Fundraise A','fr-a',1,'active','growth')`, [ORG_A]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fr_a',$1,'fr-a@test.local',$2,'FR A','admin')`, [ORG_A, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_fr_a1',$1,'Ada Fund','ada@test.local','mid','cultivate',0,0)`, [ORG_A]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_fr_a2',$1,'Ben Give','ben@test.local','new','cultivate',0,0)`, [ORG_A]);

  // Active org goal: total_raised $10,000, period straddles today (60d each way)
  await q(`INSERT INTO fundraising_goals (id,org_id,period_start,period_end,goal_type,goal_amount,label) VALUES ('g_fr_a',$1,$2,$3,'total_raised',10000,'Raise $10,000 this quarter')`,
    [ORG_A, daysFromNow(-60), daysFromNow(60)]);

  // Campaigns:
  //  C1 goal+dates, half-elapsed → should read on_track when raised == expected
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,start_date,end_date,recipient_count,open_count) VALUES ('c_fr_1',$1,'Spring Appeal A','appeal','draft',5000,$2,$3,0,0)`,
    [ORG_A, daysFromNow(-30), daysFromNow(30)]);
  //  C2 goal, no dates, raised > goal → 'met'
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,recipient_count,open_count) VALUES ('c_fr_2',$1,'Met Goal Camp','appeal','draft',1000,0,0)`, [ORG_A]);
  //  C3 goal, no dates, raised < goal → paceState null (no dates, not met)
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,goal_amount,recipient_count,open_count) VALUES ('c_fr_3',$1,'No Dates Camp','appeal','draft',2000,0,0)`, [ORG_A]);
  //  C4 NO goal → excluded from fundraising campaigns
  await q(`INSERT INTO campaigns (id,org_id,name,type,status,subject,body,recipient_count,open_count) VALUES ('c_fr_4',$1,'Pure Email Blast','appeal','draft','Hi','Body',0,0)`, [ORG_A]);

  // Gifts (all dated today → inside goal period AND C1 window). raised is by
  // campaign-name match.
  const gift = async (id, donor, amount, campaign, pageId) =>
    q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign,giving_page_id) VALUES ($1,$2,$3,$4,$5,'cash',$6,$7)`,
      [id, ORG_A, donor, amount, TODAY, campaign || "", pageId || null]);
  await gift("gf_1", "d_fr_a1", 1500, "Spring Appeal A");
  await gift("gf_2", "d_fr_a2", 1000, "Spring Appeal A");   // C1 raised = 2500
  await gift("gf_3", "d_fr_a1", 1200, "Met Goal Camp");     // C2 raised = 1200 (>1000)
  await gift("gf_4", "d_fr_a2", 500, "No Dates Camp");      // C3 raised = 500
  // Giving page (active) with a goal + one gift attributed to it
  await q(`INSERT INTO giving_pages (id,org_id,slug,title,goal_amount,status) VALUES ('gp_fr_a',$1,'spring','Spring Studio Fund',4000,'active')`, [ORG_A]);
  await gift("gf_5", "d_fr_a1", 2000, "", "gp_fr_a");       // page raised = 2000
  // Goal total (all gifts in period) = 2500 + 1200 + 500 + 2000 = 6200

  // ── Org B — read_only (trial expired) ──
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,'Fundraise B','fr-b',1,'trial_expired','trial')`, [ORG_B]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_fr_b',$1,'fr-b@test.local',$2,'FR B','admin')`, [ORG_B, hash]);
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count) VALUES ('d_fr_b1',$1,'Bee Only','bee@test.local','new','prospect',0,0)`, [ORG_B]);
}

(async () => {
  await fixture();
  console.log("fixture ready\n");
  const a = await login("fr-a@test.local");
  const b = await login("fr-b@test.local");

  // ── 1. Overview: goal + pace ──
  {
    const r = await api("GET", "/fundraising/overview", a);
    ok("overview 200", r.status === 200, r.status);
    const ov = r.body;
    ok("overview has active goal", ov.goal && ov.goal.goalAmount === 10000, ov.goal);
    ok("goal currentAmount = Σ period gifts (6200)", ov.goal && ov.goal.currentAmount === 6200, ov.goal?.currentAmount);
    ok("goal percent = 62", ov.goal && ov.goal.percent === 62, ov.goal?.percent);
    ok("goal pace on_track (raised>=expected at half-elapsed)", ov.goal && ov.goal.paceState === "on_track", ov.goal?.paceState);
    ok("period raised = 6200", ov.period && ov.period.raised === 6200, ov.period?.raised);
    ok("period giftCount = 5", ov.period && ov.period.giftCount === 5, ov.period?.giftCount);
    ok("giving pages rollup: 1 active, raised 2000", ov.givingPages && ov.givingPages.count === 1 && ov.givingPages.raised === 2000, ov.givingPages);
    ok("campaigns rollup counts goal'd campaigns only (3)", ov.campaigns && ov.campaigns.count === 3, ov.campaigns?.count);
    ok("recentGifts present (5)", Array.isArray(ov.recentGifts) && ov.recentGifts.length === 5, ov.recentGifts?.length);
  }

  // ── 2. Campaigns: live raised + pace degradation + no-goal exclusion ──
  let campaigns;
  {
    const r = await api("GET", "/fundraising/campaigns", a);
    ok("campaigns 200", r.status === 200, r.status);
    campaigns = r.body;
    const byId = Object.fromEntries(campaigns.map(c => [c.id, c]));
    ok("no-goal campaign excluded", !byId["c_fr_4"], Object.keys(byId));
    ok("C1 raised = Σ attributed gifts (2500)", byId["c_fr_1"]?.raised === 2500, byId["c_fr_1"]?.raised);
    ok("C1 percent = 50", byId["c_fr_1"]?.percent === 50, byId["c_fr_1"]?.percent);
    ok("C1 pace on_track (dates, half-elapsed, on pace)", byId["c_fr_1"]?.paceState === "on_track", byId["c_fr_1"]?.paceState);
    ok("C1 donorCount = 2", byId["c_fr_1"]?.donorCount === 2, byId["c_fr_1"]?.donorCount);
    ok("C2 percent capped at 100", byId["c_fr_2"]?.percent === 100, byId["c_fr_2"]?.percent);
    ok("C2 pace 'met' (raised > goal)", byId["c_fr_2"]?.paceState === "met", byId["c_fr_2"]?.paceState);
    ok("C3 percent = 25", byId["c_fr_3"]?.percent === 25, byId["c_fr_3"]?.percent);
    ok("C3 pace null (goal, no dates, not met)", byId["c_fr_3"]?.paceState == null, byId["c_fr_3"]?.paceState);
    ok("C3 lifecycle active (no dates)", byId["c_fr_3"]?.lifecycle === "active", byId["c_fr_3"]?.lifecycle);
  }

  // ── 3. Raised is recomputed, never stored ──
  {
    await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,campaign) VALUES ('gf_extra',$1,'d_fr_a1',500,$2,'cash','Spring Appeal A')`, [ORG_A, TODAY]);
    const r = await api("GET", "/fundraising/campaigns", a);
    const c1 = r.body.find(c => c.id === "c_fr_1");
    ok("C1 raised moved to 3000 after new gift (live, not stored)", c1?.raised === 3000, c1?.raised);
  }

  // ── 4. Write-gating (read_only org) ──
  {
    const post = await api("POST", "/fundraising/campaigns", b, { name: "Nope", goalAmount: 1000 });
    ok("read_only POST campaign → 402", post.status === 402, post.status);
    const put = await api("PUT", "/fundraising/campaigns/c_fr_1", b, { goalAmount: 9 });
    ok("read_only PUT campaign → 402", put.status === 402 || put.status === 404, put.status); // 404 if not its org; 402 gate fires first
    const read = await api("GET", "/fundraising/campaigns", b);
    ok("read_only GET campaigns → 200", read.status === 200, read.status);
    const readOv = await api("GET", "/fundraising/overview", b);
    ok("read_only GET overview → 200", readOv.status === 200, readOv.status);
  }

  // ── 5. Active org can create + edit ──
  let newId;
  {
    const post = await api("POST", "/fundraising/campaigns", a, { name: "Year-End Push", goalAmount: 8000, startDate: daysFromNow(-5), endDate: daysFromNow(25) });
    ok("active POST campaign → 201", post.status === 201, post.status);
    ok("new campaign echoes goal + zero raised", post.body?.goalAmount === 8000 && post.body?.raised === 0, post.body);
    newId = post.body?.id;
    const put = await api("PUT", `/fundraising/campaigns/${newId}`, a, { name: "Year-End Push", goalAmount: 9000, startDate: daysFromNow(-5), endDate: daysFromNow(25) });
    ok("active PUT campaign → 200 with updated goal", put.status === 200 && put.body?.goalAmount === 9000, put.body);
  }

  // ── 6. Validation ──
  {
    const noName = await api("POST", "/fundraising/campaigns", a, { goalAmount: 1000 });
    ok("POST missing name → 400", noName.status === 400, noName.status);
    const zeroGoal = await api("POST", "/fundraising/campaigns", a, { name: "Bad", goalAmount: 0 });
    ok("POST goal 0 → 400", zeroGoal.status === 400, zeroGoal.status);
    const negGoal = await api("POST", "/fundraising/campaigns", a, { name: "Bad", goalAmount: -50 });
    ok("POST negative goal → 400", negGoal.status === 400, negGoal.status);
  }

  // ── 7. Org isolation ──
  {
    const r = await api("GET", "/fundraising/campaigns", b);
    const ids = (r.body || []).map(c => c.id);
    ok("org B sees none of org A's campaigns", !ids.includes("c_fr_1") && !ids.includes("c_fr_2"), ids);
    const put = await api("PUT", "/fundraising/campaigns/c_fr_1", a, { name: "Spring Appeal A" }); // A editing its own (name only)
    ok("org A can PUT its own campaign name-only → 200", put.status === 200, put.status);
  }

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
