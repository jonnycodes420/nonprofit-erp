// NUMBERS-5 · THE LAST HAND-WRITTEN MONEY SUMS: A CREDIT ROW IS NEVER MONEY.
//
// The one test this build earns: these are the money figures on Reports,
// Finance, grants, recurring gifts and the report builder, the last 52 sums
// that counted soft and matching credit rows as money (or left a refund out
// instead of taking it off) in docs/architecture/money-sums.md. Every value
// below is worked out by hand from the fixture, never from the app's SQL.
//
// The fixture: Ada gives $100 two years ago, $200 last year and is refunded
// $50 last year, and has a $900 soft credit last year. Cal has only credit
// rows ($1,000 soft, $700 matching credit). A pledge of $500 has a $150
// payment and a $300 credit row linked to it; a grant's award pledge has a
// $400 payment and a $250 credit row. A recurring gift has a $25 payment and
// a $10 credit row.
//
// WHAT WOULD MAKE THIS FAIL (run against main before the fix: red):
//   · the three-year report sums every row → Ada's last year reads $1,050
//     and Cal appears with $1,000;
//   · the retention report counts a credit-only person as a donor → two
//     prior-year donors, not one;
//   · the report builder's Paid / Received / gift total count credit rows;
//   · a grant's received, the recurring roster's total given, Finance's
//     giving history and the top-givers source count credit rows.
//
//   BASE=http://localhost:5601 node tests/numbers5-money-sums.test.js
"use strict";
const bcrypt = require("bcryptjs");
const { ok, summary, q, closeDb, login, api } = require("./helpers");
const FS = require("../figureSources");
const { civilYear } = require("./clock");

const ORG = "org_n5sums";
const ADMIN = "director@n5sums.local";
const Y = civilYear();
const y = n => Y - n;

async function clear(org) {
  const tables = (await q(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id' AND table_name <> 'orgs'`)).map(r => r.table_name);
  for (let pass = 0; pass < 6; pass++) {
    for (const t of tables) await q(`DELETE FROM "${t}" WHERE org_id=$1`, [org]).catch(() => {});
    if (await q(`DELETE FROM orgs WHERE id=$1`, [org]).then(() => true).catch(() => false)) break;
  }
}

async function buildFixture() {
  await clear(ORG);
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone) VALUES ($1,'Sums Harbour Arts','n5sums',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role) VALUES ('u_n5_admin',$1,$2,$3,'Rae Summer','admin')`, [ORG, ADMIN, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted) VALUES ('ff_n5_gen',$1,'General',false)`, [ORG]);
  for (const [id, name] of [["d_n5_ada", "Ada Pellow"], ["d_n5_cal", "Cal Brennick"], ["d_n5_fund", "Tidewater Foundation"]]) {
    await q(`INSERT INTO donors (id,org_id,name,email,kind,stage,created_by,created_by_name) VALUES ($1,$2,$3,$4,'individual','steward','system:test','test')`,
      [id, ORG, name, id + "@n5.test"]);
  }
  await q(`INSERT INTO pledges (id,org_id,donor_id,amount,due_date,status) VALUES ('p_n5_ada',$1,'d_n5_ada',500,$2,'open'), ('p_n5_grant',$1,'d_n5_fund',1000,$2,'open')`, [ORG, `${y(1)}-12-31`]);
  await q(`INSERT INTO grants (id,org_id,funder,funder_donor_id,program,amount_awarded,status,award_pledge_id) VALUES ('gr_n5',$1,'Tidewater Foundation','d_n5_fund','Studio',1000,'awarded','p_n5_grant')`, [ORG]);
  await q(`INSERT INTO recurring_subscriptions (id,org_id,donor_id,stripe_subscription_id,amount,interval,status) VALUES ('rs_n5',$1,'d_n5_ada','sub_n5_test',25,'month','active')`, [ORG]);
  let n = 0;
  const gift = (donor, amount, date, extra = {}) => q(
    `INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,pledge_id,recurring_subscription_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [`g_n5_${++n}`, ORG, donor, amount, date, extra.type || "cash", extra.fund || "ff_n5_gen", extra.pledge || null, extra.sub || null]);
  await gift("d_n5_ada", 100, `${y(2)}-03-01`);
  await gift("d_n5_ada", 200, `${y(1)}-03-01`);
  await gift("d_n5_ada", -50, `${y(1)}-04-01`);                                  // a refund comes off
  await gift("d_n5_ada", 900, `${y(1)}-05-01`, { type: "soft credit" });          // recognition, never money
  await gift("d_n5_cal", 1000, `${y(1)}-03-05`, { type: "soft credit" });
  await gift("d_n5_cal", 700, `${y(2)}-03-05`, { type: "matching gift credit" });
  await gift("d_n5_ada", 150, `${y(1)}-06-01`, { pledge: "p_n5_ada" });
  await gift("d_n5_ada", 300, `${y(1)}-06-02`, { pledge: "p_n5_ada", type: "soft credit" });
  await gift("d_n5_fund", 400, `${y(1)}-07-01`, { pledge: "p_n5_grant" });
  await gift("d_n5_fund", 250, `${y(1)}-07-02`, { pledge: "p_n5_grant", type: "matching gift credit" });
  await gift("d_n5_ada", 25, `${y(1)}-08-01`, { sub: "rs_n5" });
  await gift("d_n5_ada", 10, `${y(1)}-08-02`, { sub: "rs_n5", type: "soft credit" });
}
// Money, by hand: last year Ada 200 - 50 + 150 + 25 = 325, the foundation 400.
const ADA_LAST = 325, ADA_PRIOR = 100, FUND_LAST = 400;

(async () => {
  console.log("numbers5-money-sums (NUMBERS-5)");
  await buildFixture();
  const tok = await login(ADMIN, "loadtest1234");
  const last = { from: `${y(1)}-01-01`, to: `${y(1)}-12-31` }, prior = { from: `${y(2)}-01-01`, to: `${y(2)}-12-31` };

  // §1 the three-year report: each person's columns are money and foot to the year's total.
  const ty = (await api("GET", `/reports/three-year?year=${y(1)}&yearMode=calendar`, tok)).body || {};
  const rows3 = ty.donors || ty.rows || [];
  const ada3 = rows3.find(r => r.id === "d_n5_ada") || {};
  ok("§1 three-year: Ada's last year is her money ($325), not her credit rows", Number(ada3.y0) === ADA_LAST, ada3);
  ok("§1 three-year: Ada's year before is $100", Number(ada3.y1) === ADA_PRIOR, ada3);
  ok("§1 three-year: a person with only credit rows is not listed", !rows3.some(r => r.id === "d_n5_cal"), rows3.map(r => r.name));
  const col0 = rows3.reduce((a, r) => a + Number(r.y0 || 0), 0);
  ok("§1 three-year: the people's last-year column adds up to the year's total ($725)", Math.round(col0 * 100) === (ADA_LAST + FUND_LAST) * 100
    && Math.round(Number(ty.figures?.t0?.value) * 100) === (ADA_LAST + FUND_LAST) * 100, { col0, t0: ty.figures?.t0?.value });

  // §2 the retention report and its sources: a credit-only person is not a donor.
  const rr = (await api("GET", `/reports/retention?yearMode=calendar`, tok)).body || {};
  const rowLast = (rr.rows || []).find(r => r.year === y(1)) || {};
  ok("§2 retention: one prior-year donor (Ada), not Cal's matching credit", rowLast.priorDonors === 1, rowLast);
  ok("§2 retention: prior dollars $100 and retained dollars $325", Number(rowLast.priorDollars) === ADA_PRIOR && Number(rowLast.retainedDollars ?? -1) === ADA_LAST, rowLast);
  const w = { from1: prior.from, to1: prior.to, from0: last.from, to0: last.to };
  const kept = await FS.figureValue(ORG, { key: "retention-window-kept", params: { ...w, measure: "sum" } }, {});
  ok("§2 retention-window-kept: $325 given again", Math.round(Number(kept.value) * 100) === ADA_LAST * 100, kept.value);

  // §3 top givers and LYBUNT: money in the window.
  const topRows = await FS.allRows(ORG, { key: "top-givers", params: last }).catch(e => [{ error: e.message }]);
  ok("§3 top-givers: Cal's credit rows put nobody in the ninety per cent", !topRows.some(r => r.donor_id === "d_n5_cal"), topRows);
  const lb = (await api("GET", `/reports/lybunt?year=${Y}&yearMode=calendar`, tok)).body || {};
  const lbCal = (lb.rows || []).find(r => r.id === "d_n5_cal");
  const lbAda = (lb.rows || []).find(r => r.id === "d_n5_ada") || {};
  ok("§3 LYBUNT: Ada's prior-year total is her money ($325)", Number(lbAda.priorYearTotal) === ADA_LAST, lbAda);
  ok("§3 LYBUNT: no credit row's dollars in anyone's prior-year total", !lbCal || Number(lbCal.priorYearTotal) === 0, lbCal);

  // §4 the report builder: Paid, Received and a gift total.
  const rb = async definition => (await api("POST", "/report-builder/run", tok, { definition })).body || {};
  const pl = await rb({ entity: "pledges", columns: ["donor", "amount", "paid", "remaining"] });
  const sumOf = (out, key) => ((out.totals && out.totals.sums) || []).find(s => s.key === key)?.cents;
  ok("§4 builder pledges: Paid is $550 (Ada $150, the grant $400), no credit rows", sumOf(pl, "paid") === 55000, pl.totals || pl);
  ok("§4 builder pledges: Still to come is $950", sumOf(pl, "remaining") === 95000, pl.totals);
  const gr = await rb({ entity: "grants", columns: ["funder", "awarded", "received"] });
  ok("§4 builder grants: Received is $400", sumOf(gr, "received") === 40000, gr.totals || gr);
  const gf = await rb({ entity: "gifts", columns: ["donor", "amount"] });
  ok("§4 builder gifts: the total is money ($825), credit rows are not gifts", sumOf(gf, "amount") === (ADA_PRIOR + ADA_LAST + FUND_LAST) * 100 && gf.totals?.count === 6, gf.totals);

  // §5 a grant's received, the recurring roster, Finance's giving history.
  const rs = (await api("GET", "/grants/gr_n5/restricted", tok)).body || {};
  const recCents = rs.balance && (rs.balance.receivedCents ?? Math.round(Number(rs.balance.received) * 100));
  ok("§5 grant: received is the $400 payment, not the matching credit", recCents === 40000, rs.balance);
  ok("§5 grant: the payments behind it are one row", (rs.payments || []).length === 1, rs.payments);
  const ro = (await api("GET", "/recurring/roster", tok)).body || {};
  const sub = (ro.subs || []).find(s => s.id === "rs_n5") || {};
  ok("§5 recurring roster: total given is $25 over one gift", Number(sub.totalGiven) === 25 && Number(sub.linkedGiftCount) === 1, sub);
  const fs = (await api("GET", "/finance/summary", tok)).body || {};
  ok("§5 Finance: the giving history is money ($825)", Math.round(Number(fs.giftHistoryTotal) * 100) === 82500, { giftHistoryTotal: fs.giftHistoryTotal });

  await clear(ORG);
  await closeDb();
  summary();
})().catch(async e => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
