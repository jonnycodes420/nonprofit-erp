// Reports correctness (BUILD-02's uncommitted verification, rebuilt as the
// committed suite BUILD-06 Phase B). Crafted 3-year fixture with hand-computed
// expectations for giving-summary, LYBUNT/SYBUNT (both year modes), retention
// (donor %, dollar %, first-year %), top-donors (period + lifetime), by-group,
// the FY/CY boundary flip, CSV formula-injection guard, param validation, and
// org isolation.
//
//   node tests/reports.test.js
//
// NOTE: the retention report is always "last 3 completed years" relative to
// today, so this fixture pins its years to (currentCalendarYear-1) and back —
// the assertions stay valid whenever the test is run.
const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb } = require("./helpers");

const ORG = "org_test_reports";
const Y = new Date().getUTCFullYear() - 1;        // last completed calendar year, e.g. 2025
const Y0 = Y - 1, Ym2 = Y - 2;                    // e.g. 2024, 2023
const EVIL = '=HYPERLINK("http://evil")';         // LYBUNT donor name — tests the CSV guard

async function seed() {
  await q(`DELETE FROM gifts WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM donors WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM fin_funds WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM users WHERE org_id=$1`, [ORG]);
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]);
  await q(`INSERT INTO orgs (id, name, onboarding_complete) VALUES ($1,'Reports Fixture Org',1)`, [ORG]);
  const hash = bcrypt.hashSync("loadtest1234", 10);
  await q(`INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES ('u_rpt_admin',$1,'rpt-admin@test.local',$2,'Rpt Admin','admin')`, [ORG, hash]);
  await q(`INSERT INTO fin_funds (id, org_id, name) VALUES ('f_rpt_1',$1,'Education'), ('f_rpt_2',$1,'Capital')`, [ORG]);

  // donor: [id, name, lifetime total_giving]
  const donors = [
    ["d_rpt_A", "Alice Steady", 380], ["d_rpt_B", EVIL, 300], ["d_rpt_C", "Carol Old", 50],
    ["d_rpt_D", "Dan New", 400], ["d_rpt_E", "Eve Second", 250], ["d_rpt_F", "Frank Boundary", 500],
  ];
  for (const [id, name, total] of donors) {
    await q(`INSERT INTO donors (id, org_id, name, email, total_giving, status) VALUES ($1,$2,$3,$4,$5,'new')`, [id, ORG, name, id + "@test.local", total]);
  }
  // gifts: [id, donor, amount, date, fund]
  // CY(Y): A 200 (Sep), D 400 (Mar), E 150 (Aug), F 500 (Jun 15) → total 1250
  // CY(Y0): A 100 (Dec 15 — FY(Y) side of the July boundary), B 300 (Mar), E 100 (Oct)
  // CY(Ym2): A 80 (May), C 50 (Nov)
  const gifts = [
    ["g_rpt_A1", "d_rpt_A", 80,  `${Ym2}-05-10`, null],
    ["g_rpt_C1", "d_rpt_C", 50,  `${Ym2}-11-20`, null],
    ["g_rpt_A2", "d_rpt_A", 100, `${Y0}-12-15`,  null],
    ["g_rpt_B1", "d_rpt_B", 300, `${Y0}-03-01`,  null],
    ["g_rpt_E1", "d_rpt_E", 100, `${Y0}-10-05`,  null],
    ["g_rpt_A3", "d_rpt_A", 200, `${Y}-09-10`,   "f_rpt_1"],
    ["g_rpt_D1", "d_rpt_D", 400, `${Y}-03-15`,   "f_rpt_2"],
    ["g_rpt_E2", "d_rpt_E", 150, `${Y}-08-20`,   "f_rpt_1"],
    ["g_rpt_F1", "d_rpt_F", 500, `${Y}-06-15`,   null],
  ];
  for (const [id, donor, amount, date, fund] of gifts) {
    await q(`INSERT INTO gifts (id, org_id, donor_id, amount, date, type, fund_id) VALUES ($1,$2,$3,$4,$5,'cash',$6)`, [id, ORG, donor, amount, date, fund]);
  }
}

async function main() {
  await seed();
  const t = await login("rpt-admin@test.local");
  const tOther = await login("admin@willow.test"); // org_smalltest — isolation probe

  // ── giving-summary, calendar Y ────────────────────────────────────────────
  console.log(`\n── giving-summary CY${Y} ──`);
  let r = await api("GET", `/reports/giving-summary?year=${Y}&yearMode=calendar`, t);
  ok("total 1250", r.body.total === 1250, r.body.total);
  ok("gift count 4", r.body.giftCount === 4, r.body.giftCount);
  ok("unique donors 4", r.body.uniqueDonors === 4, r.body.uniqueDonors);
  ok("median 300 (even count: (200+400)/2)", Number(r.body.medianGift) === 300, r.body.medianGift);
  ok("new donors 2 (first-ever gift in period: D, F)", r.body.newDonors === 2, r.body.newDonors);
  ok("returning donors 2 (A, E)", r.body.returningDonors === 2, r.body.returningDonors);

  // odd-count median via fund filter: f_rpt_1 has gifts 200 + 150 → median 175
  r = await api("GET", `/reports/giving-summary?year=${Y}&yearMode=calendar&fundId=f_rpt_1`, t);
  ok("fund filter total 350", r.body.total === 350, r.body.total);
  ok("fund filter median 175 (PERCENTILE_CONT between 150 and 200)", Number(r.body.medianGift) === 175, r.body.medianGift);

  // ── FY/CY boundary flip ───────────────────────────────────────────────────
  console.log(`\n── FY${Y} vs CY${Y} boundary ──`);
  r = await api("GET", `/reports/giving-summary?year=${Y}&yearMode=fiscal`, t);
  // FY(Y) = Jul 1 (Y-1) → Jun 30 Y: A2 100 (Dec Y0) + E1 100 (Oct Y0) + D 400 (Mar Y) + F 500 (Jun Y) = 1100
  ok(`FY${Y} total 1100 (Dec-${Y0} gift flips in, Aug/Sep-${Y} gifts flip out)`, r.body.total === 1100, r.body.total);
  ok(`FY${Y} gift count 4`, r.body.giftCount === 4, r.body.giftCount);

  // ── LYBUNT / SYBUNT, both modes ───────────────────────────────────────────
  console.log("\n── LYBUNT / SYBUNT ──");
  r = await api("GET", `/reports/lybunt?year=${Y}&yearMode=calendar`, t);
  ok("LYBUNT CY = exactly {B}", r.body.rows.length === 1 && r.body.rows[0].id === "d_rpt_B", r.body.rows.map(x => x.id));
  ok("LYBUNT priorYearTotal 300", r.body.rows[0].priorYearTotal === 300, r.body.rows[0]);
  r = await api("GET", `/reports/sybunt?year=${Y}&yearMode=calendar`, t);
  ok("SYBUNT CY = {B, C} (superset of LYBUNT)", r.body.rows.length === 2 && r.body.rows.map(x => x.id).sort().join() === "d_rpt_B,d_rpt_C", r.body.rows.map(x => x.id));
  r = await api("GET", `/reports/lybunt?year=${Y}&yearMode=fiscal`, t);
  // FY(Y-1) = Jul (Ym2) → Jun (Y0): B (Mar Y0) and C (Nov Ym2) gave; neither gave in FY(Y)
  ok("LYBUNT FISCAL = {B, C} (year-mode changes membership)", r.body.rows.map(x => x.id).sort().join() === "d_rpt_B,d_rpt_C", r.body.rows.map(x => x.id));

  // ── Retention (last 3 completed CY years; row for Y) ──────────────────────
  console.log("\n── Retention ──");
  r = await api("GET", `/reports/retention?yearMode=calendar`, t);
  const row = r.body.rows.find(x => x.year === Y);
  ok(`retention row for ${Y} exists`, !!row, r.body.rows.map(x => x.year));
  ok("prior donors 3 (A,B,E)", row.priorDonors === 3, row);
  ok("retained 2 (A,E) → 66.7%", row.retainedDonors === 2 && row.retentionRate === 66.7, { retained: row.retainedDonors, rate: row.retentionRate });
  ok("dollar retention 70% (350 of 500)", row.dollarRetentionRate === 70, row.dollarRetentionRate);
  ok("first-year cohort 2 (B,E first gave in prior year), retained 1 (E) → 50%", row.firstYearDonors === 2 && row.firstYearRetained === 1 && row.firstYearRetentionRate === 50, row);

  // ── Top donors ────────────────────────────────────────────────────────────
  console.log("\n── Top donors ──");
  r = await api("GET", `/reports/top-donors?year=${Y}&yearMode=calendar`, t);
  ok("period top = F(500) then D(400)", r.body.rows[0].id === "d_rpt_F" && r.body.rows[0].total === 500 && r.body.rows[1].id === "d_rpt_D", r.body.rows.slice(0, 2));
  r = await api("GET", `/reports/top-donors?scope=lifetime&limit=3`, t);
  ok("lifetime reads donors.total_giving: F500, D400, A380", r.body.rows.map(x => x.total).join() === "500,400,380", r.body.rows.map(x => x.total));

  // ── by-group (funds) ──────────────────────────────────────────────────────
  console.log("\n── by-group ──");
  r = await api("GET", `/reports/by-group?year=${Y}&yearMode=calendar&groupBy=funds`, t);
  const fund = n => r.body.rows.find(x => x.name === n);
  ok("Education fund 350 / Capital 400 / No fund 500", fund("Education")?.total === 350 && fund("Capital")?.total === 400 && fund("No fund")?.total === 500, r.body.rows);
  ok("grand total 1250", r.body.grandTotal === 1250, r.body.grandTotal);

  // ── CSV: injection guard ──────────────────────────────────────────────────
  console.log("\n── CSV ──");
  r = await api("GET", `/reports/lybunt?year=${Y}&yearMode=calendar&format=csv`, t);
  ok("CSV attachment served", r.status === 200 && r.text.includes(","), r.status);
  ok("formula name arrives '-escaped ('=HYPERLINK…)", r.text.includes("'" + '=HYPERLINK'), r.text.split("\n")[1]?.slice(0, 60));

  // ── Param validation ──────────────────────────────────────────────────────
  console.log("\n── Validation ──");
  ok("year=garbage → 400", (await api("GET", "/reports/giving-summary?year=garbage", t)).status === 400);
  ok("from without to → 400", (await api("GET", "/reports/giving-summary?from=2025-01-01", t)).status === 400);
  ok("from > to → 400", (await api("GET", "/reports/giving-summary?from=2025-02-01&to=2025-01-01", t)).status === 400);
  ok("unknown key → 404", (await api("GET", "/reports/nonsense", t)).status === 404);
  ok("/reports/board not shadowed", (await api("GET", "/reports/board", t)).status === 200);

  // ── Org isolation ─────────────────────────────────────────────────────────
  console.log("\n── Org isolation ──");
  r = await api("GET", `/reports/lybunt?year=${Y}&yearMode=calendar`, tOther);
  ok("other org's LYBUNT has no fixture donors", !r.body.rows.some(x => String(x.id).startsWith("d_rpt_")), r.body.rows.length);
  r = await api("GET", `/reports/giving-summary?year=${Y}&yearMode=calendar`, tOther);
  ok("other org's summary isn't the fixture's 1250", r.body.total !== 1250, r.body.total);

  await closeDb();
  summary();
}
main().catch(e => { console.error(e); process.exit(1); });
