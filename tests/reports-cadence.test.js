// BUILD-17 — Development reporting cadence: the report views.
// Local scratch server + Postgres (tests/README.md recipe). No external creds.
//
// Proves:
//   - 3-year donor comparison [Core]: per-donor YoYoY columns, org trend,
//     growth %, change % — vs hand-computed fixtures across three fiscal years
//   - annual report [Core]: totals, growth vs prior, new/returning, retention,
//     by-fund / by-campaign breakdown
//   - robust solicitations report [Team]: open-asks-by-stage, stage-weighted
//     forecast (self-consistent), asks-vs-closes by officer, aging prospects
//   - [Team] gating: solicitations 403s on a Core org
//   - CSV injection guard still holds on the new reports (=SUM(...) → '=SUM)
//   - org isolation

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const TEAM = "org_rc_team", CORE = "org_rc_core", OTHER = "org_rc_other";
// Fiscal-year anchored gift dates. FY N = Jul 1 (N-1) → Jun 30 N.
const FY2027 = "2026-09-01", FY2026 = "2025-09-01", FY2025 = "2024-09-01";

async function reset() {
  for (const org of [TEAM, CORE, OTHER]) {
    for (const t of ["moves", "opportunities", "gifts", "donors", "users", "fin_funds", "campaigns"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, plan, sub, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,$4,$5)`, [o, `RC ${tag}`, `rc-${tag}`, sub, plan]);
}
async function seedUser(o, id, tag, role = "admin") {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,$6)`, [id, o, `${tag}@rc.local`, hash, `User ${tag}`, role]);
}
async function seedDonor(o, id, name, stage = "cultivate", owner = null, ownerName = null, total = 0) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,assigned_to,assigned_to_name) VALUES ($1,$2,$3,$4,'mid',$5,$6,1,$7,$8)`,
    [id, o, name, `${id}@rc.local`, stage, total, owner, ownerName]);
}
async function seedGift(o, donorId, amount, date, fundId = null, campaignId = null) {
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,fund_id,campaign_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ["g_" + Math.random().toString(36).slice(2, 9), o, donorId, amount, date, fundId, campaignId]);
}
async function seedFund(o, id, name) { await q(`INSERT INTO fin_funds (id,org_id,name) VALUES ($1,$2,$3)`, [id, o, name]); }
async function seedCampaign(o, id, name) { await q(`INSERT INTO campaigns (id,org_id,name) VALUES ($1,$2,$3)`, [id, o, name]); }
async function seedOpp(o, donorId, officerId, name, target, status = "open", giftAmount = null) {
  await q(`INSERT INTO opportunities (id,org_id,donor_id,officer_id,officer_name,name,target_amount,status,gift_amount,closed_at) VALUES ($1,$2,$3,$4,'off',$5,$6,$7,$8,$9)`,
    ["op_" + Math.random().toString(36).slice(2, 9), o, donorId, officerId, name, target, status, giftAmount, status === "won" ? new Date().toISOString().slice(0, 10) + " 10:00:00" : null]);
}
async function seedMove(o, donorId, officerId, to, daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo);
  await q(`INSERT INTO moves (id,org_id,donor_id,officer_id,officer_name,from_stage,to_stage,description,created_at) VALUES ($1,$2,$3,$4,'off','prospect',$5,'m',$6)`,
    ["mv_" + Math.random().toString(36).slice(2, 9), o, donorId, officerId, to, d.toISOString()]);
}

(async () => {
  await reset();

  // ── TEAM org — three years of giving + a solicitation pipeline ────────────
  await seedOrg(TEAM, "growth", "active", "team");
  await seedUser(TEAM, "u_rc", "rc", "admin");
  await seedFund(TEAM, "fund_rc_ops", "Operating");
  await seedCampaign(TEAM, "camp_rc_spring", "Spring Appeal");
  // donor A: gave FY2027 ($1000, to fund+campaign) and FY2026 ($500)
  await seedDonor(TEAM, "rc_a", "Alice Aardvark", "steward", "u_rc", "User rc", 1500);
  await seedGift(TEAM, "rc_a", 1000, FY2027, "fund_rc_ops", "camp_rc_spring");
  await seedGift(TEAM, "rc_a", 500, FY2026);
  // donor B: gave only FY2025 ($300)
  await seedDonor(TEAM, "rc_b", "Bob Buffalo", "cultivate", "u_rc", "User rc", 300);
  await seedGift(TEAM, "rc_b", 300, FY2025);
  // donor F: a formula-injection name, gave FY2027 ($100)
  await seedDonor(TEAM, "rc_f", "=SUM(A1:A9)", "prospect", "u_rc", "User rc", 100);
  await seedGift(TEAM, "rc_f", 100, FY2027);

  const tok = await login("rc@rc.local");

  // ── 1) Three-year comparison ──────────────────────────────────────────────
  const ty = (await api("GET", "/reports/three-year?year=2027&yearMode=fiscal", tok)).body;
  ok("three-year labels newest→oldest", ty.labels.y0 === "FY2027" && ty.labels.y1 === "FY2026" && ty.labels.y2 === "FY2025", ty.labels);
  const yr = y => ty.years.find(x => x.year === y).total;
  ok("org FY2027 total = 1100 (A 1000 + F 100)", yr(2027) === 1100, yr(2027));
  ok("org FY2026 total = 500", yr(2026) === 500, yr(2026));
  ok("org FY2025 total = 300", yr(2025) === 300, yr(2025));
  ok("org growth % = (1100-500)/500 = 120", ty.orgGrowthPct === 120, ty.orgGrowthPct);
  const rowA = ty.rows.find(r => r.id === "rc_a");
  ok("donor A columns y0/y1/y2 = 1000/500/0", rowA.y0 === 1000 && rowA.y1 === 500 && rowA.y2 === 0, rowA);
  ok("donor A YoY change % = 100 (up)", rowA.changePct === 100 && rowA.trend === "up", rowA);
  const rowB = ty.rows.find(r => r.id === "rc_b");
  ok("donor B only in FY2025 (y0=0,y2=300)", rowB.y0 === 0 && rowB.y2 === 300, rowB);
  ok("rows ordered by 3-year total desc (A first)", ty.rows[0].id === "rc_a", ty.rows[0].id);

  // ── 2) Annual report ──────────────────────────────────────────────────────
  const an = (await api("GET", "/reports/annual?year=2027&yearMode=fiscal", tok)).body;
  ok("annual FY2027 total = 1100", an.total === 1100, an.total);
  ok("annual gift count = 2", an.giftCount === 2, an.giftCount);
  ok("annual unique donors = 2 (A + F)", an.uniqueDonors === 2, an.uniqueDonors);
  ok("annual growth vs FY2026 = 120%", an.growthPct === 120, an.growthPct);
  // new = first-ever gift in FY2027. A's first gift is FY2026 → returning; F's first is FY2027 → new.
  ok("annual new donors = 1 (F), returning = 1 (A)", an.newDonors === 1 && an.returningDonors === 1, { n: an.newDonors, r: an.returningDonors });
  // retention: FY2026 donors (A) who gave again FY2027 (A did) → 100%
  ok("annual retention = 100% (A gave both years)", an.retentionRate === 100 && an.priorDonors === 1 && an.retainedDonors === 1, an);
  ok("annual by-fund has Operating $1000 + No fund $100", an.byFund.find(f => f.name === "Operating").total === 1000 && an.byFund.find(f => f.name === "No fund").total === 100, an.byFund);
  ok("annual by-campaign has Spring Appeal $1000", an.byCampaign.find(c => c.name === "Spring Appeal").total === 1000, an.byCampaign);

  // ── 3) Robust solicitations report [Team] ─────────────────────────────────
  // rc_a is 'steward', rc_b 'cultivate'. Open asks: A $10000, B $5000. One won.
  await seedOpp(TEAM, "rc_a", "u_rc", "Steward ask", 10000, "open");
  await seedOpp(TEAM, "rc_b", "u_rc", "Cultivate ask", 5000, "open");
  await seedOpp(TEAM, "rc_a", "u_rc", "Closed ask", 3000, "won", 4000);
  await seedMove(TEAM, "rc_a", "u_rc", "steward", 40);   // stalled 40 days in stage
  const wideFrom = "2020-01-01", wideTo = new Date().toISOString().slice(0, 10);
  const sol = (await api("GET", `/reports/solicitations?from=${wideFrom}&to=${wideTo}`, tok)).body;
  const stageAsk = st => sol.byStage.find(s => s.stage === st);
  ok("solicitations forecast.open = 15000 (10000+5000 open)", sol.forecast.open === 15000, sol.forecast.open);
  // weighted = 10000*0.9 (steward) + 5000*0.4 (cultivate) = 9000 + 2000 = 11000
  ok("solicitations weighted forecast = 11000", sol.forecast.weighted === 11000, sol.forecast.weighted);
  ok("byStage steward ask = 10000 (weight 0.9)", stageAsk("steward").ask === 10000 && stageAsk("steward").weight === 0.9, stageAsk("steward"));
  ok("byStage cultivate ask = 5000", stageAsk("cultivate").ask === 5000, stageAsk("cultivate"));
  const off = sol.byOfficer.find(o => o.officerId === "u_rc");
  ok("officer open asks = 2 ($15000)", off.openAsks === 2 && off.openAskAmount === 15000, off);
  ok("officer gifts closed = 1 ($4000)", off.giftsClosed === 1 && off.giftsClosedAmount === 4000, off);
  ok("aging prospects surfaces the stalled steward ask", sol.aging.some(a => a.id === "rc_a" && a.stageAge >= 39), sol.aging);

  // ── 4) [Team] gating ──────────────────────────────────────────────────────
  await seedOrg(CORE, "seed", "active", "core");
  await seedUser(CORE, "u_rcc", "rcc", "admin");
  const coreTok = await login("rcc@rc.local");
  // BUILD-20 Part 4: Core gets a READ-only locked PREVIEW (200 + locked:true,
  // own data) instead of a bare 403 — but CSV export stays Team-only (403).
  const coreSol = await api("GET", "/reports/solicitations", coreTok);
  ok("Core org → solicitations locked preview (200 + locked:true)", coreSol.status === 200 && coreSol.body.locked === true, coreSol.status);
  const coreSolCsv = await api("GET", "/reports/solicitations?format=csv", coreTok);
  ok("Core org → solicitations CSV export still 403 plan_required", coreSolCsv.status === 403 && coreSolCsv.body.error === "plan_required", coreSolCsv.status);
  const coreTy = await api("GET", "/reports/three-year?year=2027", coreTok);
  ok("Core org → three-year 200 ([Core] report)", coreTy.status === 200, coreTy.status);
  const coreAn = await api("GET", "/reports/annual?year=2027", coreTok);
  ok("Core org → annual 200 ([Core] report)", coreAn.status === 200, coreAn.status);

  // ── 5) CSV injection guard on new reports ─────────────────────────────────
  const csv = (await api("GET", "/reports/three-year?year=2027&yearMode=fiscal&format=csv", tok)).text;
  ok("three-year CSV guards the =SUM formula name ('=SUM)", csv.includes("'=SUM(A1:A9)"), csv.split("\n").find(l => l.includes("SUM")));
  const anCsv = (await api("GET", "/reports/annual?year=2027&format=csv", tok)).text;
  ok("annual CSV renders metric rows", anCsv.includes("Total giving") && anCsv.includes("BY FUND"), anCsv.slice(0, 120));

  // ── 6) org isolation ──────────────────────────────────────────────────────
  await seedOrg(OTHER, "growth", "active", "other");
  await seedUser(OTHER, "u_rco", "rco", "admin");
  await seedDonor(OTHER, "rc_o", "Other Donor", "solicit", "u_rco", "User rco", 9999);
  await seedGift(OTHER, "rc_o", 9999, FY2027);
  await seedOpp(OTHER, "rc_o", "u_rco", "Other ask", 88888, "open");
  const tyAgain = (await api("GET", "/reports/three-year?year=2027&yearMode=fiscal", tok)).body;
  ok("three-year excludes the other org's donor", !tyAgain.rows.some(r => r.name === "Other Donor"), "leak");
  const solAgain = (await api("GET", `/reports/solicitations?from=${wideFrom}&to=${wideTo}`, tok)).body;
  ok("solicitations forecast excludes the other org's $88888 ask", solAgain.forecast.open === 15000, solAgain.forecast.open);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
