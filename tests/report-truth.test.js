// BUILD-33 Part 1 — REPORT TRUTH: every report proven against hand-computed
// expected values from a small golden fixture. Local scratch server + Postgres
// (tests/README.md recipe). No external creds.
//
// THE POINT: prior suites assert the code does what the code does. This suite
// asserts the code does what a HUMAN computes by hand from the documented donor
// patterns below. Every expected number in this file is a literal worked out on
// paper from the fixture — never derived by calling the app's own code.
//
// ── The golden fixture ──────────────────────────────────────────────────────
// Y = the fiscal year currently in progress at run time (FY N = Jul 1 (N-1) →
// Jun 30 N — computed independently in this file, mirroring the documented
// boundary, not imported from the app). Gifts are anchored to Sep 15 inside
// each fiscal year so the patterns hold on any run date. "FY0" = FY Y (the
// current year), FY-1 = last completed, etc.
//
//   A  Alice Steady    — gave every year: FY-3 $100, FY-2 $200, FY-1 $300,
//                        FY0 $400. Retained in every retention row; RETURNING
//                        donor in FY0.
//   B  Ben Lybunt      — FY-2 $250, FY-1 $500 (online), nothing since.
//                        → LYBUNT for FY0 (gave last year, not this year).
//   C  Cora Sybunt     — FY-3 $1000, FY-2 $50, nothing since.
//                        → SYBUNT for FY0 but NOT LYBUNT (no FY-1 gift).
//   D  Dan Once        — exactly one gift ever: FY0 $75 (online). NEW donor.
//   E  Eve Onetime     — one gift, FY-1 $150. LYBUNT for FY0; her cohort
//                        (first gift FY-1) is the first-year-retention pool.
//   F  Frank Boundary  — $40 on (Y-1)-06-30 (LAST day of FY-1) and $60 on
//                        (Y-1)-07-01 (FIRST day of FY0). Under FISCAL basis the
//                        two gifts land in different years; under CALENDAR both
//                        land in CY (Y-1). Returning in FY0 fiscal, NEW in
//                        CY (Y-1) calendar (his first-ever gift is Jun 30 of it).
//   G  Grace House     — FY0 $1000 (fund Operating, campaign Gala). NEW.
//   H  Hank House      — FY0 $500 (online, fund Education, campaign Gala). NEW.
//                        G + H form one household → soft-credit invariant.
//   I  Iris Median     — FY0 $20 and $180 (fund Operating). NEW. Two gifts so
//                        gift count ≠ donor count.
//   J  Jud Trashed     — soft-deleted donor (deleted_at set) with an FY0 $9999
//                        gift. Excluded from EVERY surface this suite checks.
//   K  Kim Delete      — gift logged through the real API then DELETED. Must
//                        vanish from reports AND the finance ledger.
//   L  Leo Prospect    — stage 'solicit', no gifts; carries the $8,000 open ask.
//
// FY0 gift set (7 gifts): 20, 60, 75, 180, 400, 500, 1000
//   total 2235 · unique donors 6 · median 180 (odd count) · avg 319.29
//   online D75+H500 = 575 (2) · offline 1660 (5) · new 4 (D,G,H,I) · returning 2 (A,F)
// CY (Y-1) gift set (8 gifts): 20, 40, 60, 75, 180, 400, 500, 1000
//   total 2275 · median (75+180)/2 = 127.5 (even count) · avg 284.38
//   new 5 (D,G,H,I,F) · returning 1 (A)
// FY-1 total 990 (A300 + B500 + E150 + F40) · FY-2 total 500 (A200+B250+C50)
// FY-3 total 1100 (A100 + C1000). Lifetime org total = 4825.

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_rt_main", OTHER = "org_rt_other";

// Independent fiscal-year math (the documented July-1 boundary, reimplemented
// here on purpose — NOT imported from server code).
const now = new Date();
const Y = now.getMonth() < 6 ? now.getFullYear() : now.getFullYear() + 1;
const anchor = fy => `${fy - 1}-09-15`;          // safely inside FY fy, CY fy-1
const FY0 = anchor(Y), FY1 = anchor(Y - 1), FY2 = anchor(Y - 2), FY3 = anchor(Y - 3);
const BOUNDARY_LAST = `${Y - 1}-06-30`;           // last day of FY-1
const BOUNDARY_FIRST = `${Y - 1}-07-01`;          // first day of FY0
const CY_F = Y - 1;                               // the calendar year holding all FY0 gifts

async function reset() {
  for (const org of [ORG, OTHER]) {
    for (const t of ["fin_transactions", "interactions", "moves", "opportunities", "tasks",
                     "gifts", "receipts", "workflow_runs", "workflows", "households",
                     "donors", "accounts", "fin_funds", "campaigns", "users"])
      await q(`DELETE FROM ${t} WHERE org_id=$1`, [org]).catch(() => {});
    await q(`DELETE FROM orgs WHERE id=$1`, [org]);
  }
}
async function seedOrg(o, tag) {
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan) VALUES ($1,$2,$3,1,'active','growth')`, [o, `RT ${tag}`, `rt-${tag}`]);
}
async function seedUser(o, id, tag) {
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ($1,$2,$3,$4,$5,'admin')`, [id, o, `${tag}@rt.local`, hash, `User ${tag}`]);
}
async function seedDonor(o, id, name, { stage = "cultivate", total = 0, count = 0, lastDate = null, lastAmt = null, deleted = false } = {}) {
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage,total_giving,gift_count,last_gift_date,last_gift_amount,deleted_at)
           VALUES ($1,$2,$3,$4,'mid',$5,$6,$7,$8,$9,$10)`,
    [id, o, name, `${id}@rt.local`, stage, total, count, lastDate, lastAmt, deleted ? new Date().toISOString() : null]);
}
async function seedGift(o, donorId, amount, date, { fund = null, campaign = null, online = false } = {}) {
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,fund_id,campaign_id,stripe_payment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    ["g_" + Math.random().toString(36).slice(2, 10), o, donorId, amount, date, fund, campaign, online ? "pi_rt_" + Math.random().toString(36).slice(2, 8) : null]);
}
async function seedOpp(o, donorId, officerId, name, target, status = "open", giftAmount = null) {
  await q(`INSERT INTO opportunities (id,org_id,donor_id,officer_id,officer_name,name,target_amount,status,gift_amount,closed_at)
           VALUES ($1,$2,$3,$4,'User rt',$5,$6,$7,$8,$9)`,
    ["op_" + Math.random().toString(36).slice(2, 9), o, donorId, officerId, name, target, status, giftAmount,
     status === "won" ? new Date().toISOString().slice(0, 10) + " 10:00:00" : null]);
}

(async () => {
  await reset();
  await seedOrg(ORG, "main");
  await seedUser(ORG, "u_rt", "rt");
  await q(`INSERT INTO accounts (id,org_id,code,name,type) VALUES ('acct_rt_4010',$1,'4010','Contributions','income')`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('fund_rt_ops',$1,'Operating',false),('fund_rt_edu',$1,'Education',true)`, [ORG]);
  await q(`INSERT INTO campaigns (id,org_id,name) VALUES ('camp_rt_gala',$1,'Gala')`, [ORG]);

  // The cast — totals/counts on the donor row are the hand-summed lifetime
  // figures (top-donors lifetime scope reads these columns, not SUM(gifts)).
  await seedDonor(ORG, "rt_a", "Alice Steady",  { stage: "steward", total: 1000, count: 4, lastDate: FY0, lastAmt: 400 });
  await seedDonor(ORG, "rt_b", "Ben Lybunt",    { total: 750,  count: 2, lastDate: FY1, lastAmt: 500 });
  await seedDonor(ORG, "rt_c", "Cora Sybunt",   { total: 1050, count: 2, lastDate: FY2, lastAmt: 50 });
  await seedDonor(ORG, "rt_d", "Dan Once",      { total: 75,   count: 1, lastDate: FY0, lastAmt: 75 });
  await seedDonor(ORG, "rt_e", "Eve Onetime",   { total: 150,  count: 1, lastDate: FY1, lastAmt: 150 });
  await seedDonor(ORG, "rt_f", "Frank Boundary",{ total: 100,  count: 2, lastDate: BOUNDARY_FIRST, lastAmt: 60 });
  await seedDonor(ORG, "rt_g", "Grace House",   { total: 1000, count: 1, lastDate: FY0, lastAmt: 1000 });
  await seedDonor(ORG, "rt_h", "Hank House",    { total: 500,  count: 1, lastDate: FY0, lastAmt: 500 });
  await seedDonor(ORG, "rt_i", "Iris Median",   { total: 200,  count: 2, lastDate: FY0, lastAmt: 180 });
  await seedDonor(ORG, "rt_j", "Jud Trashed",   { total: 9999, count: 1, lastDate: FY0, lastAmt: 9999, deleted: true });
  await seedDonor(ORG, "rt_k", "Kim Delete",    {});
  await seedDonor(ORG, "rt_l", "Leo Prospect",  { stage: "solicit" });

  // Gifts, per the documented patterns.
  await seedGift(ORG, "rt_a", 100, FY3);
  await seedGift(ORG, "rt_a", 200, FY2);
  await seedGift(ORG, "rt_a", 300, FY1);
  await seedGift(ORG, "rt_a", 400, FY0);
  await seedGift(ORG, "rt_b", 250, FY2);
  await seedGift(ORG, "rt_b", 500, FY1, { online: true });
  await seedGift(ORG, "rt_c", 1000, FY3);
  await seedGift(ORG, "rt_c", 50, FY2);
  await seedGift(ORG, "rt_d", 75, FY0, { online: true });
  await seedGift(ORG, "rt_e", 150, FY1);
  await seedGift(ORG, "rt_f", 40, BOUNDARY_LAST);
  await seedGift(ORG, "rt_f", 60, BOUNDARY_FIRST);
  await seedGift(ORG, "rt_g", 1000, FY0, { fund: "fund_rt_ops", campaign: "camp_rt_gala" });
  await seedGift(ORG, "rt_h", 500, FY0, { fund: "fund_rt_edu", campaign: "camp_rt_gala", online: true });
  await seedGift(ORG, "rt_i", 20, FY0);
  await seedGift(ORG, "rt_i", 180, FY0, { fund: "fund_rt_ops" });
  await seedGift(ORG, "rt_j", 9999, FY0); // trashed donor's gift — must never count

  const tok = await login("rt@rt.local");
  const gs = (params) => api("GET", `/reports/giving-summary?${params}`, tok);

  // ── 0) The deleted gift: logged through the real API, then deleted ────────
  // Mid-state proves the gift genuinely existed on every surface; end-state
  // proves deletion removes it from reports AND the ledger (BUILD-33 fix: the
  // gift's fin_transactions stamp is deleted with it, not orphaned).
  const kAdd = await api("POST", "/donors/rt_k/gifts", tok, { amount: 500, date: FY0.slice(0, 8) + "20" });
  const kGiftId = kAdd.body?.gift?.id;
  ok("K's gift logs through the real API", kAdd.status === 201 && !!kGiftId, kAdd.status);
  const midTotal = (await gs(`year=${Y}&yearMode=fiscal`)).body.total;
  ok("mid-state: FY0 total includes K's $500 (2235 + 500 = 2735)", midTotal === 2735, midTotal);
  const midStamp = await q(`SELECT id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, kGiftId]);
  ok("mid-state: K's gift stamped the ledger exactly once", midStamp.length === 1, midStamp.length);
  const kDel = await api("DELETE", `/gifts/${kGiftId}`, tok);
  ok("K's gift deletes cleanly", kDel.status === 200, kDel.status);
  const postStamp = await q(`SELECT id FROM fin_transactions WHERE org_id=$1 AND gift_id=$2`, [ORG, kGiftId]);
  ok("deleted gift's ledger stamp is gone (no orphaned income row)", postStamp.length === 0, postStamp.length);
  const kDonor = await q(`SELECT total_giving FROM donors WHERE id='rt_k'`);
  ok("K's donor total recalcs to 0 after the delete", Number(kDonor[0].total_giving) === 0, kDonor[0]);

  // ── 1) Giving Summary — FISCAL FY0, all values hand-computed ──────────────
  const s = (await gs(`year=${Y}&yearMode=fiscal`)).body;
  ok("GS fiscal total = 2235 (20+60+75+180+400+500+1000)", s.total === 2235, s.total);
  ok("GS fiscal gift count = 7", s.giftCount === 7, s.giftCount);
  ok("GS fiscal unique donors = 6 (A,D,F,G,H,I)", s.uniqueDonors === 6, s.uniqueDonors);
  ok("GS fiscal average = 319.29 (2235/7)", s.avgGift === 319.29, s.avgGift);
  ok("GS fiscal MEDIAN (odd count, 7 gifts) = 180 (the 4th of 20,60,75,180,400,500,1000)", s.medianGift === 180, s.medianGift);
  ok("GS fiscal new donors = 4 (D,G,H,I first-ever gift this FY)", s.newDonors === 4, s.newDonors);
  ok("GS fiscal returning donors = 2 (A since FY-3, F since Jun 30 FY-1)", s.returningDonors === 2, s.returningDonors);
  ok("GS fiscal online = $575 across 2 gifts (D $75 + H $500)", s.onlineTotal === 575 && s.onlineCount === 2, { t: s.onlineTotal, c: s.onlineCount });
  ok("GS fiscal offline = $1660 across 5 gifts", s.offlineTotal === 1660 && s.offlineCount === 5, { t: s.offlineTotal, c: s.offlineCount });
  ok("GS excludes the trashed donor's $9999 gift", s.total === 2235 && s.uniqueDonors === 6, s.total);
  // Monthly breakdown: Jul (Y-1) = F's $60 only; Sep (Y-1) = the other 6 gifts.
  const jul = s.monthly.find(m => m.month === `${Y - 1}-07`);
  const sep = s.monthly.find(m => m.month === `${Y - 1}-09`);
  ok("GS monthly Jul = $60 / 1 gift / 1 donor (Frank's boundary gift)", jul && jul.total === 60 && jul.gifts === 1 && jul.donors === 1, jul);
  ok("GS monthly Sep = $2175 / 6 gifts / 5 donors (Iris gave twice)", sep && sep.total === 2175 && sep.gifts === 6 && sep.donors === 5, sep);
  ok("GS monthly has exactly the 2 months with activity", s.monthly.length === 2, s.monthly.map(m => m.month));
  ok("GS total reconciles with Σ monthly (independent second path)", s.monthly.reduce((t, m) => t + m.total, 0) === s.total, s.monthly);

  // ── 2) Giving Summary — CALENDAR CY(Y-1): the even-median + basis check ───
  const c = (await gs(`year=${CY_F}&yearMode=calendar`)).body;
  ok("GS calendar total = 2275 (the 7 FY0 gifts + Frank's Jun-30 $40 all fall in one CY)", c.total === 2275, c.total);
  ok("GS calendar gift count = 8", c.giftCount === 8, c.giftCount);
  ok("GS calendar MEDIAN (even count, 8 gifts) = 127.5 (mean of 75 and 180)", c.medianGift === 127.5, c.medianGift);
  ok("GS calendar average = 284.38 (2275/8)", c.avgGift === 284.38, c.avgGift);
  ok("GS calendar new = 5 — Frank is NEW under calendar basis (first gift Jun 30 CY(Y-1)) but RETURNING under fiscal", c.newDonors === 5 && c.returningDonors === 1, { n: c.newDonors, r: c.returningDonors });

  // Boundary days land in the right period (single-day windows).
  const dayFirst = (await gs(`from=${BOUNDARY_FIRST}&to=${BOUNDARY_FIRST}`)).body;
  ok("Jul 1 (first day of FY0) holds exactly Frank's $60", dayFirst.total === 60 && dayFirst.giftCount === 1, dayFirst.total);
  const dayLast = (await gs(`from=${BOUNDARY_LAST}&to=${BOUNDARY_LAST}`)).body;
  ok("Jun 30 (last day of FY-1) holds exactly Frank's $40", dayLast.total === 40 && dayLast.giftCount === 1, dayLast.total);

  // ── 3) LYBUNT / SYBUNT ────────────────────────────────────────────────────
  const ly = (await api("GET", `/reports/lybunt?year=${Y}&yearMode=fiscal`, tok)).body;
  const lyIds = ly.rows.map(r => r.id).sort();
  ok("LYBUNT fiscal FY0 = exactly {Ben, Eve} (gave FY-1, nothing FY0)", JSON.stringify(lyIds) === JSON.stringify(["rt_b", "rt_e"]), lyIds);
  const lyB = ly.rows.find(r => r.id === "rt_b");
  ok("Ben's LYBUNT row: prior-year $500, lifetime $750", lyB.priorYearTotal === 500 && lyB.lifetimeGiving === 750, lyB);
  const sy = (await api("GET", `/reports/sybunt?year=${Y}&yearMode=fiscal`, tok)).body;
  const syIds = sy.rows.map(r => r.id).sort();
  ok("SYBUNT fiscal FY0 = exactly {Ben, Cora, Eve} (some year, not this year)", JSON.stringify(syIds) === JSON.stringify(["rt_b", "rt_c", "rt_e"]), syIds);
  ok("SYBUNT ⊇ LYBUNT, and the difference is exactly Cora (skipped FY-1)", lyIds.every(id => syIds.includes(id)) && syIds.filter(id => !lyIds.includes(id)).join() === "rt_c", syIds);
  const syC = sy.rows.find(r => r.id === "rt_c");
  ok("Cora's SYBUNT row shows $0 prior-year (her money is older than FY-1)", syC.priorYearTotal === 0 && syC.lifetimeGiving === 1050, syC);
  // Basis matters: under CALENDAR year Y (which holds no gifts at all) every
  // CY(Y-1) giver is LYBUNT — a completely different membership than fiscal.
  const lyCal = (await api("GET", `/reports/lybunt?year=${Y}&yearMode=calendar`, tok)).body;
  const lyCalIds = lyCal.rows.map(r => r.id).sort();
  ok("LYBUNT calendar year Y = the 6 CY(Y-1) givers {A,D,F,G,H,I} — fiscal-vs-calendar membership differs as documented",
    JSON.stringify(lyCalIds) === JSON.stringify(["rt_a", "rt_d", "rt_f", "rt_g", "rt_h", "rt_i"]), lyCalIds);
  ok("Neither list contains the donor who gave exactly once THIS year (Dan)", !lyIds.includes("rt_d") && !syIds.includes("rt_d"), syIds);

  // ── 4) Retention — formula: retained ÷ prior-period donors ────────────────
  const ret = (await api("GET", "/reports/retention?yearMode=fiscal", tok)).body;
  const row = y => ret.rows.find(r => r.year === y);
  const r1 = row(Y - 1); // FY-1: prior = FY-2 donors {A,B,C}; retained = {A,B}
  ok("retention FY-1: 2 of 3 prior-year donors returned → 66.7%", r1.priorDonors === 3 && r1.retainedDonors === 2 && r1.retentionRate === 66.7, r1);
  ok("retention FY-1 dollars: retained donors' FY-1 $800 ÷ FY-2 $500 = 160%", r1.priorDollars === 500 && r1.retainedDollars === 800 && r1.dollarRetentionRate === 160, r1);
  ok("retention FY-1 FIRST-YEAR: cohort whose first gift was FY-2 = {Ben}, he returned → 1/1 = 100%", r1.firstYearDonors === 1 && r1.firstYearRetained === 1 && r1.firstYearRetentionRate === 100, r1);
  const r2 = row(Y - 2); // FY-2: prior = FY-3 donors {A,C}; both returned
  ok("retention FY-2: 2 of 2 returned → 100%", r2.priorDonors === 2 && r2.retainedDonors === 2 && r2.retentionRate === 100, r2);
  ok("retention FY-2 dollars: $250 of $1100 kept = 22.7%", r2.priorDollars === 1100 && r2.retainedDollars === 250 && r2.dollarRetentionRate === 22.7, r2);
  const r3 = row(Y - 3); // FY-3: no FY-4 donors exist
  ok("retention FY-3: empty prior year → nulls, never fake 0% or 100%", r3.priorDonors === 0 && r3.retentionRate === null && r3.dollarRetentionRate === null && r3.firstYearRetentionRate === null, r3);

  // ── 5) Three-year comparison ──────────────────────────────────────────────
  const ty = (await api("GET", `/reports/three-year?year=${Y}&yearMode=fiscal`, tok)).body;
  const yTot = y => ty.years.find(x => x.year === y);
  ok("3yr org totals: FY0 $2235 / FY-1 $990 / FY-2 $500", yTot(Y).total === 2235 && yTot(Y - 1).total === 990 && yTot(Y - 2).total === 500, ty.years);
  ok("3yr org donor counts: 6 / 4 / 3", yTot(Y).donors === 6 && yTot(Y - 1).donors === 4 && yTot(Y - 2).donors === 3, ty.years);
  ok("3yr org growth = (2235−990)/990 = 125.8%", ty.orgGrowthPct === 125.8, ty.orgGrowthPct);
  const tyA = ty.rows.find(r => r.id === "rt_a");
  ok("Alice YoYoY = 400/300/200, +33.3% up", tyA.y0 === 400 && tyA.y1 === 300 && tyA.y2 === 200 && tyA.changePct === 33.3 && tyA.trend === "up", tyA);
  const tyB = ty.rows.find(r => r.id === "rt_b");
  ok("Ben YoYoY = 0/500/250, −100% down", tyB.y0 === 0 && tyB.y1 === 500 && tyB.y2 === 250 && tyB.changePct === -100 && tyB.trend === "down", tyB);
  const tyD = ty.rows.find(r => r.id === "rt_d");
  ok("Dan (new): change % is null (no prior year to divide by), trend up", tyD.changePct === null && tyD.trend === "up", tyD);
  ok("3yr rows ranked by 3-year total (Grace $1000 first)", ty.rows[0].id === "rt_g", ty.rows[0]);

  // ── 6) Annual report ──────────────────────────────────────────────────────
  const an = (await api("GET", `/reports/annual?year=${Y}&yearMode=fiscal`, tok)).body;
  ok("annual total/gifts/donors/avg = 2235 / 7 / 6 / 319.29", an.total === 2235 && an.giftCount === 7 && an.uniqueDonors === 6 && an.avgGift === 319.29, an);
  ok("annual growth vs FY-1 ($990) = 125.8%", an.priorTotal === 990 && an.growthPct === 125.8, an.growthPct);
  ok("annual new 4 / returning 2", an.newDonors === 4 && an.returningDonors === 2, an);
  ok("annual retention: FY-1 donors {A,B,E,F}=4, returned {A,F}=2 → 50%", an.priorDonors === 4 && an.retainedDonors === 2 && an.retentionRate === 50, an);
  const anFund = n => an.byFund.find(f => f.name === n);
  ok("annual by-fund: Operating $1180 (G $1000 + I $180)", anFund("Operating").total === 1180, an.byFund);
  ok("annual by-fund: Education $500, No fund $555", anFund("Education").total === 500 && anFund("No fund").total === 555, an.byFund);
  ok("annual by-fund sums back to the total (1180+500+555 = 2235)", an.byFund.reduce((t, f) => t + f.total, 0) === 2235, an.byFund);
  const anCamp = n => an.byCampaign.find(x => x.name === n);
  ok("annual by-campaign: Gala $1500, No campaign $735", anCamp("Gala").total === 1500 && anCamp("No campaign").total === 735, an.byCampaign);

  // ── 7) Gifts by Fund / Campaign (by-group) ────────────────────────────────
  const bf = (await api("GET", `/reports/by-group?year=${Y}&yearMode=fiscal&groupBy=funds`, tok)).body;
  const bfRow = n => bf.rows.find(r => r.name === n);
  ok("by-fund grand total = 2235", bf.grandTotal === 2235, bf.grandTotal);
  ok("by-fund Operating: $1180 / 2 gifts / 2 donors / 52.8%", (() => { const r = bfRow("Operating"); return r.total === 1180 && r.giftCount === 2 && r.uniqueDonors === 2 && r.pct === 52.8; })(), bfRow("Operating"));
  ok("by-fund Education 22.4% + No fund 24.8% (shares sum to 100)", bfRow("Education").pct === 22.4 && bfRow("No fund").pct === 24.8, bf.rows);
  const bc = (await api("GET", `/reports/by-group?year=${Y}&yearMode=fiscal&groupBy=campaigns`, tok)).body;
  ok("by-campaign Gala: $1500 / 2 gifts / 67.1%", (() => { const r = bc.rows.find(x => x.name === "Gala"); return r.total === 1500 && r.giftCount === 2 && r.pct === 67.1; })(), bc.rows);
  ok("by-campaign No campaign: $735 / 32.9%", (() => { const r = bc.rows.find(x => x.name === "No campaign"); return r.total === 735 && r.pct === 32.9; })(), bc.rows);

  // ── 8) Top donors ─────────────────────────────────────────────────────────
  const tp = (await api("GET", `/reports/top-donors?year=${Y}&yearMode=fiscal`, tok)).body;
  ok("top-donors period ranking = G 1000, H 500, A 400, I 200, D 75, F 60",
    JSON.stringify(tp.rows.map(r => [r.id, r.total])) === JSON.stringify([["rt_g", 1000], ["rt_h", 500], ["rt_a", 400], ["rt_i", 200], ["rt_d", 75], ["rt_f", 60]]), tp.rows);
  ok("top-donors period: Iris shows 2 gifts", tp.rows.find(r => r.id === "rt_i").giftCount === 2, tp.rows);
  ok("top-donors excludes the trashed donor (J's $9999 would otherwise lead)", !tp.rows.some(r => r.id === "rt_j"), tp.rows.map(r => r.id));
  const tl = (await api("GET", "/reports/top-donors?scope=lifetime&limit=100", tok)).body;
  ok("top-donors lifetime rank 1 = Cora $1050 (her giving is old, but it counts)", tl.rows[0].id === "rt_c" && tl.rows[0].total === 1050, tl.rows[0]);
  ok("top-donors lifetime sums to the org's whole history ($4825)", tl.rows.reduce((t, r) => t + r.total, 0) === 4825, tl.rows.reduce((t, r) => t + r.total, 0));

  // ── 9) Household view never inflates hard credit (BUILD-14 invariant) ─────
  const hh = await api("POST", "/households", tok, { memberIds: ["rt_g", "rt_h"], primaryDonorId: "rt_g" });
  ok("household G+H creates", hh.status === 201, hh.status);
  const tpH = (await api("GET", `/reports/top-donors?year=${Y}&yearMode=fiscal&view=household`, tok)).body;
  ok("household view rank 1 = the household at $1500 combined, 2 members", tpH.rows[0].total === 1500 && tpH.rows[0].isHousehold === true && tpH.rows[0].memberCount === 2, tpH.rows[0]);
  ok("household view total === individual view total === 2235 (grouping re-keys, never double-counts)",
    tpH.rows.reduce((t, r) => t + r.total, 0) === 2235 && tp.rows.reduce((t, r) => t + r.total, 0) === 2235, tpH.rows);
  const gAfter = await q(`SELECT total_giving FROM donors WHERE id='rt_g'`);
  ok("Grace's own hard credit unchanged by the household ($1000)", Number(gAfter[0].total_giving) === 1000, gAfter[0]);
  const sAfterHh = (await gs(`year=${Y}&yearMode=fiscal`)).body;
  ok("giving-summary total unchanged by the household (still 2235)", sAfterHh.total === 2235, sAfterHh.total);

  // ── 10) Solicitations / forecast — documented stage weights ───────────────
  // STAGE_WEIGHT (documented in CLAUDE.md): prospect .1, qualify .2,
  // cultivate .4, solicit .7, steward .9, lapsed .05.
  await seedOpp(ORG, "rt_l", "u_rt", "Leo major ask", 8000, "open");
  await seedOpp(ORG, "rt_a", "u_rt", "Alice stretch ask", 2000, "open");
  await seedOpp(ORG, "rt_a", "u_rt", "Alice closed ask", 3000, "won", 3500);
  const sol = (await api("GET", `/reports/solicitations?from=2020-01-01&to=${new Date().toISOString().slice(0, 10)}`, tok)).body;
  ok("solicitations open forecast = $10,000 (8000 + 2000)", sol.forecast.open === 10000, sol.forecast.open);
  ok("solicitations weighted forecast = 8000×0.7 + 2000×0.9 = $7,400", sol.forecast.weighted === 7400, sol.forecast.weighted);
  const st = k => sol.byStage.find(x => x.stage === k);
  ok("byStage solicit: 1 ask / $8000 / weight .7 / weighted $5600", st("solicit").count === 1 && st("solicit").ask === 8000 && st("solicit").weight === 0.7 && st("solicit").weighted === 5600, st("solicit"));
  ok("byStage steward: $2000 @ .9 = $1800", st("steward").ask === 2000 && st("steward").weighted === 1800, st("steward"));
  const off = sol.byOfficer.find(o => o.officerId === "u_rt");
  ok("officer asks-vs-closes: 2 open ($10k), 3 made ($13k), 1 closed ($3.5k)",
    off.openAsks === 2 && off.openAskAmount === 10000 && off.asksMade === 3 && off.asksMadeAmount === 13000 && off.giftsClosed === 1 && off.giftsClosedAmount === 3500, off);
  // Win rate = won ÷ (won + lost) — DECIDED asks only. This officer has 1 won,
  // 0 lost, 2 open → 1/(1+0) = 100%. Open asks are NOT losses (the old buggy
  // formula gave 1/(1+2)=33.3%). See tests/solicitations-winrate.test.js.
  ok("officer win rate = 1 won / (1 won + 0 lost) = 100% (open asks excluded)", off.winRate === 100, off.winRate);
  ok("officer lostAsks = 0, decidedAsks = 1", off.lostAsks === 0 && off.decidedAsks === 1, off);

  // ── 11) Cross-surface reconciliation — the same number everywhere ─────────
  // Independent second computation straight from the DB, written HERE (the
  // same WHERE the human used on paper), then compared across every surface.
  const [dbSum] = await q(
    `SELECT COALESCE(SUM(g.amount),0)::numeric AS total, COUNT(*)::int AS n
       FROM gifts g JOIN donors d ON d.id = g.donor_id
      WHERE g.org_id=$1 AND d.deleted_at IS NULL AND g.date >= $2 AND g.date <= $3`,
    [ORG, `${Y - 1}-07-01`, `${Y}-06-30`]);
  ok("independent DB sum of FY0 gifts = 2235 (the paper number)", Number(dbSum.total) === 2235 && dbSum.n === 7, dbSum);
  const fo = (await api("GET", "/fundraising/overview?yearMode=fiscal", tok)).body;
  ok("Fundraising overview period.raised === Reports giving-summary total (2235, trashed donor excluded)",
    fo.period.raised === 2235 && fo.period.giftCount === 7 && fo.period.donorCount === 6, fo.period);
  const fin = (await api("GET", "/finance/summary?yearMode=fiscal", tok)).body;
  ok("Finance giftHistoryTotal === lifetime giving shown in Reports (4825)", fin.giftHistoryTotal === 4825, fin.giftHistoryTotal);
  ok("Finance flags the unledgered history honestly (seeded history never stamped the ledger)",
    fin.hasUnledgeredGiving === true && fin.unledgeredGiving === 4825, { has: fin.hasUnledgeredGiving, amt: fin.unledgeredGiving });
  const [dbLife] = await q(
    `SELECT COALESCE(SUM(total_giving),0)::numeric AS total FROM donors WHERE org_id=$1 AND deleted_at IS NULL`, [ORG]);
  ok("Σ donor lifetime columns === Σ gift rows === 4825 (two independent paths agree)", Number(dbLife.total) === 4825, dbLife);
  ok("giving-summary === by-group grand === annual === 3yr-y0 === top-donors Σ (all 2235)",
    s.total === 2235 && bf.grandTotal === 2235 && an.total === 2235 && yTot(Y).total === 2235 && tp.rows.reduce((t, r) => t + r.total, 0) === 2235, null);

  // ── 12) Org isolation ─────────────────────────────────────────────────────
  await seedOrg(OTHER, "other");
  await seedUser(OTHER, "u_rto", "rto");
  await seedDonor(OTHER, "rt_o", "Other Donor", { total: 7777, count: 1, lastDate: FY0, lastAmt: 7777 });
  await seedGift(OTHER, "rt_o", 7777, FY0);
  const otok = await login("rto@rt.local");
  const os = (await api("GET", `/reports/giving-summary?year=${Y}&yearMode=fiscal`, otok)).body;
  ok("other org sees only its own $7777", os.total === 7777 && os.giftCount === 1, os.total);
  const sFinal = (await gs(`year=${Y}&yearMode=fiscal`)).body;
  ok("main org unchanged by the other org's data (still 2235)", sFinal.total === 2235, sFinal.total);

  await closeDb();
  summary();
})().catch(e => { console.error(e); process.exit(1); });
