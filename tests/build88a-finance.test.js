// BUILD-88a A.3 — FINANCE, EDITABLE AND FED. Run: node tests/build88a-finance.test.js
//
//   §1  a budget is (account, FUND, year, amount) and an admin can edit all
//       four. It was (account, year, amount): an org that restricts money kept
//       separate budgets per fund and one row could not hold both.
//   §2  a budget year is the ORG's year. `basis=fiscal` reads the July 1
//       boundary the rest of Finance already uses, instead of `${year}-01-01`
//       string arithmetic on a screen with a fiscal toggle at the top of it.
//   §3  a per-fund budget is compared against the money that landed IN THAT
//       FUND, not against the account's whole column.
//   §4  FINANCE FEEDS FUNDRAISING: an org that budgets $200,000 of
//       contributions HAS a $200,000 fundraising goal, and was typing it twice.
//       An admin edits the budget and the Fundraising goal card moves.
//   §5  only an admin may write one.
//
// Local scratch server + Postgres (tests/README.md recipe).

const bcrypt = require("bcryptjs");
const { ok, summary, login, api, q, closeDb, civilToday } = require("./helpers");

const ORG = "org_b88a3";
const c = n => Math.round(Number(n) * 100);

async function reset() {
  for (const t of ["fundraising_goals", "fin_transactions", "gifts", "interactions", "donors", "campaigns",
    "budgets", "accounts", "fin_funds", "users"])
    await q(`DELETE FROM ${t} WHERE org_id=$1`, [ORG]).catch(() => {});
  await q(`DELETE FROM orgs WHERE id=$1`, [ORG]).catch(() => {});
  await q(`INSERT INTO orgs (id,name,org_slug,onboarding_complete,subscription_status,plan,timezone)
           VALUES ($1,'B88a Finance','b88a-finance',1,'active','team','America/New_York')`, [ORG]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a3',$1,'b88a3@test.local',$2,'Ada Admin','admin')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO users (id,org_id,email,password_hash,name,role)
           VALUES ('u_b88a3u',$1,'b88a3u@test.local',$2,'Owen Officer','user')`, [ORG, bcrypt.hashSync("loadtest1234", 10)]);
  await q(`INSERT INTO accounts (id,org_id,code,name,type,subtype,active)
           VALUES ('acct_b88a3c',$1,'4010','Individual Contributions','revenue','contributions',true),
                  ('acct_b88a3e',$1,'5010','Program Salaries','expense','program',true)`, [ORG]);
  await q(`INSERT INTO fin_funds (id,org_id,name,restricted)
           VALUES ('ff_b88a3_gen',$1,'General Operating',false),
                  ('ff_b88a3_bld',$1,'Building Campaign',true)`, [ORG]);
}

(async () => {
  await reset();
  const tok = await login("b88a3@test.local");
  const tokUser = await login("b88a3u@test.local");
  const TODAY = civilToday();
  const YEAR = Number(TODAY.slice(0, 4));
  // The org's CURRENT fiscal year, labelled by the year it ends in (July 1
  // boundary): today is 2026-09-16 → FY2027.
  const FY = Number(TODAY.slice(5, 7)) >= 7 ? YEAR + 1 : YEAR;

  // ── §1 · a budget has a fund ─────────────────────────────────────────────
  console.log("\n— §1 · a budget is (account, fund, year, amount) —");
  const b1 = await api("POST", "/finance/budgets", tok, { accountId: "acct_b88a3c", year: FY, amount: "120,000.00" });
  ok("an admin writes a whole-account budget", b1.status === 200 && c(b1.body.amount) === c(120000), b1.body);
  const b2 = await api("POST", "/finance/budgets", tok, { accountId: "acct_b88a3c", year: FY, amount: 60000, fundId: "ff_b88a3_bld" });
  ok("…and a SECOND one on the same account for a different fund", b2.status === 200 && b2.body.id !== b1.body.id, b2.body);
  ok("the two are different rows — one line could not hold both", b2.body.fundId === "ff_b88a3_bld", b2.body);
  const bad = await api("POST", "/finance/budgets", tok, { accountId: "acct_b88a3c", year: FY, amount: 10, fundId: "ff_someone_else" });
  ok("a fund from another org is refused", bad.status === 404, bad.status);
  const neg = await api("POST", "/finance/budgets", tok, { accountId: "acct_b88a3c", year: FY, amount: -5 });
  ok("a negative budget is refused, not stored", neg.status === 400, neg.status);

  let rows = (await api("GET", `/finance/budgets?year=${FY}&basis=fiscal`, tok)).body;
  const contrib = rows.filter(r => r.accountId === "acct_b88a3c");
  ok("the account shows BOTH lines, each naming its fund",
    contrib.length === 2 && contrib.some(r => r.fundName === "Building Campaign") && contrib.some(r => r.fundId === null),
    contrib.map(r => [r.fundName, r.budget]));
  ok("every line carries its id, so it can be moved or removed",
    contrib.every(r => typeof r.id === "string" && r.id.length > 0), contrib.map(r => r.id));

  // ── §2 · the year is the ORG's year ──────────────────────────────────────
  console.log("\n— §2 · a budget year is the org's fiscal year —");
  ok(`basis=fiscal reads the July 1 boundary (FY${FY} = ${FY - 1}-07-01 → ${FY}-06-30)`,
    contrib[0].periodStart === `${FY - 1}-07-01` && contrib[0].periodEnd === `${FY}-06-30`,
    { start: contrib[0].periodStart, end: contrib[0].periodEnd });
  const cal = (await api("GET", `/finance/budgets?year=${YEAR}&basis=calendar`, tok)).body[0];
  ok("basis=calendar still reads January to December, unchanged",
    cal.periodStart === `${YEAR}-01-01` && cal.periodEnd === `${YEAR}-12-31`, { start: cal.periodStart, end: cal.periodEnd });

  // ── §3 · actuals follow the fund ─────────────────────────────────────────
  console.log("\n— §3 · a fund's budget is compared against that fund's money —");
  await q(`INSERT INTO donors (id,org_id,name,email,status,stage) VALUES ('d_b88a3',$1,'Ada Donor','ada@b88a3.test','new','steward')`, [ORG]);
  await q(`INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,donor_id,source)
           VALUES ('ft_b88a3_1',$1,$2,'Gift','Ada Donor',15000,'income','acct_b88a3c','ff_b88a3_gen','d_b88a3','gift'),
                  ('ft_b88a3_2',$1,$2,'Gift','Ada Donor',4000,'income','acct_b88a3c','ff_b88a3_bld','d_b88a3','gift')`, [ORG, TODAY]);
  rows = (await api("GET", `/finance/budgets?year=${FY}&basis=fiscal`, tok)).body;
  const building = rows.find(r => r.fundId === "ff_b88a3_bld");
  const whole = rows.find(r => r.accountId === "acct_b88a3c" && r.fundId === null);
  ok("the Building Campaign line's actual is ITS fund's $4,000, not the account's $19,000",
    c(building.actual) === c(4000), building);
  ok("…and its variance follows ($60,000 − $4,000)", c(building.variance) === c(56000), building);
  ok("the whole-account line still sees the whole account ($19,000)", c(whole.actual) === c(19000), whole);

  // ── §4 · Finance feeds Fundraising ───────────────────────────────────────
  console.log("\n— §4 · the budget IS the goal, until somebody sets one —");
  await q(`INSERT INTO gifts (id,org_id,donor_id,amount,date,type,fund_id,payment_method)
           VALUES ('g_b88a3',$1,'d_b88a3',19000,$2,'cash','ff_b88a3_gen','Check')`, [ORG, TODAY]);
  let fr = (await api("GET", "/fundraising/overview?yearMode=fiscal", tok)).body;
  ok("with no fundraising goal set, the card reads the contributions BUDGET",
    fr.goal && fr.goal.source === "budget" && c(fr.goal.goalAmount) === c(180000),
    { source: fr.goal?.source, amount: fr.goal?.goalAmount });
  ok("…and says where the figure came from",
    /From your Finance budget/i.test(fr.goal?.sourceNote || ""), fr.goal?.sourceNote);
  ok("…against what has actually come in", c(fr.goal.currentAmount) === c(19000), fr.goal.currentAmount);

  // THE ASSERTION A.3 ASKS FOR, end to end.
  const edit = await api("POST", "/finance/budgets", tok, { accountId: "acct_b88a3c", year: FY, amount: 250000 });
  ok("an admin edits the budget", edit.status === 200, edit.status);
  fr = (await api("GET", "/fundraising/overview?yearMode=fiscal", tok)).body;
  ok("the Fundraising goal card reflects it, to the cent ($250,000 + $60,000)",
    c(fr.goal.goalAmount) === c(310000), fr.goal.goalAmount);

  // An explicit goal outranks the inferred one: a goal somebody set on purpose
  // beats one Steward worked out.
  await q(`INSERT INTO fundraising_goals (id,org_id,label,goal_type,goal_amount,period_start,period_end)
           VALUES ('fg_b88a3',$1,'Spring campaign','total',400000,$2,$3)`,
    [ORG, `${FY - 1}-07-01`, `${FY}-06-30`]);
  fr = (await api("GET", "/fundraising/overview?yearMode=fiscal", tok)).body;
  ok("a goal somebody SET outranks the one Steward inferred",
    fr.goal.source === "goal" && c(fr.goal.goalAmount) === c(400000), { source: fr.goal.source, amount: fr.goal.goalAmount });

  // ── §5 · who may write one ───────────────────────────────────────────────
  console.log("\n— §5 · only an admin writes a budget —");
  const asUser = await api("POST", "/finance/budgets", tokUser, { accountId: "acct_b88a3c", year: FY, amount: 1 });
  ok("a non-admin is refused", asUser.status === 403, asUser.status);
  const delUser = await api("DELETE", `/finance/budgets/${b2.body.id}`, tokUser);
  ok("…and cannot delete one either", delUser.status === 403, delUser.status);
  const del = await api("DELETE", `/finance/budgets/${b2.body.id}`, tok);
  ok("an admin can remove a budget line", del.status === 200, del.status);
  rows = (await api("GET", `/finance/budgets?year=${FY}&basis=fiscal`, tok)).body;
  ok("…and it is gone", !rows.some(r => r.id === b2.body.id), rows.map(r => r.id));
  const [after] = await q(`SELECT COUNT(*)::int n FROM budgets WHERE org_id=$1`, [ORG]);
  ok("exactly one budget row remains", after.n === 1, after.n);

  summary("build88a-finance");
  await closeDb();
})();
